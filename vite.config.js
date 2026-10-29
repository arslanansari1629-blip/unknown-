import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import telegram from './api/telegram.js';
import health from './api/health.js';

function localApi() {
  const attach = (middlewares) => {
    const adapt = (res) => {
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
      return res;
    };
    middlewares.use('/api/telegram', async (req, res, next) => {
      adapt(res);
      if (req.method !== 'POST') return telegram(req, res);
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5_000_000) {
            res.statusCode = 413;
            return res.end(JSON.stringify({ ok: false, description: 'Request too large.' }));
          }
          chunks.push(chunk);
        }
        req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        return telegram(req, res);
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, description: 'Invalid JSON request body.' }));
      }
    });
    middlewares.use('/api/health', (req, res) => health(req, adapt(res)));
  };
  return {
    name: 'bothost-local-api',
    configureServer(server) { attach(server.middlewares); },
    configurePreviewServer(server) { attach(server.middlewares); },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  worker: { format: 'iife' },
});
