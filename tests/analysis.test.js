import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDependencies, detectImports, extractToken, maskToken, preflightPython, parseRequirements, redact } from '../src/lib/analysis.js';

test('detects imports, aliases, comma lists and from-imports while ignoring strings/comments', () => {
  const source = `import os, requests as rq\nfrom telegram import Update\nfrom telegram.ext import Application\n# import fake\ntext = "import notreal"\nimport telebot\n`;
  assert.deepEqual(detectImports(source), ['os', 'requests', 'telebot', 'telegram']);
});

test('maps imports to pinned requirements and excludes stdlib', () => {
  const result = analyzeDependencies('import os\nimport telebot\nimport requests\nfrom bs4 import BeautifulSoup');
  assert.equal(result.framework, 'telebot');
  assert.match(result.requirements, /pytelegrambotapi==4\.26\.0/);
  assert.match(result.requirements, /beautifulsoup4/);
  assert.doesNotMatch(result.requirements, /\bos\b/);
});

test('blocks Pyrogram with an actionable browser limitation', () => {
  const result = analyzeDependencies('from pyrogram import Client');
  assert.equal(result.framework, 'pyrogram');
  assert.equal(result.blockers.length, 1);
  assert.match(result.blockers[0].message, /raw TCP sockets/);
});

test('extracts literal and environment tokens and validates override', () => {
  const token = '123456789:AAH' + 'a'.repeat(33);
  assert.equal(extractToken(`bot = TeleBot("${token}")`).token, token);
  assert.equal(extractToken('import os\nbot = TeleBot(os.environ["BOT_TOKEN"])').source, 'environment');
  assert.equal(extractToken('', token).valid, true);
  assert.equal(extractToken('', 'bad').valid, false);
});

test('ignores tokens that only appear in comments', () => {
  const token = '123456789:AAH' + 'e'.repeat(33);
  assert.equal(extractToken(`# BOT_TOKEN = "${token}"\nimport os\nbot = TeleBot(os.environ["BOT_TOKEN"])`).source, 'environment');
});

test('redacts and masks tokens', () => {
  const token = '123456789:AAH' + 'b'.repeat(33);
  assert.equal(redact(`url https://api.telegram.org/bot${token}/getMe`, token).includes(token), false);
  assert.match(maskToken(token), /^123456789:•+.{4}$/);
});

test('preflight catches empty code, mixed indentation and missing blocks', () => {
  assert.equal(preflightPython('').ok, false);
  assert.equal(preflightPython('def x():\n\t return 1').ok, false);
  assert.equal(preflightPython('if True:\nprint(1)').ok, false);
  assert.equal(preflightPython('def x():\n    return 1\n').ok, true);
});

test('preflight does not count brackets inside multiline strings', () => {
  assert.equal(preflightPython('text = """\n(((\n"""\nprint(text)').ok, true);
});

test('parses requirements and rejects pip options/URLs', () => {
  assert.deepEqual(parseRequirements('requests==2.32.3\n# comment\npython-dotenv>=1.0').requirements, ['requests==2.32.3', 'python-dotenv>=1.0']);
  assert.equal(parseRequirements('-r other.txt').errors.length, 1);
  assert.equal(parseRequirements('https://example.com/x.whl').errors.length, 1);
});
