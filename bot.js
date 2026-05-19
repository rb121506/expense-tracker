// Telegram bot logic.
// Listens for commands and quick-log messages, writes to Neon Postgres via database.js.

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const { CATEGORIES, CATEGORY_KEYWORDS, CATEGORY_EMOJI, categorize } = require('./categories');

function formatRupees(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  let hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${hh}:${mm} ${ampm}`;
}

function parsePositiveAmount(value) {
  const text = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;

  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// In-memory conversation state for /add multi-step flow
const addState = new Map();

function startBot(token, ownerId) {
  if (!token || token === 'your_token_here') {
    console.warn('[BOT] TELEGRAM_BOT_TOKEN not set — bot is disabled. Update .env to enable.');
    return null;
  }

  if (!ownerId || ownerId === 'your_telegram_id_here') {
    console.warn('[BOT] MY_TELEGRAM_USER_ID not set — bot is disabled to keep expenses private.');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('[BOT] Telegram bot started (polling).');

  const allowed = (msg) => String(msg.from && msg.from.id) === String(ownerId);

  const reply = (msg, text, opts = {}) =>
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...opts });

  // ---------- /start ----------
  bot.onText(/^\/start$/, (msg) => {
    if (!allowed(msg)) return;
    reply(
      msg,
      `👋 *Welcome to your Expense Tracker!*\n\n` +
        `Just type \`amount description\` to log expenses fast.\n` +
        `Examples:\n` +
        `• \`150 lunch\`\n` +
        `• \`500 auto\`\n` +
        `• \`1200 gym\`\n\n` +
        `Type /help to see all commands.`
    );
  });

  // ---------- /help ----------
  bot.onText(/^\/help$/, (msg) => {
    if (!allowed(msg)) return;
    reply(
      msg,
      `*📖 Commands:*\n\n` +
        `/start — welcome message\n` +
        `/add — add an expense step-by-step\n` +
        `/summary — week & month totals\n` +
        `/today — today's expenses\n` +
        `/categories — spending by category\n` +
        `/budget — monthly budget usage\n` +
        `/setbudget [amount] — set monthly budget\n` +
        `/history — last 10 expenses\n` +
        `/delete [id] — delete an expense\n` +
        `/help — this menu\n\n` +
        `💡 *Quick log:* just send \`amount description\`\n` +
        `e.g. \`80 chai\``
    );
  });

  // ---------- /summary ----------
  bot.onText(/^\/summary$/, async (msg) => {
    if (!allowed(msg)) return;
    try {
      const week = await db.getWeeklyTotal();
      const month = await db.getMonthlyTotal();
      reply(
        msg,
        `📊 *Spending Summary*\n\n` +
          `📅 This week: *${formatRupees(week)}*\n` +
          `🗓️ This month: *${formatRupees(month)}*`
      );
    } catch (err) {
      console.error('[BOT] /summary error:', err);
      reply(msg, `❌ Error fetching summary`);
    }
  });

  // ---------- /today ----------
  bot.onText(/^\/today$/, async (msg) => {
    if (!allowed(msg)) return;
    try {
      const items = await db.getTodayExpenses();
      if (items.length === 0) {
        return reply(msg, `🌱 No expenses logged today. Nice!`);
      }
      const lines = items.map(
        (e) =>
          `• ${formatRupees(e.amount)} — ${e.description || '—'} _(${CATEGORY_EMOJI[e.category] || ''} ${e.category})_  \`#${e.id}\``
      );
      const total = items.reduce((s, e) => s + e.amount, 0);
      reply(msg, `📅 *Today's Expenses*\n\n${lines.join('\n')}\n\n*Total: ${formatRupees(total)}*`);
    } catch (err) {
      console.error('[BOT] /today error:', err);
      reply(msg, `❌ Error fetching today's expenses`);
    }
  });

  // ---------- /categories ----------
  bot.onText(/^\/categories$/, async (msg) => {
    if (!allowed(msg)) return;
    try {
      const rows = await db.getCategorySummary();
      if (rows.length === 0) return reply(msg, `No expenses this month yet.`);
      const total = rows.reduce((s, r) => s + r.total, 0);
      const lines = rows.map((r) => {
        const pct = total ? ((r.total / total) * 100).toFixed(0) : 0;
        return `${CATEGORY_EMOJI[r.category] || '📦'} *${r.category}* — ${formatRupees(r.total)} _(${pct}%)_`;
      });
      reply(msg, `📊 *Category Breakdown (${db.currentMonth()})*\n\n${lines.join('\n')}\n\n*Total: ${formatRupees(total)}*`);
    } catch (err) {
      console.error('[BOT] /categories error:', err);
      reply(msg, `❌ Error fetching categories`);
    }
  });

  // ---------- /budget ----------
  bot.onText(/^\/budget$/, async (msg) => {
    if (!allowed(msg)) return;
    try {
      const budget = await db.getBudget();
      const spent = await db.getMonthlyTotal();
      const remaining = budget - spent;
      const pct = budget ? ((spent / budget) * 100).toFixed(1) : 0;
      let warning = '';
      if (pct >= 100) warning = '\n\n🚨 *You are over budget!*';
      else if (pct >= 80) warning = '\n\n⚠️ *Warning: 80%+ of budget used.*';
      reply(
        msg,
        `💰 *Monthly Budget*\n\n` +
          `Budget: *${formatRupees(budget)}*\n` +
          `Spent: *${formatRupees(spent)}* (${pct}%)\n` +
          `Remaining: *${formatRupees(remaining)}*` +
          warning
      );
    } catch (err) {
      console.error('[BOT] /budget error:', err);
      reply(msg, `❌ Error fetching budget`);
    }
  });

  // ---------- /setbudget ----------
  bot.onText(/^\/setbudget(?:\s+(\d+(?:\.\d+)?))?$/, async (msg, match) => {
    if (!allowed(msg)) return;
    const amt = match[1] ? parsePositiveAmount(match[1]) : null;
    if (!amt) {
      return reply(msg, `Usage: \`/setbudget 5000\``);
    }
    try {
      await db.setBudget(amt);
      reply(msg, `✅ Monthly budget set to *${formatRupees(amt)}*`);
    } catch (err) {
      console.error('[BOT] /setbudget error:', err);
      reply(msg, `❌ Error setting budget`);
    }
  });

  // ---------- /history ----------
  bot.onText(/^\/history$/, async (msg) => {
    if (!allowed(msg)) return;
    try {
      const items = await db.getRecentExpenses(10);
      if (items.length === 0) return reply(msg, `No expenses logged yet.`);
      const lines = items.map(
        (e) =>
          `\`#${e.id}\` ${formatDate(e.date)} — ${formatRupees(e.amount)} ${e.description || '—'} _(${CATEGORY_EMOJI[e.category] || ''} ${e.category})_`
      );
      reply(msg, `📜 *Last 10 Expenses*\n\n${lines.join('\n')}`);
    } catch (err) {
      console.error('[BOT] /history error:', err);
      reply(msg, `❌ Error fetching history`);
    }
  });

  // ---------- /delete ----------
  bot.onText(/^\/delete(?:\s+(\d+))?$/, async (msg, match) => {
    if (!allowed(msg)) return;
    const id = match[1] ? parseInt(match[1], 10) : null;
    if (!id) return reply(msg, `Usage: \`/delete 12\` (the ID shown in /history)`);
    try {
      const ok = await db.deleteExpense(id);
      reply(msg, ok ? `🗑️ Deleted expense #${id}` : `❌ No expense with id #${id}`);
    } catch (err) {
      console.error('[BOT] /delete error:', err);
      reply(msg, `❌ Error deleting expense`);
    }
  });

  // ---------- /add (step-by-step) ----------
  bot.onText(/^\/add$/, (msg) => {
    if (!allowed(msg)) return;
    addState.set(msg.chat.id, { step: 'amount' });
    reply(msg, `💸 *Add Expense*\n\nStep 1: How much did you spend? (just type the number)`);
  });

  // ---------- Quick logging + multi-step continuation ----------
  bot.on('message', async (msg) => {
    if (!allowed(msg)) return;
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const state = addState.get(chatId);

    // ----- /add flow -----
    if (state) {
      try {
        if (state.step === 'amount') {
          const amt = parsePositiveAmount(msg.text);
          if (!amt) return reply(msg, `Please enter a valid number, e.g. \`150\``);
          state.amount = amt;
          state.step = 'category';
          const cats = CATEGORIES;
          return reply(
            msg,
            `Step 2: What category?\n\n${cats.map((c) => `• ${CATEGORY_EMOJI[c] || ''} ${c}`).join('\n')}\n\nJust type the category name.`
          );
        }
        if (state.step === 'category') {
          const input = msg.text.trim();
          const cats = CATEGORIES;
          const match = cats.find((c) => c.toLowerCase() === input.toLowerCase()) || categorize(input);
          state.category = match;
          state.step = 'description';
          return reply(msg, `Step 3: Short description? (or send "skip")`);
        }
        if (state.step === 'description') {
          const desc = msg.text.trim().toLowerCase() === 'skip' ? '' : msg.text.trim();
          const entry = await db.addExpense({
            amount: state.amount,
            category: state.category,
            description: desc,
            telegram_user_id: String(msg.from.id),
          });
          addState.delete(chatId);
          const today = await db.getTodayTotal();
          return reply(
            msg,
            `✅ Logged ${formatRupees(entry.amount)} for ${desc || state.category} under ${CATEGORY_EMOJI[state.category] || ''} *${state.category}*\n` +
              `📅 ${formatDate(entry.date)}, ${formatTime(entry.date)}\n\n` +
              `Today's total: *${formatRupees(today)}*`
          );
        }
      } catch (err) {
        console.error('[BOT] /add step error:', err);
        addState.delete(chatId);
        return reply(msg, `❌ Error saving expense. Try again.`);
      }
    }

    // ----- Quick log: "amount description" -----
    const quick = msg.text.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (quick) {
      try {
        const amount = parsePositiveAmount(quick[1]);
        if (!amount) return reply(msg, `Please start with a positive amount, e.g. \`150 lunch\``);

        const description = quick[2].trim();
        const category = categorize(description);
        const entry = await db.addExpense({
          amount,
          category,
          description,
          telegram_user_id: String(msg.from.id),
        });
        const today = await db.getTodayTotal();
        return reply(
          msg,
          `✅ Got it! Logged ${formatRupees(amount)} for *${description}* under ${CATEGORY_EMOJI[category] || ''} *${category}*\n` +
            `📅 ${formatDate(entry.date)}, ${formatTime(entry.date)}\n\n` +
            `Your total spending today: *${formatRupees(today)}*`
        );
      } catch (err) {
        console.error('[BOT] quick-log error:', err);
        return reply(msg, `❌ Error saving expense. Try again.`);
      }
    }

    reply(msg, `🤔 I didn't catch that. Try \`150 lunch\` or /help`);
  });

  bot.on('polling_error', (err) => {
    console.error('[BOT] polling_error:', err.code || err.message);
  });

  return bot;
}

module.exports = { startBot, categorize, CATEGORY_KEYWORDS, CATEGORY_EMOJI };
