export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'bothost-serverless',
    mode: 'stateless-telegram-relay',
    storage: 'browser-only',
    runtime: 'pyodide-web-worker',
  });
}
