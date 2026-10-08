import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  app, pool, bearer, assertSafeTestDb, resetDatabase,
  loginAs, newOrder, countOrder, dbOrderStatus, dbLogs,
} from './helpers.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let recipeId;
let sup, ver, sew; // { token, user }

beforeAll(async () => {
  assertSafeTestDb(); // must run before anything destructive
  ({ recipeId } = await resetDatabase());
  sup = await loginAs('supervisor@demo.com', 'Supervisor@123');
  ver = await loginAs('verifier@demo.com', 'Verifier@123');
  sew = await loginAs('sewing@demo.com', 'Sewing@123');
});

afterAll(async () => {
  await pool.end();
});

const approve = (id, token, body) =>
  request(app).post(`/api/verification/${id}/approve`).set(bearer(token)).send(body ?? {});
const reject = (id, token, body) =>
  request(app).post(`/api/verification/${id}/reject`).set(bearer(token)).send(body ?? {});

// ---------------------------------------------------------------------------
describe('Test 1: all-GREEN order can be approved by an authenticated Verifier', () => {
  it('approves, records verifier from the JWT (not the body), wastage and variances', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id); // all GREEN

    // Client tries to lie about who is verifying and about the status: must be ignored
    const res = await approve(id, ver.token, { verifier_id: 9999, status: 'GREEN' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VERIFIED');
    expect(await dbOrderStatus(id)).toBe('VERIFIED');

    const [log] = await dbLogs(id);
    expect(log.decision).toBe('APPROVED');
    expect(log.verifier_id).toBe(ver.user.id);
    expect(log.timestamp).toBeTruthy();
    expect(Number(log.wastage_pct)).toBeCloseTo(5, 2);
    expect(log.variances).toHaveLength(5);
  });

  it('YELLOW (excess) components do not block approval', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id, { 'Front Body Panel': 15 }); // expected 10
    const res = await approve(id, ver.token);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('Test 2: a RED (shortage) component blocks approval', () => {
  it('returns 422 and leaves the order PENDING_VERIFICATION', async () => {
    const id = await newOrder(sup.token, recipeId);
    const counted = await countOrder(ver.token, id, { 'Sleeve Cuffs': 19 }); // expected 20
    expect(counted.summary.has_red).toBe(true);
    expect(counted.summary.can_approve).toBe(false);

    const res = await approve(id, ver.token);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/SHORTAGE/);
    expect(await dbOrderStatus(id)).toBe('PENDING_VERIFICATION');
    expect(await dbLogs(id)).toHaveLength(0);
  });

  it('a count of 0 is a shortage too', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id, { 'Collar & Stand': 0 });
    expect((await approve(id, ver.token)).status).toBe(422);
  });

  it('uncounted components block approval (422)', async () => {
    const id = await newOrder(sup.token, recipeId);
    const res = await approve(id, ver.token); // nothing counted
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not counted/);
    expect(await dbOrderStatus(id)).toBe('PENDING_VERIFICATION');
  });

  it('partially counted orders cannot be approved', async () => {
    const id = await newOrder(sup.token, recipeId);
    const detail = await request(app).get(`/api/verification/${id}`).set(bearer(ver.token));
    const first = detail.body.order.items[0];
    await request(app)
      .post(`/api/verification/${id}/count`)
      .set(bearer(ver.token))
      .send({ counts: [{ component_id: first.component_id, actual_qty: first.expected_qty }] });
    expect((await approve(id, ver.token)).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('Test 3: rejecting without a reason note is rejected by the backend', () => {
  it('400 when the note is missing, empty or only whitespace', async () => {
    const id = await newOrder(sup.token, recipeId);
    expect((await reject(id, ver.token, {})).status).toBe(400);
    expect((await reject(id, ver.token, { note: '' })).status).toBe(400);
    expect((await reject(id, ver.token, { note: '    ' })).status).toBe(400);
    expect(await dbOrderStatus(id)).toBe('PENDING_VERIFICATION');
    expect(await dbLogs(id)).toHaveLength(0);
  });

  it('succeeds with a note and stores it in the audit log', async () => {
    const id = await newOrder(sup.token, recipeId);
    const res = await reject(id, ver.token, { note: 'Cuffs short, re-cut required' });
    expect(res.status).toBe(200);
    expect(await dbOrderStatus(id)).toBe('REJECTED');
    const [log] = await dbLogs(id);
    expect(log.decision).toBe('REJECTED');
    expect(log.rejection_note).toBe('Cuffs short, re-cut required');
    expect(log.verifier_id).toBe(ver.user.id);
  });
});

// ---------------------------------------------------------------------------
describe('Test 4: non-verifier roles get 403 on verification actions', () => {
  it('supervisor and sewing supervisor cannot approve (order stays PENDING)', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id); // perfectly valid batch: only the role should stop it

    expect((await approve(id, sup.token)).status).toBe(403);
    expect((await approve(id, sew.token)).status).toBe(403);
    expect(await dbOrderStatus(id)).toBe('PENDING_VERIFICATION');
  });

  it('they cannot reject or count either', async () => {
    const id = await newOrder(sup.token, recipeId);
    expect((await reject(id, sup.token, { note: 'nope' })).status).toBe(403);
    const countRes = await request(app)
      .post(`/api/verification/${id}/count`)
      .set(bearer(sup.token))
      .send({ counts: [{ component_id: 1, actual_qty: 1 }] });
    expect(countRes.status).toBe(403);
  });

  it('401 without a token, 401 with a garbage token', async () => {
    const id = await newOrder(sup.token, recipeId);
    expect((await request(app).post(`/api/verification/${id}/approve`)).status).toBe(401);
    expect((await approve(id, 'not.a.real.token')).status).toBe(401);
  });

  it('verifier cannot create orders (separation of duties)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(ver.token))
      .send({ recipe_id: recipeId, target_qty: 10, fabric_roll_id: 'X', actual_fabric_yds: 10 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Test 5: unapproved orders never appear in the Sewing Queue', () => {
  let pendingId, rejectedId, verifiedId;

  beforeAll(async () => {
    pendingId = await newOrder(sup.token, recipeId);

    rejectedId = await newOrder(sup.token, recipeId);
    await reject(rejectedId, ver.token, { note: 'defect' });

    verifiedId = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, verifiedId);
    await approve(verifiedId, ver.token);
  });

  it('API queue contains only VERIFIED orders', async () => {
    const res = await request(app).get('/api/sewing/queue').set(bearer(sew.token));
    expect(res.status).toBe(200);
    const ids = res.body.orders.map((o) => o.id);
    expect(ids).toContain(verifiedId);
    expect(ids).not.toContain(pendingId);
    expect(ids).not.toContain(rejectedId);
    expect(res.body.orders.every((o) => o.status === 'VERIFIED')).toBe(true);
  });

  it('the queue DB query itself is isolated (service layer, no HTTP)', async () => {
    const { listQueue } = require('../src/services/sewingService');
    const rows = await listQueue();
    expect(rows.every((o) => o.status === 'VERIFIED')).toBe(true);
    expect(rows.map((o) => o.id)).not.toContain(pendingId);
    expect(rows.map((o) => o.id)).not.toContain(rejectedId);
  });

  it('query-string tampering cannot widen the result', async () => {
    const res = await request(app)
      .get('/api/sewing/queue?status=PENDING_VERIFICATION&status=REJECTED')
      .set(bearer(sew.token));
    expect(res.status).toBe(200);
    expect(res.body.orders.every((o) => o.status === 'VERIFIED')).toBe(true);
  });

  it('unverified orders are invisible by id and cannot be started (404)', async () => {
    for (const id of [pendingId, rejectedId]) {
      expect((await request(app).get(`/api/sewing/${id}`).set(bearer(sew.token))).status).toBe(404);
      expect((await request(app).post(`/api/sewing/${id}/start`).set(bearer(sew.token))).status).toBe(404);
      expect(await dbOrderStatus(id)).not.toBe('SEWING_STARTED');
    }
  });

  it('cutting roles cannot read the sewing queue (403)', async () => {
    expect((await request(app).get('/api/sewing/queue').set(bearer(sup.token))).status).toBe(403);
    expect((await request(app).get('/api/sewing/queue').set(bearer(ver.token))).status).toBe(403);
    expect((await request(app).get('/api/sewing/queue')).status).toBe(401);
  });

  it('shows verifier attribution and piece counts, and sewing can start once', async () => {
    const detail = await request(app).get(`/api/sewing/${verifiedId}`).set(bearer(sew.token));
    expect(detail.status).toBe(200);
    expect(detail.body.order.verified_by_name).toBe('Test Verifier');
    expect(detail.body.order.items).toHaveLength(5);

    const start = await request(app).post(`/api/sewing/${verifiedId}/start`).set(bearer(sew.token));
    expect(start.status).toBe(200);
    expect(await dbOrderStatus(verifiedId)).toBe('SEWING_STARTED');

    const again = await request(app).post(`/api/sewing/${verifiedId}/start`).set(bearer(sew.token));
    expect(again.status).toBe(409);

    const queue = await request(app).get('/api/sewing/queue').set(bearer(sew.token));
    expect(queue.body.orders.map((o) => o.id)).not.toContain(verifiedId);
  });
});

// ---------------------------------------------------------------------------
describe('State machine and audit trail', () => {
  it('cannot approve or count an order twice / after a decision (409)', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id);
    expect((await approve(id, ver.token)).status).toBe(200);
    expect((await approve(id, ver.token)).status).toBe(409);
    expect((await reject(id, ver.token, { note: 'too late' })).status).toBe(409);

    const detail = await request(app).get(`/api/verification/${id}`).set(bearer(ver.token));
    const first = detail.body.order.items[0];
    const recount = await request(app)
      .post(`/api/verification/${id}/count`)
      .set(bearer(ver.token))
      .send({ counts: [{ component_id: first.component_id, actual_qty: 0 }] });
    expect(recount.status).toBe(409);
  });

  it('rejected order can be resubmitted by its creator and counts are reset', async () => {
    const id = await newOrder(sup.token, recipeId);
    await countOrder(ver.token, id, { 'Sleeve Cuffs': 19 });
    await reject(id, ver.token, { note: 'Cuffs short' });

    const res = await request(app).post(`/api/orders/${id}/resubmit`).set(bearer(sup.token)).send({});
    expect(res.status).toBe(200);
    expect(await dbOrderStatus(id)).toBe('PENDING_VERIFICATION');

    const left = await pool.query(
      'SELECT COUNT(*)::int AS n FROM verification_items WHERE order_id = $1 AND actual_qty IS NOT NULL',
      [id]
    );
    expect(left.rows[0].n).toBe(0);
    expect((await approve(id, ver.token)).status).toBe(422); // must be recounted first
  });

  it('verification_logs is immutable at the database level', async () => {
    const id = await newOrder(sup.token, recipeId);
    await reject(id, ver.token, { note: 'defect' });
    await expect(
      pool.query(`UPDATE verification_logs SET decision = 'APPROVED' WHERE order_id = $1`, [id])
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('DELETE FROM verification_logs WHERE order_id = $1', [id])
    ).rejects.toThrow(/immutable/);
  });

  it('illegal status jumps are blocked by the DB state-machine trigger', async () => {
    const id = await newOrder(sup.token, recipeId); // PENDING_VERIFICATION
    await expect(
      pool.query(`UPDATE cutting_orders SET status = 'SEWING_STARTED' WHERE id = $1`, [id])
    ).rejects.toThrow(/Illegal status transition/);
  });
});

// ---------------------------------------------------------------------------
describe('Order creation: multiplier engine and defensive input guards', () => {
  it('derives expected component counts (10 blouses => 20 cuffs)', async () => {
    const id = await newOrder(sup.token, recipeId);
    const res = await request(app).get(`/api/orders/${id}`).set(bearer(sup.token));
    const cuffs = res.body.order.items.find((i) => i.component_name === 'Sleeve Cuffs');
    expect(cuffs.expected_qty).toBe(20);
    expect(res.body.order.expected_fabric_yds).toBe(18);
    expect(res.body.order.wastage_pct).toBe(5);
  });

  const base = () => ({ recipe_id: recipeId, target_qty: 10, fabric_roll_id: 'FAB-1', actual_fabric_yds: 18 });
  const create = (body) => request(app).post('/api/orders').set(bearer(sup.token)).send(body);

  it.each([
    ['negative qty', { target_qty: -5 }],
    ['zero qty', { target_qty: 0 }],
    ['decimal qty', { target_qty: 2.5 }],
    ['string qty', { target_qty: '50' }],
    ['non-numeric qty', { target_qty: 'abc' }],
    ['empty roll id', { fabric_roll_id: '' }],
    ['whitespace roll id', { fabric_roll_id: '   ' }],
    ['zero fabric', { actual_fabric_yds: 0 }],
    ['negative fabric', { actual_fabric_yds: -3 }],
  ])('rejects %s with 400', async (_name, patch) => {
    const res = await create({ ...base(), ...patch });
    expect(res.status).toBe(400);
  });

  it('rejects an empty payload and an unknown recipe', async () => {
    expect((await create({})).status).toBe(400);
    expect((await create({ ...base(), recipe_id: 999999 })).status).toBe(404);
  });
});