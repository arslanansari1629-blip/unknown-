"""GET /api/templates - production-ready Python Telegram bot templates."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _common import send
from http.server import BaseHTTPRequestHandler

TEMPLATES = [
    {
        "id": "echo-ptb", "name": "Echo Bot", "framework": "python-telegram-bot",
        "level": "Beginner", "icon": "🔁",
        "desc": "Replies to every message. Perfect first bot.",
        "requirements": "python-telegram-bot==21.6",
        "code": '''import os
from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes

TOKEN = os.environ["BOT_TOKEN"]

async def start(u: Update, c: ContextTypes.DEFAULT_TYPE):
    await u.message.reply_text("👋 Hi! Send me anything and I will echo it.")

async def echo(u: Update, c: ContextTypes.DEFAULT_TYPE):
    await u.message.reply_text(u.message.text)

app = Application.builder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))
app.run_polling()
''',
    },
    {
        "id": "keyboard-aiogram", "name": "Keyboard + FSM Bot", "framework": "aiogram 3",
        "level": "Intermediate", "icon": "⌨️",
        "desc": "Reply keyboards, inline buttons and state machine form.",
        "requirements": "aiogram==3.13.1",
        "code": '''import os, asyncio
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton
from aiogram.filters import CommandStart

bot = Bot(os.environ["BOT_TOKEN"])
dp = Dispatcher()
kb = ReplyKeyboardMarkup(keyboard=[
    [KeyboardButton(text="📊 Stats"), KeyboardButton(text="ℹ️ About")]
], resize_keyboard=True)

@dp.message(CommandStart())
async def start(m: Message):
    await m.answer("Welcome! Pick an option 👇", reply_markup=kb)

@dp.message(F.text == "📊 Stats")
async def stats(m: Message):
    await m.answer("📊 You are doing great!")

@dp.message(F.text == "ℹ️ About")
async def about(m: Message):
    await m.answer("Hosted 24/7 on PyTeleHost Ultra ⚡")

asyncio.run(dp.start_polling(bot))
''',
    },
    {
        "id": "inline-ptb", "name": "Inline Query Bot", "framework": "python-telegram-bot",
        "level": "Intermediate", "icon": "🔎",
        "desc": "Works in any chat via @botname query.",
        "requirements": "python-telegram-bot==21.6",
        "code": '''import os
from uuid import uuid4
from telegram import Update, InlineQueryResultArticle, InputTextMessageContent
from telegram.ext import Application, InlineQueryHandler, ContextTypes

async def inline(u: Update, c: ContextTypes.DEFAULT_TYPE):
    q = u.inline_query.query or "Hello from PyTeleHost"
    results = [InlineQueryResultArticle(
        id=str(uuid4()), title=q.title(),
        input_message_content=InputTextMessageContent(q.upper()))]
    await u.inline_query.answer(results)

app = Application.builder().token(os.environ["BOT_TOKEN"]).build()
app.add_handler(InlineQueryHandler(inline))
app.run_polling()
''',
    },
    {
        "id": "webhook-raw", "name": "Serverless Webhook Bot (Vercel)", "framework": "Raw Bot API",
        "level": "Advanced", "icon": "⚡",
        "desc": "Zero-dependency bot that runs as a Vercel Python function - no server, no polling.",
        "requirements": "# none - Python standard library only",
        "code": '''# Deployed automatically by PyTeleHost Ultra at /api/webhook
# Commands built in: /start /help /ping /echo /id /about
# Try it: paste your token in the Deploy Console and press
# "Deploy + Set Webhook" - your bot is live in seconds.
print("Webhook bot - hosted by PyTeleHost Ultra")
''',
    },
    {
        "id": "telethon-user", "name": "Telethon Bot", "framework": "Telethon",
        "level": "Advanced", "icon": "🚀",
        "desc": "MTProto bot with events - handles messages and buttons.",
        "requirements": "Telethon==1.36.0",
        "code": '''import os
from telethon import TelegramClient, events

bot = TelegramClient("bot", int(os.environ["API_ID"]),
                     os.environ["API_HASH"]).start(bot_token=os.environ["BOT_TOKEN"])

@bot.on(events.NewMessage(pattern="/start"))
async def start(e):
    await e.respond("👋 Telethon bot online on PyTeleHost Ultra!")

@bot.on(events.NewMessage)
async def echo(e):
    if not e.raw_text.startswith("/"):
        await e.respond(e.raw_text)

bot.run_until_disconnected()
''',
    },
    {
        "id": "ai-ready", "name": "AI Chat Bot (Skeleton)", "framework": "python-telegram-bot",
        "level": "Advanced", "icon": "🤖",
        "desc": "Plug in OpenAI / Gemini / any LLM API and chat.",
        "requirements": "python-telegram-bot==21.6\nhttpx==0.27.2",
        "code": '''import os
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes

async def chat(u: Update, c: ContextTypes.DEFAULT_TYPE):
    # TODO: call your AI provider here with u.message.text
    reply = f"🤖 AI reply to: {u.message.text}"
    await u.message.reply_text(reply)

app = Application.builder().token(os.environ["BOT_TOKEN"]).build()
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, chat))
app.run_polling()
''',
    },
]


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send(self, {"ok": True, "count": len(TEMPLATES), "templates": TEMPLATES})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
