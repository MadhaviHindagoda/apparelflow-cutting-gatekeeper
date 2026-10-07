const express = require('express');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listRecipes } = require('../services/orderService');

const router = express.Router();

router.get(
  '/',
  authenticate,
  requireRole('cutting_supervisor', 'cutting_verifier'),
  async (req, res, next) => {
    try {
      res.json({ recipes: await listRecipes() });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;