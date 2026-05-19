// Vercel serverless entry point.
// Handles all /api/* requests via the Express router.

const express = require('express');
const { initDB } = require('../database');
const apiRouter = require('../routes/api');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize DB once per cold start
let dbReady = false;
app.use(async (_req, _res, next) => {
  if (!dbReady) {
    await initDB();
    dbReady = true;
  }
  next();
});

app.use('/api', apiRouter);

// Fallback for unknown /api routes
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
