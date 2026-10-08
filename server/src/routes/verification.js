const express = require('express');
const { z } = require('zod');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { HttpError } = require('../services/orderService');
const svc = require('../services/verificationService');

const router = express.Router();

// Every route here: must be logged in AND be a cutting_verifier. Enforced server-side.
router.use(authenticate, requireRole('cutting_verifier'));

const qty = z
  .number({ required_error: 'Count is required', invalid_type_error: 'Count must be a number' })
  .int('Count must be a whole number')
  .min(0, 'Count cannot be negative')
  .max(1_000_000, 'Count is too large');

const countSchema = z.object({
  counts: z
    .array(
      z.object({
        component_id: z.number().int().positive(),
        actual_qty: qty,
      })
    )
    .min(1, 'Provide at least one count')
    .max(100)
    .refine((arr) => new Set(arr.map((c) => c.component_id)).size === arr.length, 'Duplicate component_id'),
});

const rejectSchema = z.object({
  note: z
    .string({ required_error: 'Rejection reason is required', invalid_type_error: 'Rejection reason must be text' })
    .trim()
    .min(1, 'Rejection reason is required')
    .max(500, 'Rejection reason is too long (max 500)'),
});

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id' });
    return null;
  }
  return id;
}

function validationError(res, zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return res.status(400).json({ error: 'Validation failed', fields });
}

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

router.get('/pending', handle(async (req, res) => {
  res.json({ orders: await svc.listPending() });
}));

router.get('/:id', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  res.json({ order: await svc.getDetail(id) });
}));

router.post('/:id/count', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  const parsed = countSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  await svc.recordCounts(id, parsed.data.counts);
  res.json({ order: await svc.getDetail(id) });
}));

// Body is intentionally ignored: nothing the client sends can influence the decision.
router.post('/:id/approve', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  const result = await svc.approveOrder(id, req.user.id); // verifier id from JWT
  res.json(result);
}));

router.post('/:id/reject', handle(async (req, res) => {
  const id = parseId(req, res); if (!id) return;
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const result = await svc.rejectOrder(id, req.user.id, parsed.data.note);
  res.json(result);
}));

module.exports = router;