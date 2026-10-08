const pool = require('../db/pool');
const { HttpError } = require('./orderService');

// Shared SELECT. The status filter is ALWAYS written by the server in the callers below,
// never built from query params, so URL manipulation cannot widen it.
const BASE_SELECT = `
  SELECT o.id, o.order_no, o.status, o.target_qty, o.fabric_roll_id,
         o.actual_fabric_yds::float AS actual_fabric_yds,
         o.sewing_started_at, su.full_name AS sewing_started_by_name,
         r.recipe_code, r.name AS recipe_name, r.wastage_cap::float AS wastage_cap,
         l.verifier_id, vu.full_name AS verified_by_name,
         l.timestamp AS verified_at,
         l.wastage_pct::float AS wastage_pct,
         l.variances
    FROM cutting_orders o
    JOIN recipes r ON r.id = o.recipe_id
    JOIN LATERAL (
           SELECT * FROM verification_logs
            WHERE order_id = o.id AND decision = 'APPROVED'
            ORDER BY timestamp DESC, id DESC LIMIT 1) l ON TRUE
    JOIN users vu ON vu.id = l.verifier_id
    LEFT JOIN users su ON su.id = o.sewing_started_by
`;

// GET /api/sewing/queue  ->  WHERE status = 'VERIFIED' enforced in SQL
async function listQueue() {
  const { rows } = await pool.query(
    `${BASE_SELECT} WHERE o.status = 'VERIFIED' ORDER BY l.timestamp ASC`
  );
  return rows;
}

// Orders already released into assembly (still only post-verification orders)
async function listInProgress() {
  const { rows } = await pool.query(
    `${BASE_SELECT} WHERE o.status = 'SEWING_STARTED' ORDER BY o.sewing_started_at DESC`
  );
  return rows;
}

// Anything that was never verified is reported as 404, so its existence is not leaked.
async function getDetail(orderId) {
  const { rows } = await pool.query(
    `${BASE_SELECT} WHERE o.id = $1 AND o.status IN ('VERIFIED', 'SEWING_STARTED')`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'Order not found in sewing queue');

  const items = await pool.query(
    `SELECT c.component_name, vi.expected_qty, vi.actual_qty, vi.status
       FROM verification_items vi
       JOIN recipe_components c ON c.id = vi.component_id
      WHERE vi.order_id = $1 ORDER BY c.id`,
    [orderId]
  );
  return { ...order, items: items.rows };
}

async function startSewing(orderId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, status FROM cutting_orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    const order = rows[0];
    // Not verified (pending / rejected / in progress) or missing => indistinguishable 404
    if (!order || !['VERIFIED', 'SEWING_STARTED'].includes(order.status)) {
      throw new HttpError(404, 'Order not found in sewing queue');
    }
    if (order.status === 'SEWING_STARTED') {
      throw new HttpError(409, 'Sewing already started for this order');
    }
    // sewing_started_by comes from the JWT, timestamp from the DB clock
    await client.query(
      `UPDATE cutting_orders
          SET status = 'SEWING_STARTED', sewing_started_by = $2, sewing_started_at = NOW()
        WHERE id = $1`,
      [orderId, userId]
    );
    await client.query('COMMIT');
    return { id: orderId, status: 'SEWING_STARTED' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listQueue, listInProgress, getDetail, startSewing };