const TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{30,}$/;
const METHODS = new Set([
  'getMe', 'getUpdates', 'deleteWebhook', 'getWebhookInfo', 'sendMessage', 'sendPhoto', 'sendAudio',
  'sendDocument', 'sendVideo', 'sendAnimation', 'sendVoice', 'sendVideoNote', 'sendMediaGroup',
  'sendLocation', 'sendVenue', 'sendContact', 'sendPoll', 'sendDice', 'sendChatAction', 'sendSticker',
  'forwardMessage', 'copyMessage', 'editMessageText', 'editMessageCaption', 'editMessageReplyMarkup',
  'editMessageMedia', 'deleteMessage', 'deleteMessages', 'answerCallbackQuery', 'answerInlineQuery',
  'getUserProfilePhotos', 'getFile', 'getChat', 'getChatAdministrators', 'getChatMemberCount',
  'getChatMember', 'leaveChat', 'banChatMember', 'unbanChatMember', 'restrictChatMember',
  'promoteChatMember', 'setChatPermissions', 'setChatTitle', 'setChatDescription', 'setChatPhoto',
  'deleteChatPhoto', 'pinChatMessage', 'unpinChatMessage', 'unpinAllChatMessages', 'getMyCommands',
  'setMyCommands', 'deleteMyCommands', 'setMyName', 'getMyName', 'setMyDescription', 'getMyDescription',
  'setMyShortDescription', 'getMyShortDescription', 'setMessageReaction', 'getUserChatBoosts',
  'getBusinessConnection', 'stopPoll', 'approveChatJoinRequest', 'declineChatJoinRequest',
]);
const buckets = new Map();
const RATE_LIMIT = 240;
const WINDOW_MS = 60_000;

export class RelayError extends Error {
  constructor(status, description) {
    super(description);
    this.status = status;
  }
}

function rateLimit(key) {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.start > WINDOW_MS) buckets.delete(k);
  }
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) throw new RelayError(429, 'Relay rate limit exceeded. Wait a minute before retrying.');
}

export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // Non-browser clients still need a valid bot token.
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new RelayError(403, 'Invalid request origin.');
  }
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const allowed = new Set([req.headers.host, forwarded].filter(Boolean));
  if (!allowed.has(host)) throw new RelayError(403, 'Cross-origin relay requests are not allowed.');
}

export async function relayTelegram(body, clientIp = 'unknown') {
  rateLimit(clientIp);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RelayError(400, 'Expected a JSON object.');
  const { token, method, payload = {}, multipart } = body;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new RelayError(400, 'A valid Telegram bot token is required.');
  if (typeof method !== 'string' || !METHODS.has(method)) throw new RelayError(400, 'This Telegram Bot API method is not supported by the browser relay.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RelayError(400, 'payload must be an object.');
  const params = { ...payload };
  if (method === 'getUpdates') {
    params.timeout = Math.max(0, Math.min(25, Number(params.timeout) || 0));
    if (params.limit !== undefined) params.limit = Math.max(1, Math.min(100, Number(params.limit) || 100));
    if (typeof params.allowed_updates === 'string') {
      try { params.allowed_updates = JSON.parse(params.allowed_updates); } catch { /* Telegram will report invalid JSON. */ }
    }
  }
  let upstreamBody;
  const headers = {};
  if (multipart) {
    if (typeof multipart.data_base64 !== 'string' || typeof multipart.content_type !== 'string' || !multipart.content_type.startsWith('multipart/form-data;')) {
      throw new RelayError(400, 'Invalid multipart payload.');
    }
    if (multipart.data_base64.length > 4_200_000) throw new RelayError(413, 'Uploads are limited to 3 MB in the serverless relay.');
    const buffer = Buffer.from(multipart.data_base64, 'base64');
    if (buffer.length > 3_145_728) throw new RelayError(413, 'Uploads are limited to 3 MB in the serverless relay.');
    upstreamBody = buffer;
    headers['Content-Type'] = multipart.content_type;
  } else {
    upstreamBody = JSON.stringify(params);
    if (upstreamBody.length > 65_536) throw new RelayError(413, 'Telegram JSON payloads are limited to 64 KB.');
    headers['Content-Type'] = 'application/json';
  }
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body: upstreamBody,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new RelayError(504, 'Telegram did not respond within 30 seconds.');
    throw new RelayError(502, 'The relay could not reach Telegram. Check the deployment’s outbound network and try again.');
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RelayError(502, 'Telegram returned a non-JSON response.');
  }
  return { status: response.status, data };
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

export async function handleRelay(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, description: 'Use POST with a Telegram bot token and method.' });
  }
  try {
    assertSameOrigin(req);
    const result = await relayTelegram(req.body, clientIp(req));
    return res.status(result.status).json(result.data);
  } catch (error) {
    const status = error instanceof RelayError ? error.status : 500;
    return res.status(status).json({ ok: false, description: status === 500 ? 'Unexpected relay error.' : error.message });
  }
}
