import { test, expect } from '@playwright/test';

test('dashboard loads, validates Python and persists the draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your bot control room.' })).toBeVisible();
  await page.getByRole('button', { name: 'Code Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Code Studio' })).toBeVisible();
  await page.getByLabel('Bot name').fill('Persistence Test');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByText(/Syntax and indentation look good/)).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await page.getByRole('button', { name: 'Code Studio' }).click();
  await expect(page.getByLabel('Bot name')).toHaveValue('Persistence Test');
});

test('telebot test run executes handlers against the mocked Telegram API', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Code Studio' }).click();
  await page.getByRole('button', { name: 'Test run', exact: true }).click();
  await page.getByRole('button', { name: 'Run test', exact: true }).click();
  await expect(page.getByText('Test update processed. Test run completed.')).toBeVisible({ timeout: 100_000 });
  await expect(page.getByText(/sendMessage →/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('python-telegram-bot test run executes async handlers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Code Studio' }).click();
  await page.getByLabel('Load a starter template').selectOption('ptb');
  await page.getByRole('button', { name: 'Test run', exact: true }).click();
  await page.getByRole('button', { name: 'Run test', exact: true }).click();
  await expect(page.getByText('Test update processed. Test run completed.')).toBeVisible({ timeout: 100_000 });
  await expect(page.getByText(/sendMessage →/)).toBeVisible();
});

test('invalid syntax is reported before deployment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Code Studio' }).click();
  await page.getByRole('button', { name: 'Import .py' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.py', mimeType: 'text/x-python', buffer: Buffer.from('def broken(:\n    pass\n') });
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByText(/Line \d+:/)).toBeVisible({ timeout: 60_000 });
});

test('fleet controls restart, pause and delete a saved bot', async ({ page }) => {
  const workspace = {
    version: 1,
    bots: [{ id: 'bot_e2e', name: 'Lifecycle Bot', code: 'import telebot\nbot = telebot.TeleBot("123456789:AAH' + 'd'.repeat(33) + '")\nbot.infinity_polling()', token: '123456789:AAH' + 'd'.repeat(33), requirements: 'pytelegrambotapi==4.26.0', framework: 'telebot', status: 'paused', createdAt: Date.now(), updatedAt: Date.now(), deployedAt: Date.now(), messages: 3, errors: 0, offset: 0, seenIds: [], logs: [{ id: 'old', at: Date.now(), level: 'info', message: 'old entry' }] }],
    draft: { name: '', code: '', token: '', requirements: '', autoRequirements: true },
    selectedBotId: 'bot_e2e', settings: {},
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) });
  await page.getByRole('button', { name: 'Bot Fleet' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Lifecycle Bot' });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Restart Lifecycle Bot' }).click();
  await expect(row.getByText('Connecting', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause Lifecycle Bot' }).click();
  await expect(row.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View logs for Lifecycle Bot' }).click();
  await expect(page.getByText('Restart requested. Log buffer flushed and execution state reset.')).toBeVisible();
  await expect(page.getByText('old entry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Bot Fleet' }).click();
  await page.getByRole('button', { name: 'Delete Lifecycle Bot' }).click();
  await page.getByRole('button', { name: 'Delete bot', exact: true }).click();
  await expect(page.getByText('No bots deployed yet')).toBeVisible();
});

test('relay health endpoint is stateless and reachable', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.storage).toBe('browser-only');
  expect(body.mode).toBe('stateless-telegram-relay');
});
