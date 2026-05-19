// Vercel serverless entry point.
// Handles all /api/* requests via the Express router.

const express = require('express');
const { initDB } = require('../database');
const apiRouter = require('../routes/api');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize DB once per cold start and share the promise across concurrent requests.
let dbReadyPromise = null;

function ensureDB() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDB().catch((err) => {
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

app.use(async (_req, _res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api', apiRouter);

// Fallback for unknown /api routes
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
