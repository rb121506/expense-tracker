// REST API routes used by the web dashboard.

const express = require('express');
const db = require('../database');

const router = express.Router();

// GET /api/expenses?month=YYYY-MM
router.get('/expenses', async (req, res) => {
  try {
    const { month } = req.query;
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
    const month = req.query.month || db.currentMonth();
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
    const month = req.query.month || db.currentMonth();
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
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    await db.setBudget(amt, month || db.currentMonth());
    res.json({ ok: true, amount: amt, month: month || db.currentMonth() });
  } catch (err) {
    console.error('[API] PUT /budget error:', err);
    res.status(500).json({ error: 'Failed to set budget' });
  }
});

// POST /api/expenses
router.post('/expenses', async (req, res) => {
  try {
    const { amount, category, description, date } = req.body || {};
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
    if (!category) return res.status(400).json({ error: 'category is required' });

    let dateValue = date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const now = new Date();
      const dt = new Date(date);
      dt.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      dateValue = dt.toISOString();
    }

    const entry = await db.addExpense({
      amount: amt,
      category,
      description: description || '',
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
    const id = parseInt(req.params.id, 10);
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
