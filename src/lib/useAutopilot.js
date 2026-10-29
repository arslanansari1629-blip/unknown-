import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTOPILOT_CHANNEL, AUTOPILOT_LEASE_KEY, AUTOPILOT_LOCK,
  HEARTBEAT_TIMEOUT_MS, STABLE_RESET_MS, recoveryReason,
} from './autopilot.js';
import { uid } from './storage.js';

const LEASE_TTL_MS = 12_000;
const LEASE_RENEW_MS = 4_000;
const WATCHDOG_MS = 10_000;
const TELEMETRY_MS = 5_000;

/**
 * Browser-side Autopilot / Uptime Shield.
 *
 * This deliberately does NOT pretend that a closed browser can execute code.
 * It keeps an *open* dashboard alive and self-healing: leader election, screen
 * wake lock, optional audio keepalive, persistent storage, PWA/offline shell,
 * watchdog restarts, auto-resume and uptime telemetry.
 */
export function useAutopilot(host, notify) {
  const settings = host.state.settings.autopilot;
  const enabled = Boolean(settings.enabled);
  const leaderOnly = Boolean(settings.leaderOnly);
  const [leader, setLeader] = useState(!leaderOnly);
  const [lockMode, setLockMode] = useState('none');
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const [fullscreen, setFullscreen] = useState(false);
  const [swStatus, setSwStatus] = useState('unsupported');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [peers, setPeers] = useState(1);
  const [notificationPermission, setNotificationPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  const hostRef = useRef(host);
  hostRef.current = host;
  const tabId = useRef(uid('tab'));
  const releaseLock = useRef(null);
  const lockAbort = useRef(null);
  const channel = useRef(null);
  const wakeSentinel = useRef(null);
  const audioRef = useRef(null);
  const leaderRef = useRef(leader);
  leaderRef.current = leader;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lastTelemetry = useRef(Date.now());

  const log = useCallback((level, message) => hostRef.current.logAutopilotEvent(level, message), []);

  const sendNotification = useCallback((title, body) => {
    if (!enabledRef.current || !hostRef.current.state.settings.autopilot.notifications) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    try { new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'bothost-autopilot' }); } catch { /* ignore */ }
  }, []);

  // ---- Service worker / PWA install -------------------------------------
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (cancelled) return;
      if (!registration) setSwStatus('none');
      else setSwStatus(registration.active ? 'active' : 'registered');
    }).catch(() => {});
    const onController = () => setSwStatus('active');
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    const onPrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    const onInstalled = () => { setInstallPrompt(null); log('info', 'BotHost was installed as an app.'); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [log]);

  // ---- Presence channel ---------------------------------------------------
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bus = new BroadcastChannel(AUTOPILOT_CHANNEL);
    channel.current = bus;
    const seen = new Map();
    const announce = () => {
      bus.postMessage({ type: 'presence', id: tabId.current, leader: leaderRef.current, enabled: enabledRef.current, at: Date.now() });
      const cutoff = Date.now() - 15_000;
      for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
      setPeers(seen.size + 1);
    };
    bus.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'presence' && message.id !== tabId.current) {
        seen.set(message.id, Date.now());
        setPeers(seen.size + 1);
      }
      if (message.type === 'recover' && leaderRef.current) sweep('peer request');
    };
    announce();
    const timer = setInterval(announce, 5_000);
    return () => { clearInterval(timer); bus.close(); channel.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Leader election ----------------------------------------------------
  useEffect(() => {
    if (!enabled || !leaderOnly) {
      setLeader(true);
      setLockMode(enabled ? 'single-tab' : 'off');
      hostRef.current.setLeadership(true);
      return;
    }
    let cancelled = false;
    const becomeLeader = () => {
      if (cancelled) return;
      setLeader(true);
      hostRef.current.setLeadership(true);
      hostRef.current.updateAutopilotStats({ leaderSince: Date.now() });
      log('info', 'This tab was elected Autopilot leader.');
      sweep('leader elected');
    };
    const becomeFollower = () => {
      if (cancelled) return;
      setLeader(false);
      hostRef.current.setLeadership(false);
    };

    // Never own workers while the exclusive lock is still pending. This also
    // makes React StrictMode's mount → cleanup → mount safe: the first request
    // is aborted before it can leave a leader behind.
    setLeader(false);
    hostRef.current.setLeadership(false);

    if (navigator.locks?.request) {
      setLockMode('web-locks');
      const controller = new AbortController();
      lockAbort.current = controller;
      navigator.locks.request(AUTOPILOT_LOCK, { mode: 'exclusive', signal: controller.signal }, async () => {
        becomeLeader();
        await new Promise((resolve) => { releaseLock.current = resolve; });
        if (!cancelled) {
          setLeader(false);
          hostRef.current.setLeadership(false);
        }
      }).catch((error) => {
        if (!cancelled && error?.name !== 'AbortError') {
          setLockMode('error');
          becomeFollower();
          log('error', `Leader election failed: ${error.message}`);
        }
      });
      return () => {
        cancelled = true;
        releaseLock.current?.();
        releaseLock.current = null;
        controller.abort();
        lockAbort.current = null;
      };
    }

    // Fallback: localStorage lease + BroadcastChannel presence.
    setLockMode('lease');
    const tryLease = () => {
      if (cancelled) return;
      const now = Date.now();
      let lease = null;
      try { lease = JSON.parse(localStorage.getItem(AUTOPILOT_LEASE_KEY) || 'null'); } catch { lease = null; }
      if (!lease || lease.expires < now || lease.id === tabId.current) {
        try { localStorage.setItem(AUTOPILOT_LEASE_KEY, JSON.stringify({ id: tabId.current, expires: now + LEASE_TTL_MS })); } catch { /* storage blocked */ }
        if (!leaderRef.current) becomeLeader();
        else hostRef.current.setLeadership(true);
      } else if (leaderRef.current) {
        becomeFollower();
        log('warn', 'Another tab holds the Autopilot lease. This tab is now a follower.');
      }
    };
    tryLease();
    const timer = setInterval(tryLease, LEASE_RENEW_MS);
    const onStorage = (event) => { if (event.key === AUTOPILOT_LEASE_KEY) tryLease(); };
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      try {
        const lease = JSON.parse(localStorage.getItem(AUTOPILOT_LEASE_KEY) || 'null');
        if (lease?.id === tabId.current) localStorage.removeItem(AUTOPILOT_LEASE_KEY);
      } catch { /* ignore */ }
      hostRef.current.setLeadership(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, leaderOnly, log]);

  // ---- Recovery sweep / watchdog -----------------------------------------
  const sweep = useCallback((reason = 'watchdog') => {
    const h = hostRef.current;
    if (!h.ready || !enabledRef.current || !leaderRef.current) return;
    const ap = h.state.settings.autopilot;
    const now = Date.now();
    for (const bot of h.state.bots) {
      if (!bot.desiredRunning) continue;
      const alive = h.getRuntimeAlive(bot.id);
      const action = recoveryReason(bot, now, alive);
      if (!action) {
        if (bot.status === 'running' && bot.restartCount > 0 && bot.lastRecoveryAt && now - bot.lastRecoveryAt > STABLE_RESET_MS && now - (bot.lastHeartbeat || 0) < HEARTBEAT_TIMEOUT_MS) {
          h.markStable(bot.id);
        }
        continue;
      }
      if (action === 'auto-resume' && !ap.autoResume) continue;
      if (action !== 'auto-resume' && !ap.watchdog) continue;
      const result = h.recoverBot(bot.id, `${action} (${reason})`);
      if (result.ok) sendNotification('BotHost Autopilot recovered a bot', `${bot.name}: ${action}`);
    }
  }, [sendNotification]);

  useEffect(() => {
    if (!enabled || !leader) return;
    const timer = setInterval(() => sweep('watchdog'), WATCHDOG_MS);
    const onOnline = () => { setOnline(true); log('info', 'Network restored. Sweeping Autopilot targets.'); sweep('online'); };
    const onOffline = () => { setOnline(false); log('warn', 'Network lost. Workers will retry when connectivity returns.'); };
    const onVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      setVisible(isVisible);
      if (isVisible) sweep('visible');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    sweep('armed');
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, leader, log, sweep]);

  // ---- Uptime telemetry ---------------------------------------------------
  useEffect(() => {
    if (!enabled || !leader) { lastTelemetry.current = Date.now(); return; }
    lastTelemetry.current = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = Math.max(0, Math.min(now - lastTelemetry.current, 30_000));
      lastTelemetry.current = now;
      if (document.visibilityState === 'visible' || audioRef.current) {
        hostRef.current.updateAutopilotStats((stats) => ({ uptimeMs: stats.uptimeMs + delta }));
      }
    }, TELEMETRY_MS);
    return () => clearInterval(timer);
  }, [enabled, leader]);

  // ---- Screen wake lock ---------------------------------------------------
  useEffect(() => {
    if (!enabled || !settings.wakeLock || !leader || !visible || !navigator.wakeLock?.request) {
      wakeSentinel.current?.release?.().catch(() => {});
      wakeSentinel.current = null;
      setWakeLockActive(false);
      return;
    }
    let cancelled = false;
    const request = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) { sentinel.release().catch(() => {}); return; }
        wakeSentinel.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener('release', () => {
          if (wakeSentinel.current === sentinel) {
            wakeSentinel.current = null;
            setWakeLockActive(false);
          }
        });
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };
    request();
    return () => {
      cancelled = true;
      wakeSentinel.current?.release?.().catch(() => {});
      wakeSentinel.current = null;
      setWakeLockActive(false);
    };
  }, [enabled, settings.wakeLock, leader, visible]);

  // ---- Persistent storage -------------------------------------------------
  useEffect(() => {
    if (!navigator.storage?.persisted) return;
    navigator.storage.persisted().then(setPersisted).catch(() => {});
  }, []);

  const requestPersistence = useCallback(async () => {
    if (!navigator.storage?.persist) { notify('error', 'Persistent storage is not supported by this browser.'); return false; }
    try {
      const granted = await navigator.storage.persist();
      setPersisted(granted);
      log(granted ? 'info' : 'warn', granted ? 'Persistent storage granted.' : 'Persistent storage was not granted. The browser may evict site data under pressure.');
      notify(granted ? 'success' : 'error', granted ? 'Persistent storage granted.' : 'Persistent storage was not granted.');
      return granted;
    } catch (error) {
      notify('error', `Persistent storage failed: ${error.message}`);
      return false;
    }
  }, [log, notify]);

  useEffect(() => {
    if (enabled) requestPersistence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ---- Optional near-silent audio keepalive ------------------------------
  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    try { audio.oscillator.stop(); } catch { /* ignore */ }
    try { audio.context.close(); } catch { /* ignore */ }
    audioRef.current = null;
    setAudioActive(false);
  }, []);

  const startAudio = useCallback(async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { notify('error', 'Web Audio is not supported by this browser.'); return false; }
    try {
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 20;
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      await context.resume();
      audioRef.current = { context, oscillator, gain };
      setAudioActive(true);
      log('info', 'Near-silent audio keepalive armed.');
      return true;
    } catch (error) {
      notify('error', `Audio keepalive failed: ${error.message}`);
      return false;
    }
  }, [log, notify]);

  useEffect(() => {
    if (!enabled || !settings.silentAudio || !leader) stopAudio();
    return () => {};
  }, [enabled, settings.silentAudio, leader, stopAudio]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && audioRef.current?.context.state === 'suspended') {
        audioRef.current.context.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ---- Notifications ------------------------------------------------------
  const requestNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') { notify('error', 'Notifications are not supported by this browser.'); return false; }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    hostRef.current.setAutopilotSettings({ notifications: permission === 'granted' });
    notify(permission === 'granted' ? 'success' : 'error', permission === 'granted' ? 'Autopilot notifications enabled.' : 'Notification permission was not granted.');
    return permission === 'granted';
  }, [notify]);

  // ---- Kiosk / fullscreen -------------------------------------------------
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const next = !document.fullscreenElement;
      if (next) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      hostRef.current.setAutopilotSettings({ kiosk: next });
    } catch (error) {
      notify('error', `Fullscreen failed: ${error.message}`);
    }
  }, [notify]);

  // ---- Arm / disarm -------------------------------------------------------
  const arm = useCallback(() => {
    hostRef.current.setAutopilotSettings({ enabled: true });
    hostRef.current.updateAutopilotStats((stats) => ({ sessions: stats.sessions + 1, lastStartedAt: Date.now() }));
    log('info', 'Autopilot armed. Keep this browser open on a spare device for continuous operation.');
    notify('success', 'Autopilot armed. Keep this tab/device open.');
    channel.current?.postMessage({ type: 'recover', id: tabId.current });
  }, [log, notify]);

  const disarm = useCallback(() => {
    hostRef.current.setAutopilotSettings({ enabled: false });
    log('warn', 'Autopilot disarmed. Workers keep their current state but will not self-heal.');
    notify('info', 'Autopilot disarmed.');
  }, [log, notify]);

  const install = useCallback(async () => {
    if (!installPrompt) { notify('info', 'Use your browser menu → Install app / Add to Home Screen.'); return; }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') log('info', 'PWA install accepted.');
    setInstallPrompt(null);
  }, [installPrompt, log, notify]);

  const updateSetting = useCallback((key, value) => {
    hostRef.current.setAutopilotSettings({ [key]: value });
  }, []);

  return {
    settings, enabled, leader, lockMode, peers, online, visible,
    wakeLockActive, audioActive, persisted, fullscreen, swStatus,
    canInstall: Boolean(installPrompt), notificationPermission,
    arm, disarm, updateSetting, sweep, install, toggleFullscreen,
    startAudio, stopAudio, requestPersistence, requestNotifications,
    tabId: tabId.current,
  };
}
