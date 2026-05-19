// One-time migration: SQLite → Neon Postgres
// Run with: node migrate-sqlite-to-neon.js

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const sqlite = new DatabaseSync('expenses.db');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function migrate() {
  console.log('Reading SQLite data...');

  // Read expenses
  const expenses = sqlite.prepare('SELECT * FROM expenses ORDER BY id').all();
  console.log(`Found ${expenses.length} expenses`);

  // Read budgets
  let budgets = [];
  try {
    budgets = sqlite.prepare('SELECT * FROM budgets ORDER BY id').all();
    console.log(`Found ${budgets.length} budget entries`);
  } catch (e) {
    console.log('No budgets table or empty');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert expenses
    for (const e of expenses) {
      await client.query(
        `INSERT INTO expenses (amount, category, description, date, month, telegram_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [e.amount, e.category, e.description || '', e.date, e.month, e.telegram_user_id || null]
      );
    }
    console.log(`✅ Migrated ${expenses.length} expenses`);

    // Insert budgets
    for (const b of budgets) {
      await client.query(
        `INSERT INTO budgets (monthly_budget, month)
         VALUES ($1, $2)
         ON CONFLICT (month) DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget`,
        [b.monthly_budget, b.month]
      );
    }
    console.log(`✅ Migrated ${budgets.length} budget entries`);

    await client.query('COMMIT');
    console.log('\n✅ Migration complete! Your data is now in Neon Postgres.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
