const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../db/pool');
const authenticate = require('../middleware/auth');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Used so a missing user takes about as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email and password are required' });
    }
    const { email, password } = parsed.data;

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, role, full_name FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '8h',
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    });
  } catch (err) {
    next(err);
  }
});

// Current user (used by the frontend on page reload)
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, full_name FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'User no longer exists' });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;