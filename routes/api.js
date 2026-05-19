// REST API routes used by the web dashboard.

const express = require('express');
const db = require('../database');
const { CATEGORIES, isKnownCategory } = require('../categories');

const router = express.Router();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_DESCRIPTION_LENGTH = 240;

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

// GET /api/expenses/today
router.get('/expenses/today', async (req, res) => {
  try {
    res.json(await db.getTodayExpenses());
  } catch (err) {
    console.error('[API] GET /expenses/today error:', err);
    res.status(500).json({ error: 'Failed to fetch today\'s expenses' });
  }
});

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

module.exports = router;
