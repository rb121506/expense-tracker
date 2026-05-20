// Database layer using pg (works locally + Vercel + everywhere).

const { Pool } = require('pg');

let pool;

function getDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Add it to .env locally or to your deployment environment.');
  }
  return process.env.DATABASE_URL;
}

function createPoolConfig() {
  const connectionString = getDatabaseUrl();
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const disablesSsl = /sslmode=disable/i.test(connectionString);

  return {
    connectionString,
    ssl: isLocal || disablesSsl ? false : { rejectUnauthorized: false },
    max: 5,
  };
}

async function initDB() {
  if (!pool) pool = new Pool(createPoolConfig());

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS category_budgets (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      budget NUMERIC NOT NULL,
      month TEXT NOT NULL,
      UNIQUE(category, month)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      day_of_month INTEGER NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_catbudgets_month ON category_budgets(month)`);

  console.log('[DB] Neon Postgres ready');
}

function getPool() {
  if (!pool) pool = new Pool(createPoolConfig());
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

async function updateExpense(id, { amount, category, description, date }) {
  const dateValue = date;
  const month = dateValue ? dateValue.slice(0, 7) : undefined;
  const rows = await query(
    `UPDATE expenses SET amount = COALESCE($2, amount), category = COALESCE($3, category),
     description = COALESCE($4, description), date = COALESCE($5, date), month = COALESCE($6, month)
     WHERE id = $1 RETURNING *`,
    [id, amount, category, description, dateValue, month]
  );
  return rows.length ? castExpense(rows[0]) : null;
}

async function getExpenses({ month } = {}) {
  if (month) {
    return (await query('SELECT * FROM expenses WHERE month = $1 ORDER BY date DESC', [month])).map(castExpense);
  }
  return (await query('SELECT * FROM expenses ORDER BY date DESC')).map(castExpense);
}

async function searchExpenses({ month, category, dateFrom, dateTo, amountMin, amountMax, search, limit }) {
  let sql = 'SELECT * FROM expenses WHERE 1=1';
  const params = [];
  let i = 1;

  if (month) { sql += ` AND month = $${i++}`; params.push(month); }
  if (category) { sql += ` AND category = $${i++}`; params.push(category); }
  if (dateFrom) { sql += ` AND substring(date, 1, 10) >= $${i++}`; params.push(dateFrom); }
  if (dateTo) { sql += ` AND substring(date, 1, 10) <= $${i++}`; params.push(dateTo); }
  if (amountMin != null) { sql += ` AND amount >= $${i++}`; params.push(amountMin); }
  if (amountMax != null) { sql += ` AND amount <= $${i++}`; params.push(amountMax); }
  if (search) { sql += ` AND LOWER(description) LIKE $${i++}`; params.push(`%${search.toLowerCase()}%`); }

  sql += ' ORDER BY date DESC';
  if (limit) { sql += ` LIMIT $${i++}`; params.push(limit); }

  return (await query(sql, params)).map(castExpense);
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

// ---------- Category budget queries ----------
async function getCategoryBudgets(month) {
  month = month || currentMonth();
  const rows = await query('SELECT * FROM category_budgets WHERE month = $1 ORDER BY category', [month]);
  return rows.map(r => ({ ...r, id: Number(r.id), budget: Number(r.budget) }));
}

async function setCategoryBudget(category, budget, month) {
  month = month || currentMonth();
  await query(
    `INSERT INTO category_budgets (category, budget, month) VALUES ($1, $2, $3)
     ON CONFLICT(category, month) DO UPDATE SET budget = EXCLUDED.budget`,
    [category, budget, month]
  );
}

async function deleteCategoryBudget(category, month) {
  month = month || currentMonth();
  const rows = await query('DELETE FROM category_budgets WHERE category = $1 AND month = $2 RETURNING id', [category, month]);
  return rows.length > 0;
}

// ---------- Recurring expense queries ----------
function castRecurring(row) {
  return { ...row, id: Number(row.id), amount: Number(row.amount), day_of_month: Number(row.day_of_month) };
}

async function getRecurringExpenses() {
  return (await query('SELECT * FROM recurring_expenses ORDER BY id')).map(castRecurring);
}

async function addRecurringExpense({ amount, category, description, day_of_month }) {
  const rows = await query(
    `INSERT INTO recurring_expenses (amount, category, description, day_of_month, active, created_at)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING *`,
    [amount, category, description || '', day_of_month || 1, new Date().toISOString()]
  );
  return castRecurring(rows[0]);
}

async function updateRecurringExpense(id, { amount, category, description, day_of_month, active }) {
  const rows = await query(
    `UPDATE recurring_expenses SET
       amount = COALESCE($2, amount), category = COALESCE($3, category),
       description = COALESCE($4, description), day_of_month = COALESCE($5, day_of_month),
       active = COALESCE($6, active)
     WHERE id = $1 RETURNING *`,
    [id, amount, category, description, day_of_month, active]
  );
  return rows.length ? castRecurring(rows[0]) : null;
}

async function deleteRecurringExpense(id) {
  const rows = await query('DELETE FROM recurring_expenses WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

// ---------- Insights queries ----------
async function getInsights(month) {
  month = month || currentMonth();

  // Previous month
  const [y, m] = month.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const [currentData, prevData, highestDay, dailyData] = await Promise.all([
    query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE month = $1`, [month]),
    query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE month = $1`, [prevMonth]),
    query(`SELECT substring(date, 1, 10) AS day, SUM(amount) AS total
           FROM expenses WHERE month = $1
           GROUP BY day ORDER BY total DESC LIMIT 1`, [month]),
    query(`SELECT substring(date, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
           FROM expenses WHERE month = $1 GROUP BY day ORDER BY day ASC`, [month]),
  ]);

  const currentTotal = Number(currentData[0].total);
  const currentCount = Number(currentData[0].count);
  const prevTotal = Number(prevData[0].total);

  // Days elapsed in this month
  const now = new Date();
  const isCurrentMonth = month === currentMonth();
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
  const avgDaily = daysElapsed > 0 ? currentTotal / daysElapsed : 0;
  const projected = isCurrentMonth ? avgDaily * daysInMonth : currentTotal;

  // Month-over-month change
  const monthChange = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

  return {
    month,
    prevMonth,
    currentTotal,
    currentCount,
    prevTotal,
    highestDay: highestDay.length ? { day: highestDay[0].day, total: Number(highestDay[0].total) } : null,
    avgDaily: Math.round(avgDaily),
    projected: Math.round(projected),
    monthChange: Math.round(monthChange * 10) / 10,
    daysElapsed,
    daysInMonth,
  };
}

// ---------- Import (bulk insert) ----------
async function bulkAddExpenses(entries) {
  const client = await getPool().connect();
  const results = [];
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const dateValue = e.date || new Date().toISOString();
      const month = dateValue.slice(0, 7);
      const { rows } = await client.query(
        `INSERT INTO expenses (amount, category, description, date, month, telegram_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [e.amount, e.category, e.description || '', dateValue, month, null]
      );
      results.push({ id: Number(rows[0].id), ...e, date: dateValue, month });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return results;
}

module.exports = {
  initDB,
  getPool,
  getDatabaseUrl,
  currentMonth,
  todayISO,
  addExpense,
  updateExpense,
  getExpenses,
  searchExpenses,
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
  getCategoryBudgets,
  setCategoryBudget,
  deleteCategoryBudget,
  getRecurringExpenses,
  addRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  getInsights,
  bulkAddExpenses,
};
