const express = require('express');
const { z } = require('zod');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const svc = require('../services/orderService');

const router = express.Router();

// STRICT validation: real JSON numbers only (so "50", "abc", null are rejected),
// whole numbers only (no decimals), positive (no negatives / zero).
const intField = (label, max) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .positive(`${label} must be greater than 0`)
    .max(max, `${label} is too large`);

const fabricRollField = z
  .string({ required_error: 'Fabric roll ID is required', invalid_type_error: 'Fabric roll ID must be text' })
  .trim()
  .min(1, 'Fabric roll ID is required')
  .max(50, 'Fabric roll ID is too long');

// Fabric yards may be fractional (e.g. 94.5) but must be positive, max 2 decimals
const fabricYardsField = z
  .number({ required_error: 'Fabric used is required', invalid_type_error: 'Fabric used must be a number' })
  .positive('Fabric used must be greater than 0')
  .max(1_000_000, 'Fabric used is too large')
  .refine((n) => Math.round(n * 100) / 100 === n, 'Use at most 2 decimal places');

const createOrderSchema = z.object({
  recipe_id: intField('Recipe', 1_000_000),
  target_qty: intField('Target quantity', 100_000),
  fabric_roll_id: fabricRollField,
  actual_fabric_yds: fabricYardsField,
});

// Re-cut may use different fabric; both fields optional, validated if present
const resubmitSchema = z.object({
  fabric_roll_id: fabricRollField.optional(),
  actual_fabric_yds: fabricYardsField.optional(),
});

function validationError(res, zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0] ?? '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return res.status(400).json({ error: 'Validation failed', fields });
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id' });
    return null;
  }
  return id;
}

// Create order (supervisor only). created_by comes from the JWT, never the body.
router.post('/', authenticate, requireRole('cutting_supervisor'), async (req, res, next) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    const d = parsed.data;
    const order = await svc.createOrder({
      recipeId: d.recipe_id,
      targetQty: d.target_qty,
      fabricRollId: d.fabric_roll_id,
      actualFabricYds: d.actual_fabric_yds,
      userId: req.user.id,
    });
    res.status(201).json({ order });
  } catch (err) {
    if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/', authenticate, requireRole('cutting_supervisor'), async (req, res, next) => {
  try {
    res.json({ orders: await svc.listOrdersForSupervisor(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, requireRole('cutting_supervisor'), async (req, res, next) => {
  try {
    const id = parseId(req, res); if (!id) return;
    res.json({ order: await svc.getOrderForSupervisor(id, req.user.id) });
  } catch (err) {
    if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Send a REJECTED order back to the verifier after re-cutting
router.post('/:id/resubmit', authenticate, requireRole('cutting_supervisor'), async (req, res, next) => {
  try {
    const id = parseId(req, res); if (!id) return;
    const parsed = resubmitSchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(res, parsed.error);

    const result = await svc.resubmitOrder(id, req.user.id, {
      actualFabricYds: parsed.data.actual_fabric_yds,
      fabricRollId: parsed.data.fabric_roll_id,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;