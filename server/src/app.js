require('dotenv').config();
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in .env');
}

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
// Next: orders, verification, sewing routes get mounted here

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app; // exported separately so tests can import it without opening a port