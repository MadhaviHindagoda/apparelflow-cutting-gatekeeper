const pool = require('../db/pool');
const { HttpError } = require('./orderService');
const { expectedFabricYards, wastagePct, trafficLight, summarize } = require('./calc');

async function listPending() {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_no, o.status, o.target_qty, o.fabric_roll_id,
            o.actual_fabric_yds::float AS actual_fabric_yds, o.created_at,
            r.recipe_code, r.name AS recipe_name,
            u.full_name AS created_by_name,
            COUNT(vi.id)::int AS total_components,
            COUNT(vi.actual_qty)::int AS counted_components
       FROM cutting_orders o
       JOIN recipes r ON r.id = o.recipe_id
       JOIN users u ON u.id = o.created_by
       JOIN verification_items vi ON vi.order_id = o.id
      WHERE o.status = 'PENDING_VERIFICATION'
      GROUP BY o.id, r.id, u.id
      ORDER BY o.created_at ASC`
  );
  return rows;
}

async function getDetail(orderId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_no, o.status, o.target_qty, o.fabric_roll_id,
            o.actual_fabric_yds::float AS actual_fabric_yds, o.created_at,
            r.recipe_code, r.name AS recipe_name,
            r.std_fabric_yards::float AS std_fabric_yards,
            r.wastage_cap::float AS wastage_cap
       FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id
      WHERE o.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'Order not found');

  const itemsRes = await pool.query(
    `SELECT vi.component_id, c.component_name, vi.expected_qty, vi.actual_qty, vi.status
       FROM verification_items vi
       JOIN recipe_components c ON c.id = vi.component_id
      WHERE vi.order_id = $1 ORDER BY c.id`,
    [orderId]
  );

  const expectedFabric = expectedFabricYards(order.target_qty, order.std_fabric_yards);
  const pct = wastagePct(order.actual_fabric_yds, expectedFabric);
  const summary = summarize(itemsRes.rows);

  return {
    ...order,
    expected_fabric_yds: expectedFabric,
    wastage_pct: pct,
    over_wastage_cap: pct > order.wastage_cap, // informational only, does not block
    items: itemsRes.rows.map((i) => ({
      ...i,
      status: trafficLight(i.expected_qty, i.actual_qty),
      diff: i.actual_qty === null ? null : i.actual_qty - i.expected_qty,
    })),
    summary: { ...summary, can_approve: summary.can_approve && order.status === 'PENDING_VERIFICATION' },
  };
}

// Run fn(client, lockedOrder) inside a transaction with the order row locked.
async function withLockedPendingOrder(orderId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.id, o.status, o.target_qty, o.actual_fabric_yds::float AS actual_fabric_yds,
              r.std_fabric_yards::float AS std_fabric_yards
         FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id
        WHERE o.id = $1
        FOR UPDATE OF o`,
      [orderId]
    );
    const order = rows[0];
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status !== 'PENDING_VERIFICATION') {
      throw new HttpError(409, `Order is ${order.status}; only PENDING_VERIFICATION orders can be processed`);
    }
    const result = await fn(client, order);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadItems(client, orderId) {
  const { rows } = await client.query(
    `SELECT vi.id, vi.component_id, c.component_name, vi.expected_qty, vi.actual_qty
       FROM verification_items vi
       JOIN recipe_components c ON c.id = vi.component_id
      WHERE vi.order_id = $1 ORDER BY c.id`,
    [orderId]
  );
  return rows;
}

// Record physical counts. Status (GREEN/YELLOW/RED) is computed HERE, not taken from the client.
async function recordCounts(orderId, counts) {
  return withLockedPendingOrder(orderId, async (client) => {
    const items = await loadItems(client, orderId);
    const byComponent = new Map(items.map((i) => [i.component_id, i]));

    for (const c of counts) {
      if (!byComponent.has(c.component_id)) {
        throw new HttpError(422, `Component ${c.component_id} does not belong to this order`);
      }
    }
    for (const c of counts) {
      const item = byComponent.get(c.component_id);
      await client.query(
        'UPDATE verification_items SET actual_qty = $1, status = $2 WHERE id = $3',
        [c.actual_qty, trafficLight(item.expected_qty, c.actual_qty), item.id]
      );
    }
    return { updated: counts.length };
  });
}

function buildVariances(items) {
  return items.map((i) => ({
    component_id: i.component_id,
    component: i.component_name,
    expected: i.expected_qty,
    actual: i.actual_qty,
    diff: i.actual_qty === null ? null : i.actual_qty - i.expected_qty,
    status: trafficLight(i.expected_qty, i.actual_qty),
  }));
}

// THE HARD STOP. Verifier identity + timestamp come from the server (verifierId from JWT, NOW() from DB).
async function approveOrder(orderId, verifierId) {
  return withLockedPendingOrder(orderId, async (client, order) => {
    const items = await loadItems(client, orderId);
    const summary = summarize(items); // recomputed from raw numbers

    if (summary.total === 0) {
      throw new HttpError(422, 'Order has no components to verify');
    }
    if (summary.uncounted_count > 0) {
      throw new HttpError(422, `Cannot approve: ${summary.uncounted_count} component(s) not counted yet`);
    }
    if (summary.has_red) {
      throw new HttpError(422, `Cannot approve: ${summary.red_count} component(s) have a SHORTAGE (RED)`);
    }

    const expectedFabric = expectedFabricYards(order.target_qty, order.std_fabric_yards);
    const pct = wastagePct(order.actual_fabric_yds, expectedFabric);

    const log = await client.query(
      `INSERT INTO verification_logs
         (order_id, verifier_id, decision, wastage_pct, variances)
       VALUES ($1, $2, 'APPROVED', $3, $4::jsonb)
       RETURNING id, order_id, verifier_id, decision, wastage_pct::float AS wastage_pct, timestamp`,
      [orderId, verifierId, pct, JSON.stringify(buildVariances(items))]
    );
    await client.query(`UPDATE cutting_orders SET status = 'VERIFIED' WHERE id = $1`, [orderId]);

    return { status: 'VERIFIED', log: log.rows[0] };
  });
}

async function rejectOrder(orderId, verifierId, note) {
  return withLockedPendingOrder(orderId, async (client, order) => {
    const items = await loadItems(client, orderId);
    const expectedFabric = expectedFabricYards(order.target_qty, order.std_fabric_yards);
    const pct = wastagePct(order.actual_fabric_yds, expectedFabric);

    const log = await client.query(
      `INSERT INTO verification_logs
         (order_id, verifier_id, decision, rejection_note, wastage_pct, variances)
       VALUES ($1, $2, 'REJECTED', $3, $4, $5::jsonb)
       RETURNING id, order_id, verifier_id, decision, rejection_note, timestamp`,
      [orderId, verifierId, note, pct, JSON.stringify(buildVariances(items))]
    );
    await client.query(`UPDATE cutting_orders SET status = 'REJECTED' WHERE id = $1`, [orderId]);

    return { status: 'REJECTED', log: log.rows[0] };
  });
}

module.exports = { listPending, getDetail, recordCounts, approveOrder, rejectOrder };