// Main entry point: starts the Express server and the Telegram bot.

require('dotenv').config();
const path = require('path');
const express = require('express');

const apiRouter = require('./routes/api');
const { startBot } = require('./bot');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.MY_TELEGRAM_USER_ID;

const app = express();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// simple request logger
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// ---------- Routes ----------
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

// 404 fallback for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Start servers ----------
app.listen(PORT, () => {
  console.log(`\n💰 Expense Tracker running:`);
  console.log(`   Dashboard:  http://localhost:${PORT}`);
  console.log(`   API base:   http://localhost:${PORT}/api`);
});

startBot(TOKEN, OWNER_ID);
