// Telegram bot webhook handler.
// Pure functions — no polling, no persistent state in memory.
// Designed to run in Vercel serverless (called from routes/api.js).

const db = require('./database');
const { CATEGORIES, CATEGORY_EMOJI, categorize } = require('./categories');

const OWNER_ID = () => process.env.MY_TELEGRAM_USER_ID || '';
const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';

function formatRupees(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
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

// Use https module (works on all Node versions, no fetch dependency)
const https = require('https');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Send a message via Telegram Bot API
async function sendMessage(chatId, text) {
  const token = BOT_TOKEN();
  if (!token) { console.error('[BOT] No bot token'); return; }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  // Try Markdown first
  let res = await httpsPost(url, { chat_id: chatId, text, parse_mode: 'Markdown' });

  // If Markdown fails (bad formatting), retry as plain text
  if (res.status !== 200) {
    console.error('[BOT] Markdown send failed:', res.body);
    res = await httpsPost(url, { chat_id: chatId, text });
  }

  if (res.status !== 200) {
    console.error('[BOT] Send failed:', res.status, res.body);
  }
}

// ---------- Command handlers ----------

async function cmdStart(chatId) {
  await sendMessage(chatId,
    `👋 *Welcome to your Expense Tracker!*\n\n` +
    `Just type \`amount description\` to log expenses fast.\n` +
    `Examples:\n• \`150 lunch\`\n• \`500 auto\`\n• \`1200 gym\`\n\n` +
    `Type /help to see all commands.`
  );
}

async function cmdHelp(chatId) {
  await sendMessage(chatId,
    `*📖 Commands:*\n\n` +
    `/start — welcome message\n` +
    `/add — add an expense step-by-step\n` +
    `/summary — week & month totals\n` +
    `/today — today's expenses\n` +
    `/digest — daily spending digest\n` +
    `/alerts — smart spending alerts\n` +
    `/categories — spending by category\n` +
    `/budget — monthly budget usage\n` +
    `/setbudget [amount] — set monthly budget\n` +
    `/history — last 10 expenses\n` +
    `/delete [id] — delete an expense\n` +
    `/help — this menu\n\n` +
    `💡 *Quick log:* just send \`amount description\`\n` +
    `e.g. \`80 chai\``
  );
}

async function cmdSummary(chatId) {
  const week = await db.getWeeklyTotal();
  const month = await db.getMonthlyTotal();
  await sendMessage(chatId,
    `📊 *Spending Summary*\n\n📅 This week: *${formatRupees(week)}*\n🗓️ This month: *${formatRupees(month)}*`
  );
}

async function cmdToday(chatId) {
  const items = await db.getTodayExpenses();
  if (items.length === 0) {
    return sendMessage(chatId, `🌱 No expenses logged today. Nice!`);
  }
  const lines = items.map(e =>
    `• ${formatRupees(e.amount)} — ${e.description || '—'} _(${CATEGORY_EMOJI[e.category] || ''} ${e.category})_  \`#${e.id}\``
  );
  const total = items.reduce((s, e) => s + e.amount, 0);
  await sendMessage(chatId, `📅 *Today's Expenses*\n\n${lines.join('\n')}\n\n*Total: ${formatRupees(total)}*`);
}

async function cmdCategories(chatId) {
  const rows = await db.getCategorySummary();
  if (rows.length === 0) return sendMessage(chatId, `No expenses this month yet.`);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const lines = rows.map(r => {
    const pct = total ? ((r.total / total) * 100).toFixed(0) : 0;
    return `${CATEGORY_EMOJI[r.category] || '📦'} *${r.category}* — ${formatRupees(r.total)} _(${pct}%)_`;
  });
  await sendMessage(chatId,
    `📊 *Category Breakdown (${db.currentMonth()})*\n\n${lines.join('\n')}\n\n*Total: ${formatRupees(total)}*`
  );
}

async function cmdBudget(chatId) {
  const budget = await db.getBudget();
  const spent = await db.getMonthlyTotal();
  const remaining = budget - spent;
  const pct = budget ? ((spent / budget) * 100).toFixed(1) : 0;
  let warning = '';
  if (pct >= 100) warning = '\n\n🚨 *You are over budget!*';
  else if (pct >= 80) warning = '\n\n⚠️ *Warning: 80%+ of budget used.*';
  await sendMessage(chatId,
    `💰 *Monthly Budget*\n\nBudget: *${formatRupees(budget)}*\nSpent: *${formatRupees(spent)}* (${pct}%)\nRemaining: *${formatRupees(remaining)}*` + warning
  );
}

async function cmdSetBudget(chatId, amountStr) {
  const amt = parsePositiveAmount(amountStr);
  if (!amt) return sendMessage(chatId, `Usage: \`/setbudget 5000\``);
  await db.setBudget(amt);
  await sendMessage(chatId, `✅ Monthly budget set to *${formatRupees(amt)}*`);
}

async function cmdDigest(chatId) {
  const todayTotal = await db.getTodayTotal();
  const weekTotal = await db.getWeeklyTotal();
  const monthTotal = await db.getMonthlyTotal();
  const budget = await db.getBudget();
  const remaining = budget - monthTotal;
  const pct = budget ? ((monthTotal / budget) * 100).toFixed(0) : 0;
  const todayItems = await db.getTodayExpenses();
  const topToday = todayItems.slice(0, 3).map(e =>
    `  • ${formatRupees(e.amount)} — ${e.description || e.category}`
  ).join('\n');
  await sendMessage(chatId,
    `📋 *Daily Digest*\n\n💰 Today: *${formatRupees(todayTotal)}*${todayItems.length ? '\n' + topToday : ''}\n\n` +
    `📅 This week: *${formatRupees(weekTotal)}*\n🗓️ This month: *${formatRupees(monthTotal)}* (${pct}% of budget)\n` +
    `${remaining >= 0 ? `✅ Remaining: *${formatRupees(remaining)}*` : `🚨 Over budget by *${formatRupees(-remaining)}*`}`
  );
}

async function cmdAlerts(chatId) {
  const messages = [];
  const budget = await db.getBudget();
  const monthTotal = await db.getMonthlyTotal();
  const pct = budget ? (monthTotal / budget) * 100 : 0;
  if (pct >= 100) {
    messages.push(`🚨 *Over budget!* ${formatRupees(monthTotal)} of ${formatRupees(budget)} spent (${pct.toFixed(0)}%)`);
  } else if (pct >= 80) {
    messages.push(`⚠️ *Budget warning:* ${pct.toFixed(0)}% used — ${formatRupees(budget - monthTotal)} left`);
  }
  const thisWeek = await db.getThisWeekByCategory();
  const avgWeek = await db.getWeeklyAvgByCategory(4);
  for (const tw of thisWeek) {
    const avg = avgWeek.find(a => a.category === tw.category);
    if (avg && avg.weeklyAvg > 0) {
      const ratio = tw.total / avg.weeklyAvg;
      if (ratio >= 1.5 && tw.total > 100) {
        messages.push(`📈 *${tw.category}:* ${formatRupees(tw.total)} this week — ${ratio.toFixed(1)}× your avg (${formatRupees(Math.round(avg.weeklyAvg))})`);
      }
    }
  }
  const upcoming = await db.getUpcomingRecurring(3);
  for (const r of upcoming) {
    if (r.dueIn === 0) {
      messages.push(`🔔 *${r.description || r.category}* of ${formatRupees(r.amount)} is *due today*`);
    } else {
      messages.push(`📌 *${r.description || r.category}* of ${formatRupees(r.amount)} due in *${r.dueIn} day${r.dueIn > 1 ? 's' : ''}*`);
    }
  }
  if (messages.length === 0) {
    await sendMessage(chatId, `✅ *No alerts* — everything looks good! 🎉`);
  } else {
    await sendMessage(chatId, `🔔 *Smart Alerts*\n\n${messages.join('\n\n')}`);
  }
}

async function cmdHistory(chatId) {
  const items = await db.getRecentExpenses(10);
  if (items.length === 0) return sendMessage(chatId, `No expenses logged yet.`);
  const lines = items.map(e =>
    `\`#${e.id}\` ${formatDate(e.date)} — ${formatRupees(e.amount)} ${e.description || '—'} _(${CATEGORY_EMOJI[e.category] || ''} ${e.category})_`
  );
  await sendMessage(chatId, `📜 *Last 10 Expenses*\n\n${lines.join('\n')}`);
}

async function cmdDelete(chatId, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return sendMessage(chatId, `Usage: \`/delete 12\` (the ID shown in /history)`);
  const ok = await db.deleteExpense(id);
  await sendMessage(chatId, ok ? `🗑️ Deleted expense #${id}` : `❌ No expense with id #${id}`);
}

// ---------- /add multi-step (DB-backed state) ----------

async function cmdAdd(chatId) {
  await db.setChatState(chatId, { step: 'amount' });
  await sendMessage(chatId, `💸 *Add Expense*\n\nStep 1: How much did you spend? (just type the number)`);
}

async function handleAddFlow(chatId, text, userId) {
  const state = await db.getChatState(chatId);
  if (!state) return false;

  if (state.step === 'amount') {
    const amt = parsePositiveAmount(text);
    if (!amt) {
      await sendMessage(chatId, `Please enter a valid number, e.g. \`150\``);
      return true;
    }
    await db.setChatState(chatId, { step: 'category', amount: amt });
    const cats = CATEGORIES.map(c => `• ${CATEGORY_EMOJI[c] || ''} ${c}`).join('\n');
    await sendMessage(chatId, `Step 2: What category?\n\n${cats}\n\nJust type the category name.`);
    return true;
  }

  if (state.step === 'category') {
    const match = CATEGORIES.find(c => c.toLowerCase() === text.toLowerCase()) || categorize(text);
    await db.setChatState(chatId, { step: 'description', amount: state.amount, category: match });
    await sendMessage(chatId, `Step 3: Short description? (or send "skip")`);
    return true;
  }

  if (state.step === 'description') {
    const desc = text.toLowerCase() === 'skip' ? '' : text;
    const entry = await db.addExpense({
      amount: state.amount,
      category: state.category,
      description: desc,
      telegram_user_id: String(userId),
    });
    await db.deleteChatState(chatId);
    const today = await db.getTodayTotal();
    await sendMessage(chatId,
      `✅ Logged ${formatRupees(entry.amount)} for ${desc || state.category} under ${CATEGORY_EMOJI[state.category] || ''} *${state.category}*\n` +
      `📅 ${formatDate(entry.date)}, ${formatTime(entry.date)}\n\nToday's total: *${formatRupees(today)}*`
    );
    return true;
  }

  // Unknown state — clear it
  await db.deleteChatState(chatId);
  return false;
}

// ---------- Quick log ----------

async function quickLog(chatId, amount, description, userId) {
  const category = categorize(description);
  const entry = await db.addExpense({
    amount,
    category,
    description,
    telegram_user_id: String(userId),
  });
  const today = await db.getTodayTotal();
  await sendMessage(chatId,
    `✅ Got it! Logged ${formatRupees(amount)} for *${description}* under ${CATEGORY_EMOJI[category] || ''} *${category}*\n` +
    `📅 ${formatDate(entry.date)}, ${formatTime(entry.date)}\n\nYour total spending today: *${formatRupees(today)}*`
  );
}

// ---------- Main update handler ----------

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const ownerId = OWNER_ID();
  const userId = String(msg.from && msg.from.id);
  if (!ownerId || userId !== ownerId) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  try {
    // Commands
    if (text === '/start') return cmdStart(chatId);
    if (text === '/help') return cmdHelp(chatId);
    if (text === '/summary') return cmdSummary(chatId);
    if (text === '/today') return cmdToday(chatId);
    if (text === '/categories') return cmdCategories(chatId);
    if (text === '/budget') return cmdBudget(chatId);
    if (text === '/digest') return cmdDigest(chatId);
    if (text === '/alerts') return cmdAlerts(chatId);
    if (text === '/history') return cmdHistory(chatId);
    if (text === '/add') return cmdAdd(chatId);

    // /setbudget <amount>
    const setBudgetMatch = text.match(/^\/setbudget(?:\s+(\d+(?:\.\d+)?))?$/);
    if (setBudgetMatch) return cmdSetBudget(chatId, setBudgetMatch[1]);

    // /delete <id>
    const deleteMatch = text.match(/^\/delete(?:\s+(\d+))?$/);
    if (deleteMatch) return cmdDelete(chatId, deleteMatch[1]);

    // Skip other commands
    if (text.startsWith('/')) return;

    // Check /add multi-step flow
    const handled = await handleAddFlow(chatId, text, userId);
    if (handled) return;

    // Quick log: "amount description"
    const quick = text.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (quick) {
      const amount = parsePositiveAmount(quick[1]);
      if (!amount) return sendMessage(chatId, `Please start with a positive amount, e.g. \`150 lunch\``);
      return quickLog(chatId, amount, quick[2].trim(), userId);
    }

    await sendMessage(chatId, `🤔 I didn't catch that. Try \`150 lunch\` or /help`);
  } catch (err) {
    console.error('[BOT-WEBHOOK] Error handling update:', err);
    await sendMessage(chatId, `❌ Something went wrong. Try again.`).catch(() => {});
  }
}

module.exports = { handleUpdate, sendMessage };
