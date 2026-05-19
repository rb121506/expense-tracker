// Database layer using Neon Postgres (works on Vercel serverless + locally).

const { neon } = require('@neondatabase/serverless');

let sql;

async function initDB() {
  sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      month TEXT NOT NULL,
      telegram_user_id TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      monthly_budget NUMERIC NOT NULL,
      month TEXT NOT NULL UNIQUE
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`;

  console.log('[DB] Neon Postgres ready');
}

function getSQL() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

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

// ---------- Expense queries ----------
async function addExpense({ amount, category, description, date, telegram_user_id }) {
  const s = getSQL();
  const dateValue = date || new Date().toISOString();
  const month = dateValue.slice(0, 7);
  const rows = await s`
    INSERT INTO expenses (amount, category, description, date, month, telegram_user_id)
    VALUES (${amount}, ${category}, ${description || ''}, ${dateValue}, ${month}, ${telegram_user_id || null})
    RETURNING id
  `;
  return { id: Number(rows[0].id), amount, category, description, date: dateValue, month };
}

async function getExpenses({ month } = {}) {
  const s = getSQL();
  let rows;
  if (month) {
    rows = await s`SELECT * FROM expenses WHERE month = ${month} ORDER BY date DESC`;
  } else {
    rows = await s`SELECT * FROM expenses ORDER BY date DESC`;
  }
  return rows.map(castExpense);
}

async function getTodayExpenses() {
  const s = getSQL();
  const today = todayISO();
  const rows = await s`SELECT * FROM expenses WHERE substring(date, 1, 10) = ${today} ORDER BY date DESC`;
  return rows.map(castExpense);
}

async function getRecentExpenses(limit = 10) {
  const s = getSQL();
  const rows = await s`SELECT * FROM expenses ORDER BY date DESC LIMIT ${limit}`;
  return rows.map(castExpense);
}

async function deleteExpense(id) {
  const s = getSQL();
  const rows = await s`DELETE FROM expenses WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function getMonthlyTotal(month) {
  const s = getSQL();
  month = month || currentMonth();
  const rows = await s`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE month = ${month}`;
  return Number(rows[0].total);
}

async function getWeeklyTotal() {
  const s = getSQL();
  const from = weekAgoISO();
  const rows = await s`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substring(date, 1, 10) >= ${from}`;
  return Number(rows[0].total);
}

async function getTodayTotal() {
  const s = getSQL();
  const today = todayISO();
  const rows = await s`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substring(date, 1, 10) = ${today}`;
  return Number(rows[0].total);
}

async function getCategorySummary(month) {
  const s = getSQL();
  month = month || currentMonth();
  const rows = await s`
    SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE month = ${month}
    GROUP BY category ORDER BY total DESC
  `;
  return rows.map(r => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

async function getTodayCategorySummary() {
  const s = getSQL();
  const today = todayISO();
  const rows = await s`
    SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE substring(date, 1, 10) = ${today}
    GROUP BY category ORDER BY total DESC
  `;
  return rows.map(r => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

async function getWeekCategorySummary() {
  const s = getSQL();
  const from = weekAgoISO();
  const rows = await s`
    SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE substring(date, 1, 10) >= ${from}
    GROUP BY category ORDER BY total DESC
  `;
  return rows.map(r => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

async function getWeekExpenses() {
  const s = getSQL();
  const from = weekAgoISO();
  const rows = await s`SELECT * FROM expenses WHERE substring(date, 1, 10) >= ${from} ORDER BY date DESC`;
  return rows.map(castExpense);
}

async function getWeekDailySummary() {
  const s = getSQL();
  const from = weekAgoISO();
  const rows = await s`
    SELECT substring(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE substring(date, 1, 10) >= ${from}
    GROUP BY day ORDER BY day ASC
  `;
  return rows.map(r => ({ ...r, total: Number(r.total) }));
}

async function getDailySummary(month) {
  const s = getSQL();
  month = month || currentMonth();
  const rows = await s`
    SELECT substring(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE month = ${month}
    GROUP BY day ORDER BY day ASC
  `;
  return rows.map(r => ({ ...r, total: Number(r.total) }));
}

// ---------- Budget queries ----------
async function getBudget(month) {
  const s = getSQL();
  month = month || currentMonth();
  const rows = await s`SELECT * FROM budgets WHERE month = ${month}`;
  return rows.length ? Number(rows[0].monthly_budget) : 5000;
}

async function setBudget(amount, month) {
  const s = getSQL();
  month = month || currentMonth();
  await s`
    INSERT INTO budgets (monthly_budget, month) VALUES (${amount}, ${month})
    ON CONFLICT(month) DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget
  `;
  return amount;
}

module.exports = {
  initDB,
  getSQL,
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
