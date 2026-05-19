// Database layer using pg (works locally + Vercel + everywhere).

const { Pool } = require('pg');

let pool;

async function initDB() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      month TEXT NOT NULL,
      telegram_user_id TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      monthly_budget NUMERIC NOT NULL,
      month TEXT NOT NULL UNIQUE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`);

  console.log('[DB] Neon Postgres ready');
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function query(text, params) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

// ---------- Helpers ----------
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekAgoISO() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
}

// Cast Postgres numeric strings to JS numbers
function castExpense(row) {
  return { ...row, id: Number(row.id), amount: Number(row.amount) };
}

function castSummary(row) {
  return { ...row, total: Number(row.total), count: Number(row.count) };
}

function castDaySummary(row) {
  return { ...row, total: Number(row.total) };
}

// ---------- Expense queries ----------
async function addExpense({ amount, category, description, date, telegram_user_id }) {
  const dateValue = date || new Date().toISOString();
  const month = dateValue.slice(0, 7);
  const rows = await query(
    `INSERT INTO expenses (amount, category, description, date, month, telegram_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [amount, category, description || '', dateValue, month, telegram_user_id || null]
  );
  return { id: Number(rows[0].id), amount, category, description, date: dateValue, month };
}

async function getExpenses({ month } = {}) {
  if (month) {
    return (await query('SELECT * FROM expenses WHERE month = $1 ORDER BY date DESC', [month])).map(castExpense);
  }
  return (await query('SELECT * FROM expenses ORDER BY date DESC')).map(castExpense);
}

async function getTodayExpenses() {
  const today = todayISO();
  return (await query(
    "SELECT * FROM expenses WHERE substring(date, 1, 10) = $1 ORDER BY date DESC", [today]
  )).map(castExpense);
}

async function getRecentExpenses(limit = 10) {
  return (await query('SELECT * FROM expenses ORDER BY date DESC LIMIT $1', [limit])).map(castExpense);
}

async function deleteExpense(id) {
  const rows = await query('DELETE FROM expenses WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

async function getMonthlyTotal(month) {
  month = month || currentMonth();
  const rows = await query('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE month = $1', [month]);
  return Number(rows[0].total);
}

async function getWeeklyTotal() {
  const from = weekAgoISO();
  const rows = await query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substring(date, 1, 10) >= $1", [from]
  );
  return Number(rows[0].total);
}

async function getTodayTotal() {
  const today = todayISO();
  const rows = await query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substring(date, 1, 10) = $1", [today]
  );
  return Number(rows[0].total);
}

async function getCategorySummary(month) {
  month = month || currentMonth();
  return (await query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM expenses WHERE month = $1 GROUP BY category ORDER BY total DESC`, [month]
  )).map(castSummary);
}

async function getTodayCategorySummary() {
  const today = todayISO();
  return (await query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM expenses WHERE substring(date, 1, 10) = $1 GROUP BY category ORDER BY total DESC`, [today]
  )).map(castSummary);
}

async function getWeekCategorySummary() {
  const from = weekAgoISO();
  return (await query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM expenses WHERE substring(date, 1, 10) >= $1 GROUP BY category ORDER BY total DESC`, [from]
  )).map(castSummary);
}

async function getWeekExpenses() {
  const from = weekAgoISO();
  return (await query(
    "SELECT * FROM expenses WHERE substring(date, 1, 10) >= $1 ORDER BY date DESC", [from]
  )).map(castExpense);
}

async function getWeekDailySummary() {
  const from = weekAgoISO();
  return (await query(
    `SELECT substring(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
     FROM expenses WHERE substring(date, 1, 10) >= $1 GROUP BY day ORDER BY day ASC`, [from]
  )).map(castDaySummary);
}

async function getDailySummary(month) {
  month = month || currentMonth();
  return (await query(
    `SELECT substring(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
     FROM expenses WHERE month = $1 GROUP BY day ORDER BY day ASC`, [month]
  )).map(castDaySummary);
}

// ---------- Budget queries ----------
async function getBudget(month) {
  month = month || currentMonth();
  const rows = await query('SELECT * FROM budgets WHERE month = $1', [month]);
  return rows.length ? Number(rows[0].monthly_budget) : 5000;
}

async function setBudget(amount, month) {
  month = month || currentMonth();
  await query(
    `INSERT INTO budgets (monthly_budget, month) VALUES ($1, $2)
     ON CONFLICT(month) DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget`,
    [amount, month]
  );
  return amount;
}

module.exports = {
  initDB,
  getPool,
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
