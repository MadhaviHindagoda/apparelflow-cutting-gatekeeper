const express = require('express');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { HttpError } = require('../services/orderService');
const svc = require('../services/sewingService');

const router = express.Router();

// Only sewing supervisors. Cutting roles get 403 on every route here.
router.use(authenticate, requireRole('sewing_supervisor'));

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id' });
    return null;
  }
  return id;
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

// NOTE: no query params are read anywhere in this file (?status=... is ignored by design).
router.get('/queue', handle(async (req, res) => {
  res.json({ orders: await svc.listQueue() });
}));

router.get('/in-progress', handle(async (req, res) => {
  res.json({ orders: await svc.listInProgress() });
}));

router.get('/:id', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  res.json({ order: await svc.getDetail(id) });
}));

router.post('/:id/start', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  res.json(await svc.startSewing(id, req.user.id));
}));

module.exports = router;