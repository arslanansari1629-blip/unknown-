export const TELEBOT_TEMPLATE = `import os
import telebot

bot = telebot.TeleBot(os.environ["BOT_TOKEN"])


@bot.message_handler(commands=["start", "help"])
def welcome(message):
    bot.reply_to(
        message,
        "👋 Hi! I'm running on BotHost Serverless.\\n\\n"
        "Try /ping or send me any text and I'll echo it back.",
    )


@bot.message_handler(commands=["ping"])
def ping(message):
    bot.reply_to(message, "🏓 Pong! Your browser bot is alive.")


@bot.message_handler(content_types=["text"])
def echo(message):
    bot.reply_to(message, f"You said: {message.text}")


print("Bot is starting. Press Deploy, then message it on Telegram.")
bot.infinity_polling(timeout=20, long_polling_timeout=20)
`;

export const PTB_TEMPLATE = `import os
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

logging.basicConfig(level=logging.INFO)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("👋 Hello from BotHost Serverless! Try /ping.")


async def ping(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🏓 Pong!")


async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"You said: {update.message.text}")


app = Application.builder().token(os.environ["BOT_TOKEN"]).build()
app.add_handler(CommandHandler(["start", "help"], start))
app.add_handler(CommandHandler("ping", ping))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))

print("Starting python-telegram-bot polling…")
app.run_polling(allowed_updates=Update.ALL_TYPES)
`;

export const TEMPLATES = [
  { id: 'telebot', label: 'Echo bot · telebot', code: TELEBOT_TEMPLATE, name: 'Echo Assistant' },
  { id: 'ptb', label: 'Async bot · python-telegram-bot', code: PTB_TEMPLATE, name: 'Async Assistant' },
];
