// SQLite database setup using Node.js built-in node:sqlite (stable in Node 24).
// No native compilation required.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'expenses.db');
const db = new DatabaseSync(DB_PATH);

// WAL mode for better write performance
db.exec('PRAGMA journal_mode = WAL');

// ---------- Schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    month TEXT NOT NULL,
    telegram_user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monthly_budget REAL NOT NULL,
    month TEXT NOT NULL UNIQUE
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
`);

console.log('[DB] Database ready at', DB_PATH);

// ---------- Helpers ----------
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Expense queries ----------
function addExpense({ amount, category, description, date, telegram_user_id }) {
  const dateValue = date || new Date().toISOString();
  const month = dateValue.slice(0, 7);
  const stmt = db.prepare(
    'INSERT INTO expenses (amount, category, description, date, month, telegram_user_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const info = stmt.run(amount, category, description || '', dateValue, month, telegram_user_id || null);
  return { id: info.lastInsertRowid, amount, category, description, date: dateValue, month };
}

function getExpenses({ month } = {}) {
  if (month) {
    return db.prepare('SELECT * FROM expenses WHERE month = ? ORDER BY date DESC').all(month);
  }
  return db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();
}

function getTodayExpenses() {
  const today = todayISO();
  return db.prepare("SELECT * FROM expenses WHERE substr(date, 1, 10) = ? ORDER BY date DESC").all(today);
}

function getRecentExpenses(limit = 10) {
  return db.prepare('SELECT * FROM expenses ORDER BY date DESC LIMIT ?').all(limit);
}

function deleteExpense(id) {
  const info = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  return info.changes > 0;
}

function getMonthlyTotal(month = currentMonth()) {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE month = ?').get(month);
  return row.total;
}

function getWeeklyTotal() {
  const row = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= datetime('now', '-7 days', 'localtime')"
  ).get();
  return row.total;
}

function getTodayTotal() {
  const today = todayISO();
  const row = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substr(date, 1, 10) = ?"
  ).get(today);
  return row.total;
}

function getCategorySummary(month = currentMonth()) {
  return db.prepare(
    'SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE month = ? GROUP BY category ORDER BY total DESC'
  ).all(month);
}

function getTodayCategorySummary() {
  const today = todayISO();
  return db.prepare(
    "SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE substr(date, 1, 10) = ? GROUP BY category ORDER BY total DESC"
  ).all(today);
}

function getWeekCategorySummary() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const from = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  return db.prepare(
    "SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE substr(date, 1, 10) >= ? GROUP BY category ORDER BY total DESC"
  ).all(from);
}

function getWeekExpenses() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const from = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  return db.prepare(
    "SELECT * FROM expenses WHERE substr(date, 1, 10) >= ? ORDER BY date DESC"
  ).all(from);
}

function getWeekDailySummary() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const from = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  return db.prepare(
    "SELECT substr(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substr(date, 1, 10) >= ? GROUP BY day ORDER BY day ASC"
  ).all(from);
}

function getDailySummary(month = currentMonth()) {
  return db.prepare(
    "SELECT substr(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE month = ? GROUP BY day ORDER BY day ASC"
  ).all(month);
}

// ---------- Budget queries ----------
function getBudget(month = currentMonth()) {
  const row = db.prepare('SELECT * FROM budgets WHERE month = ?').get(month);
  return row ? row.monthly_budget : 5000;
}

function setBudget(amount, month = currentMonth()) {
  db.prepare(
    'INSERT INTO budgets (monthly_budget, month) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET monthly_budget = excluded.monthly_budget'
  ).run(amount, month);
  return amount;
}

module.exports = {
  db,
  currentMonth,
  todayISO,
  addExpense,
  getExpenses,
  getTodayExpenses,
  getRecentExpenses,
  deleteExpense,
  getMonthlyTotal,
  getWeeklyTotal,
  getTodayTotal,
  getCategorySummary,
  getTodayCategorySummary,
  getWeekCategorySummary,
  getWeekExpenses,
  getWeekDailySummary,
  getDailySummary,
  getBudget,
  setBudget,
};
