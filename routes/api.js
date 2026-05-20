// REST API routes used by the web dashboard.

const express = require('express');
const db = require('../database');
const { CATEGORIES, isKnownCategory } = require('../categories');

const router = express.Router();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_DESCRIPTION_LENGTH = 240;

// --------- Auth middleware ---------
const PASSCODE = process.env.DASHBOARD_PASSCODE || '';

function authMiddleware(req, res, next) {
  if (!PASSCODE) return next(); // no passcode set = open
  // Check header
  if (req.headers['x-passcode'] === PASSCODE) return next();
  // Check query param (for CSV export and similar)
  if (req.query._passcode === PASSCODE) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Auth check endpoint (before auth middleware on other routes)
router.get('/auth/check', (_req, res) => {
  res.json({ required: !!PASSCODE });
});

router.post('/auth/login', express.json(), (req, res) => {
  const { passcode } = req.body || {};
  if (!PASSCODE) return res.json({ ok: true });
  if (passcode === PASSCODE) {
    res.json({ ok: true, token: PASSCODE });
  } else {
    res.status(401).json({ error: 'Wrong passcode' });
  }
});

// Apply auth to all routes below
router.use(authMiddleware);

// --------- Validation helpers ---------
function parsePositiveNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parsePositiveInteger(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getMonthOrError(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const month = String(value);
  return MONTH_RE.test(month) ? month : null;
}

function isValidDateOnly(date) {
  if (!DATE_RE.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function normalizeExpenseDate(value) {
  if (!value) return undefined;

  const date = String(value).trim();
  if (DATE_RE.test(date)) {
    if (!isValidDateOnly(date)) return null;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${date}T${hh}:${mm}:${ss}`;
  }

  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// --------- Expense routes ---------

// GET /api/expenses?month=YYYY-MM
router.get('/expenses', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, undefined);
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const rows = await db.getExpenses({ month });
    res.json(rows);
  } catch (err) {
    console.error('[API] GET /expenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// GET /api/expenses/search?month=&category=&dateFrom=&dateTo=&amountMin=&amountMax=&search=&limit=
router.get('/expenses/search', async (req, res) => {
  try {
    const { month, category, dateFrom, dateTo, amountMin, amountMax, search, limit } = req.query;
    const rows = await db.searchExpenses({
      month: month || undefined,
      category: category || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      search: search || undefined,
      limit: limit ? Number(limit) : 100,
    });
    res.json(rows);
  } catch (err) {
    console.error('[API] GET /expenses/search error:', err);
    res.status(500).json({ error: 'Failed to search expenses' });
  }
});

// GET /api/expenses/today
router.get('/expenses/today', async (req, res) => {
  try {
    res.json(await db.getTodayExpenses());
  } catch (err) {
    console.error('[API] GET /expenses/today error:', err);
    res.status(500).json({ error: 'Failed to fetch today\'s expenses' });
  }
});

// GET /api/expenses/export?month=&category=&dateFrom=&dateTo=&amountMin=&amountMax=&search=
router.get('/expenses/export', async (req, res) => {
  try {
    const { month, category, dateFrom, dateTo, amountMin, amountMax, search } = req.query;
    const rows = await db.searchExpenses({
      month: month || undefined,
      category: category || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      search: search || undefined,
    });

    // Build CSV
    const header = 'Date,Amount,Category,Description';
    const csvRows = rows.map(r => {
      const date = r.date ? r.date.slice(0, 10) : '';
      const desc = String(r.description || '').replace(/"/g, '""');
      return `${date},${r.amount},"${r.category}","${desc}"`;
    });
    const csv = [header, ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${month || 'all'}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[API] GET /expenses/export error:', err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// POST /api/expenses
router.post('/expenses', async (req, res) => {
  try {
    const { amount, category, description, date } = req.body || {};
    const amt = parsePositiveNumber(amount);
    if (!amt) return res.status(400).json({ error: 'amount must be a positive number' });

    const categoryValue = String(category || '').trim();
    if (!categoryValue) return res.status(400).json({ error: 'category is required' });
    if (!isKnownCategory(categoryValue)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }

    const descriptionValue = String(description || '').trim();
    if (descriptionValue.length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
    }

    const dateValue = normalizeExpenseDate(date);
    if (dateValue === null) return res.status(400).json({ error: 'date must be a valid date' });

    const entry = await db.addExpense({
      amount: amt,
      category: categoryValue,
      description: descriptionValue,
      date: dateValue,
      telegram_user_id: null,
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error('[API] POST /expenses error:', err);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

// POST /api/expenses/import
router.post('/expenses/import', async (req, res) => {
  try {
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array' });
    }
    if (entries.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 entries per import' });
    }

    // Validate all entries first
    const validated = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const amt = parsePositiveNumber(e.amount);
      if (!amt) return res.status(400).json({ error: `Row ${i + 1}: invalid amount` });

      const cat = String(e.category || '').trim();
      if (!isKnownCategory(cat)) return res.status(400).json({ error: `Row ${i + 1}: invalid category "${cat}"` });

      const dateValue = normalizeExpenseDate(e.date);
      if (dateValue === null) return res.status(400).json({ error: `Row ${i + 1}: invalid date` });

      validated.push({
        amount: amt,
        category: cat,
        description: String(e.description || '').trim().slice(0, MAX_DESCRIPTION_LENGTH),
        date: dateValue,
      });
    }

    const results = await db.bulkAddExpenses(validated);
    res.status(201).json({ ok: true, imported: results.length });
  } catch (err) {
    console.error('[API] POST /expenses/import error:', err);
    res.status(500).json({ error: 'Failed to import expenses' });
  }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const { amount, category, description, date } = req.body || {};

    // Validate fields if provided
    let amt = undefined;
    if (amount !== undefined) {
      amt = parsePositiveNumber(amount);
      if (!amt) return res.status(400).json({ error: 'amount must be a positive number' });
    }

    if (category !== undefined) {
      const cat = String(category).trim();
      if (!isKnownCategory(cat)) return res.status(400).json({ error: `invalid category` });
    }

    if (description !== undefined && String(description).length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({ error: `description too long` });
    }

    let dateValue = undefined;
    if (date !== undefined) {
      dateValue = normalizeExpenseDate(date);
      if (dateValue === null) return res.status(400).json({ error: 'invalid date' });
    }

    const updated = await db.updateExpense(id, {
      amount: amt,
      category: category ? String(category).trim() : undefined,
      description: description !== undefined ? String(description).trim() : undefined,
      date: dateValue,
    });

    if (!updated) return res.status(404).json({ error: 'expense not found' });
    res.json(updated);
  } catch (err) {
    console.error('[API] PUT /expenses/:id error:', err);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const ok = await db.deleteExpense(id);
    if (!ok) return res.status(404).json({ error: 'expense not found' });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[API] DELETE /expenses/:id error:', err);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// --------- Summary routes ---------

// GET /api/summary?month=YYYY-MM
router.get('/summary', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const byCategory = await db.getCategorySummary(month);
    const byDay = await db.getDailySummary(month);
    const total = byCategory.reduce((s, r) => s + r.total, 0);
    res.json({
      month,
      total,
      count: byCategory.reduce((s, r) => s + r.count, 0),
      byCategory,
      byDay,
    });
  } catch (err) {
    console.error('[API] GET /summary error:', err);
    res.status(500).json({ error: 'Failed to build summary' });
  }
});

// GET /api/summary/today
router.get('/summary/today', async (_req, res) => {
  try {
    const byCategory = await db.getTodayCategorySummary();
    const total = byCategory.reduce((s, r) => s + r.total, 0);
    const count = byCategory.reduce((s, r) => s + r.count, 0);
    const expenses = await db.getTodayExpenses();
    res.json({ total, count, byCategory, expenses });
  } catch (err) {
    console.error('[API] GET /summary/today error:', err);
    res.status(500).json({ error: 'Failed to build today summary' });
  }
});

// GET /api/summary/week
router.get('/summary/week', async (_req, res) => {
  try {
    const byCategory = await db.getWeekCategorySummary();
    const byDay = await db.getWeekDailySummary();
    const total = byCategory.reduce((s, r) => s + r.total, 0);
    const count = byCategory.reduce((s, r) => s + r.count, 0);
    const expenses = await db.getWeekExpenses();
    res.json({ total, count, byCategory, byDay, expenses });
  } catch (err) {
    console.error('[API] GET /summary/week error:', err);
    res.status(500).json({ error: 'Failed to build week summary' });
  }
});

// GET /api/insights?month=YYYY-MM
router.get('/insights', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const insights = await db.getInsights(month);
    res.json(insights);
  } catch (err) {
    console.error('[API] GET /insights error:', err);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// --------- Budget routes ---------

// GET /api/budget
router.get('/budget', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const budget = await db.getBudget(month);
    const spent = await db.getMonthlyTotal(month);
    res.json({
      month,
      budget,
      spent,
      remaining: budget - spent,
      percent: budget ? (spent / budget) * 100 : 0,
    });
  } catch (err) {
    console.error('[API] GET /budget error:', err);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// PUT /api/budget  body: { amount, month? }
router.put('/budget', async (req, res) => {
  try {
    const { amount, month } = req.body || {};
    const amt = parsePositiveNumber(amount);
    if (!amt) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const targetMonth = getMonthOrError(month, db.currentMonth());
    if (targetMonth === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    await db.setBudget(amt, targetMonth);
    res.json({ ok: true, amount: amt, month: targetMonth });
  } catch (err) {
    console.error('[API] PUT /budget error:', err);
    res.status(500).json({ error: 'Failed to set budget' });
  }
});

// --------- Category budget routes ---------

// GET /api/category-budgets?month=YYYY-MM
router.get('/category-budgets', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const budgets = await db.getCategoryBudgets(month);
    const summary = await db.getCategorySummary(month);

    // Merge spent amounts into budgets
    const result = budgets.map(b => {
      const spent = summary.find(s => s.category === b.category);
      return {
        category: b.category,
        budget: b.budget,
        spent: spent ? spent.total : 0,
        percent: spent && b.budget ? Math.round((spent.total / b.budget) * 100 * 10) / 10 : 0,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('[API] GET /category-budgets error:', err);
    res.status(500).json({ error: 'Failed to fetch category budgets' });
  }
});

// PUT /api/category-budgets  body: { category, budget, month? }
router.put('/category-budgets', async (req, res) => {
  try {
    const { category, budget, month } = req.body || {};
    if (!category || !isKnownCategory(category)) {
      return res.status(400).json({ error: 'valid category is required' });
    }
    const amt = parsePositiveNumber(budget);
    if (!amt) return res.status(400).json({ error: 'budget must be a positive number' });

    const targetMonth = getMonthOrError(month, db.currentMonth());
    if (targetMonth === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    await db.setCategoryBudget(category, amt, targetMonth);
    res.json({ ok: true, category, budget: amt, month: targetMonth });
  } catch (err) {
    console.error('[API] PUT /category-budgets error:', err);
    res.status(500).json({ error: 'Failed to set category budget' });
  }
});

// DELETE /api/category-budgets/:category?month=YYYY-MM
router.delete('/category-budgets/:category', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    await db.deleteCategoryBudget(req.params.category, month);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API] DELETE /category-budgets error:', err);
    res.status(500).json({ error: 'Failed to delete category budget' });
  }
});

// --------- Alerts route ---------

router.get('/alerts', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const [todayTotal, weekTotal, monthTotal, budget, thisWeek, avgWeek, upcoming] = await Promise.all([
      db.getTodayTotal(),
      db.getWeeklyTotal(),
      db.getMonthlyTotal(month),
      db.getBudget(month),
      db.getThisWeekByCategory(),
      db.getWeeklyAvgByCategory(4),
      db.getUpcomingRecurring(3),
    ]);

    // Daily digest
    const dailyDigest = {
      todaySpent: todayTotal,
      weekSpent: weekTotal,
      monthSpent: monthTotal,
      budget,
      monthRemaining: budget - monthTotal,
      budgetPercent: budget ? Math.round((monthTotal / budget) * 100) : 0,
    };

    // Unusual spending: current week vs 4-week average
    const unusualSpending = [];
    for (const tw of thisWeek) {
      const avg = avgWeek.find(a => a.category === tw.category);
      if (avg && avg.weeklyAvg > 0) {
        const ratio = tw.total / avg.weeklyAvg;
        if (ratio >= 1.5 && tw.total > 100) {
          unusualSpending.push({
            category: tw.category,
            thisWeek: Math.round(tw.total),
            weeklyAvg: Math.round(avg.weeklyAvg),
            ratio: Math.round(ratio * 10) / 10,
          });
        }
      }
    }

    // Recurring reminders
    const recurringReminders = upcoming.map(r => ({
      description: r.description || r.category,
      amount: r.amount,
      dueIn: r.dueIn,
      dayOfMonth: r.day_of_month,
    }));

    res.json({ dailyDigest, unusualSpending, recurringReminders });
  } catch (err) {
    console.error('[API] GET /alerts error:', err);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// --------- Report data route ---------

router.get('/report-data', async (req, res) => {
  try {
    const month = getMonthOrError(req.query.month, db.currentMonth());
    if (month === null) return res.status(400).json({ error: 'month must be in YYYY-MM format' });

    const [summary, budget, byDay, topMerchants, trend, catBudgets, insights] = await Promise.all([
      db.getCategorySummary(month),
      db.getBudget(month),
      db.getDailySummary(month),
      db.getTopMerchants(month, 5),
      db.getMonthlyTrend(6),
      db.getCategoryBudgets(month),
      db.getInsights(month),
    ]);

    const total = summary.reduce((s, r) => s + r.total, 0);
    const count = summary.reduce((s, r) => s + r.count, 0);

    // Merge spent into category budgets
    const catBudgetsMerged = catBudgets.map(b => {
      const spent = summary.find(s => s.category === b.category);
      return {
        category: b.category,
        budget: b.budget,
        spent: spent ? spent.total : 0,
      };
    });

    res.json({
      month,
      total,
      count,
      budget,
      remaining: budget - total,
      byCategory: summary,
      byDay,
      topMerchants,
      trend,
      categoryBudgets: catBudgetsMerged,
      insights,
    });
  } catch (err) {
    console.error('[API] GET /report-data error:', err);
    res.status(500).json({ error: 'Failed to generate report data' });
  }
});

// --------- AI Chat route ---------

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

// Rate limiter: 20 requests/hour per IP
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup stale rate limit entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW) rateLimitMap.delete(ip);
  }
}, 10 * 60 * 1000);

const DANGEROUS_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|INTO\s+OUTFILE|LOAD_FILE|COPY|pg_sleep|pg_read|information_schema)\b/i;

function validateSQL(sql) {
  if (!sql || typeof sql !== 'string') return false;
  const trimmed = sql.trim();
  if (!trimmed.toUpperCase().startsWith('SELECT')) return false;
  if (DANGEROUS_SQL.test(trimmed)) return false;
  if (trimmed.includes(';')) return false;
  return true;
}

function buildSystemPrompt() {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return `You are a SQL assistant for a personal expense tracker. Generate PostgreSQL SELECT queries.

Schema:
- expenses (id SERIAL, amount NUMERIC, category TEXT, description TEXT, date TEXT, month TEXT)
  date: ISO string "2026-05-18T22:20:01.000Z", month: "YYYY-MM"
  categories: ${CATEGORIES.join(', ')}
- budgets (id SERIAL, monthly_budget NUMERIC, month TEXT UNIQUE)
- category_budgets (id SERIAL, category TEXT, budget NUMERIC, month TEXT)

Today: ${todayISO}
Current month: ${curMonth}

Rules:
1. ONLY generate SELECT queries. Never modify data.
2. Filter by month column: WHERE month = 'YYYY-MM'
3. Filter by date: substring(date, 1, 10) for comparisons
4. Add LIMIT 50 for row queries (not for aggregates).
5. Default to current month if user doesn't specify a time period.
6. Use SUM(amount), COUNT(*), AVG(amount) for totals/averages.
7. For "this week", use substring(date, 1, 10) >= '${todayISO.slice(0, 8)}${String(today.getDate() - today.getDay()).padStart(2, '0')}'
8. For "today", use substring(date, 1, 10) = '${todayISO}'

Respond with ONLY valid JSON (no markdown fences): {"sql": "SELECT ...", "explanation": "brief answer description"}
If not answerable with SQL: {"sql": null, "explanation": "reason"}`;
}

async function callGemini(question, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return JSON.parse(text);
}

function tryFallback(question) {
  const q = question.toLowerCase();
  const curMonth = db.currentMonth();
  const today = db.todayISO();
  if (q.includes('today') && (q.includes('spend') || q.includes('total') || q.includes('how much'))) {
    return { sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substring(date, 1, 10) = '${today}'`, explanation: "Today's total spending" };
  }
  if ((q.includes('month') || q.includes('total')) && (q.includes('spend') || q.includes('how much'))) {
    return { sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE month = '${curMonth}'`, explanation: "This month's total spending" };
  }
  if (q.includes('budget')) {
    return { sql: `SELECT monthly_budget AS budget FROM budgets WHERE month = '${curMonth}'`, explanation: "Current monthly budget" };
  }
  if (q.includes('categor')) {
    return { sql: `SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE month = '${curMonth}' GROUP BY category ORDER BY total DESC`, explanation: "Category breakdown this month" };
  }
  if (q.includes('most expensive') || q.includes('highest') || q.includes('biggest')) {
    return { sql: `SELECT description, amount, category, substring(date, 1, 10) AS date FROM expenses WHERE month = '${curMonth}' ORDER BY amount DESC LIMIT 5`, explanation: "Top 5 most expensive items this month" };
  }
  return null;
}

function formatAnswer(explanation, rows) {
  if (!rows || rows.length === 0) return 'No expenses found matching that query.';

  if (rows.length === 1 && Object.keys(rows[0]).length <= 3) {
    const parts = Object.entries(rows[0]).map(([k, v]) => {
      const num = Number(v);
      if (!isNaN(num) && (k.includes('total') || k.includes('amount') || k.includes('avg') || k.includes('sum') || k.includes('budget') || k.includes('spent'))) {
        return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      }
      return String(v);
    });
    return `${explanation}: ${parts.join(' · ')}`;
  }
  return `${explanation} (${rows.length} result${rows.length !== 1 ? 's' : ''})`;
}

router.post('/ask', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ answer: 'Rate limit reached (20/hour). Try again later.', sql: null, data: null });
    }

    const { question } = req.body || {};
    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return res.status(400).json({ answer: 'Please ask a question about your expenses.', sql: null, data: null });
    }
    if (question.length > 500) {
      return res.status(400).json({ answer: 'Question too long (max 500 characters).', sql: null, data: null });
    }

    let geminiResult;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('No API key configured in Vercel. Please check your Environment Variables.');
      geminiResult = await callGemini(question.trim(), apiKey);
    } catch (err) {
      console.error('[API] Gemini error:', err.message);
      geminiResult = tryFallback(question.trim());
      if (!geminiResult) {
        return res.json({
          answer: `I encountered an error: ${err.message}. If this says "API key not valid", you may have pasted a typo in Vercel!`,
          sql: null,
          data: null,
        });
      }
    }

    if (!geminiResult.sql) {
      return res.json({
        answer: geminiResult.explanation || "I can only answer questions about your expenses.",
        sql: null,
        data: null,
      });
    }

    if (!validateSQL(geminiResult.sql)) {
      console.warn('[API] SQL rejected:', geminiResult.sql);
      return res.json({
        answer: "I couldn't understand that. Try rephrasing your question.",
        sql: null,
        data: null,
      });
    }

    // Execute with 5s timeout
    const pool = db.getPool();
    const result = await Promise.race([
      pool.query(geminiResult.sql),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const rows = (result.rows || []).map(r => {
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      }
      return row;
    });

    res.json({
      answer: formatAnswer(geminiResult.explanation, rows),
      sql: geminiResult.sql,
      data: rows.length <= 50 ? rows : rows.slice(0, 50),
    });
  } catch (err) {
    console.error('[API] POST /ask error:', err);
    res.json({
      answer: "Something went wrong. Try rephrasing your question.",
      sql: null,
      data: null,
    });
  }
});

// --------- Recurring expense routes ---------

// GET /api/recurring
router.get('/recurring', async (_req, res) => {
  try {
    res.json(await db.getRecurringExpenses());
  } catch (err) {
    console.error('[API] GET /recurring error:', err);
    res.status(500).json({ error: 'Failed to fetch recurring expenses' });
  }
});

// POST /api/recurring
router.post('/recurring', async (req, res) => {
  try {
    const { amount, category, description, day_of_month } = req.body || {};
    const amt = parsePositiveNumber(amount);
    if (!amt) return res.status(400).json({ error: 'amount must be a positive number' });

    if (!category || !isKnownCategory(String(category).trim())) {
      return res.status(400).json({ error: 'valid category is required' });
    }

    const day = Number(day_of_month) || 1;
    if (day < 1 || day > 28) return res.status(400).json({ error: 'day_of_month must be 1-28' });

    const entry = await db.addRecurringExpense({
      amount: amt,
      category: String(category).trim(),
      description: String(description || '').trim(),
      day_of_month: day,
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error('[API] POST /recurring error:', err);
    res.status(500).json({ error: 'Failed to add recurring expense' });
  }
});

// PUT /api/recurring/:id
router.put('/recurring/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const { active } = req.body || {};
    const updated = await db.updateRecurringExpense(id, {
      active: active !== undefined ? !!active : undefined,
    });
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json(updated);
  } catch (err) {
    console.error('[API] PUT /recurring/:id error:', err);
    res.status(500).json({ error: 'Failed to update recurring expense' });
  }
});

// DELETE /api/recurring/:id
router.delete('/recurring/:id', async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const ok = await db.deleteRecurringExpense(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[API] DELETE /recurring/:id error:', err);
    res.status(500).json({ error: 'Failed to delete recurring expense' });
  }
});

module.exports = router;
