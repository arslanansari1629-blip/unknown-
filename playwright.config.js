import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Optional sandbox helper: @sparticuz/chromium ships AL2023 NSS libraries separately.
if (existsSync('/tmp/al2023/lib')) {
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}`;
}

let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
let args = [];
if (!executablePath) {
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    executablePath = await chromium.executablePath();
    args = chromium.args.filter((arg) => !['--single-process', '--no-zygote'].includes(arg));
  } catch {
    // On a normal development machine use: npx playwright install chromium
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath, args },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
