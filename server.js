// Local entry point: starts the Express server and the Telegram bot.
// On Vercel, api/index.js is used instead.

require('dotenv').config();
const path = require('path');
const express = require('express');

const apiRouter = require('./routes/api');
const { initDB } = require('./database');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.MY_TELEGRAM_USER_ID;

const app = express();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// ---------- Routes ----------
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Start ----------
async function start() {
  await initDB();

  app.listen(PORT, () => {
    console.log(`\n💰 Expense Tracker running:`);
    console.log(`   Dashboard:  http://localhost:${PORT}`);
    console.log(`   API base:   http://localhost:${PORT}/api`);
  });

  // NOTE: The Telegram bot is intentionally NOT started here.
  // It runs 24/7 as a Vercel webhook (routes/api.js -> bot-webhook.js).
  // Starting the polling bot locally (bot.js) would auto-delete the
  // production webhook and silently break the bot. Do not re-add startBot().
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
