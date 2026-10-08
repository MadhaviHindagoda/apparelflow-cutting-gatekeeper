const pool = require('../db/pool');
const { expectedComponentQty, expectedFabricYards, wastagePct } = require('./calc');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function listRecipes() {
  const { rows } = await pool.query(
    `SELECT r.id, r.recipe_code, r.name, r.category,
            r.std_fabric_yards::float AS std_fabric_yards,
            r.wastage_cap::float AS wastage_cap,
            COALESCE(json_agg(json_build_object(
              'id', c.id,
              'component_name', c.component_name,
              'pieces_per_garment', c.pieces_per_garment
            ) ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS components
       FROM recipes r
       LEFT JOIN recipe_components c ON c.recipe_id = r.id
      GROUP BY r.id
      ORDER BY r.recipe_code`
  );
  return rows;
}

// Creates the order AND its verification_items (expected qty per component) atomically.
async function createOrder({ recipeId, targetQty, fabricRollId, actualFabricYds, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const recipeRes = await client.query('SELECT id FROM recipes WHERE id = $1', [recipeId]);
    if (!recipeRes.rows[0]) throw new HttpError(404, 'Recipe not found');

    const orderRes = await client.query(
      `INSERT INTO cutting_orders
         (recipe_id, target_qty, fabric_roll_id, actual_fabric_yds, status, created_by)
       VALUES ($1, $2, $3, $4, 'PENDING_VERIFICATION', $5)
       RETURNING id, order_no, status`,
      [recipeId, targetQty, fabricRollId, actualFabricYds, userId]
    );
    const order = orderRes.rows[0];

    const compRes = await client.query(
      'SELECT id, pieces_per_garment FROM recipe_components WHERE recipe_id = $1',
      [recipeId]
    );
    for (const c of compRes.rows) {
      await client.query(
        `INSERT INTO verification_items (order_id, component_id, expected_qty)
         VALUES ($1, $2, $3)`,
        [order.id, c.id, expectedComponentQty(targetQty, c.pieces_per_garment)]
      );
    }

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// A supervisor sees only the orders they created (+ latest rejection reason)
async function listOrdersForSupervisor(userId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_no, o.status, o.target_qty, o.fabric_roll_id,
            o.actual_fabric_yds::float AS actual_fabric_yds,
            o.created_at, o.updated_at,
            r.recipe_code, r.name AS recipe_name,
            lr.rejection_note AS last_rejection_note
       FROM cutting_orders o
       JOIN recipes r ON r.id = o.recipe_id
       LEFT JOIN LATERAL (
              SELECT rejection_note FROM verification_logs
               WHERE order_id = o.id AND decision = 'REJECTED'
               ORDER BY timestamp DESC, id DESC LIMIT 1) lr ON TRUE
      WHERE o.created_by = $1
      ORDER BY o.created_at DESC`,
    [userId]
  );
  return rows;
}

async function getOrderForSupervisor(orderId, userId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_no, o.status, o.target_qty, o.fabric_roll_id,
            o.actual_fabric_yds::float AS actual_fabric_yds, o.created_at,
            r.recipe_code, r.name AS recipe_name,
            r.std_fabric_yards::float AS std_fabric_yards,
            r.wastage_cap::float AS wastage_cap
       FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id
      WHERE o.id = $1 AND o.created_by = $2`,
    [orderId, userId]
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'Order not found');

  const items = await pool.query(
    `SELECT c.component_name, vi.expected_qty, vi.actual_qty, vi.status
       FROM verification_items vi
       JOIN recipe_components c ON c.id = vi.component_id
      WHERE vi.order_id = $1 ORDER BY c.id`,
    [orderId]
  );

  const noteRes = await pool.query(
    `SELECT rejection_note, timestamp FROM verification_logs
      WHERE order_id = $1 AND decision = 'REJECTED'
      ORDER BY timestamp DESC, id DESC LIMIT 1`,
    [orderId]
  );

  const expectedFabric = expectedFabricYards(order.target_qty, order.std_fabric_yards);
  return {
    ...order,
    last_rejection_note: noteRes.rows[0] ? noteRes.rows[0].rejection_note : null,
    expected_fabric_yds: expectedFabric,
    wastage_pct: wastagePct(order.actual_fabric_yds, expectedFabric),
    items: items.rows,
  };
}

// REJECTED -> PENDING_VERIFICATION after re-cutting. Only the supervisor who created it.
// Counts are reset so the verifier must physically recount everything.
async function resubmitOrder(orderId, userId, { actualFabricYds, fabricRollId } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, status FROM cutting_orders WHERE id = $1 AND created_by = $2 FOR UPDATE',
      [orderId, userId]
    );
    const order = rows[0];
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status !== 'REJECTED') {
      throw new HttpError(409, `Order is ${order.status}; only REJECTED orders can be resubmitted`);
    }

    await client.query(
      'UPDATE verification_items SET actual_qty = NULL, status = NULL WHERE order_id = $1',
      [orderId]
    );
    await client.query(
      `UPDATE cutting_orders
          SET status = 'PENDING_VERIFICATION',
              actual_fabric_yds = COALESCE($2, actual_fabric_yds),
              fabric_roll_id = COALESCE($3, fabric_roll_id)
        WHERE id = $1`,
      [orderId, actualFabricYds ?? null, fabricRollId ?? null]
    );
    await client.query('COMMIT');
    return { id: orderId, status: 'PENDING_VERIFICATION' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  HttpError,
  resubmitOrder,
  listRecipes,
  createOrder,
  listOrdersForSupervisor,
  getOrderForSupervisor,
};