import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

// The app is CommonJS: load it with Node's own require so there is no ESM/CJS interop surprise.
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = require('../src/app');
export const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// NEVER wipe a database unless it is clearly a separate test database.
export function assertSafeTestDb() {
  const test = process.env.TEST_DATABASE_URL;
  const dev = process.env.__DEV_DATABASE_URL;
  if (!test) {
    throw new Error('TEST_DATABASE_URL is not set in server/.env. Refusing to run destructive tests.');
  }
  if (test === dev) {
    throw new Error('TEST_DATABASE_URL equals DATABASE_URL. Use a separate Neon branch for tests.');
  }
}

const DEMO_USERS = [
  ['supervisor@demo.com', 'Supervisor@123', 'cutting_supervisor', 'Test Supervisor'],
  ['verifier@demo.com', 'Verifier@123', 'cutting_verifier', 'Test Verifier'],
  ['sewing@demo.com', 'Sewing@123', 'sewing_supervisor', 'Test Sewing'],
];

// Rebuilds schema + minimal seed on the TEST database.
export async function resetDatabase() {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  await pool.query(sql);

  for (const [email, password, role, name] of DEMO_USERS) {
    await pool.query(
      'INSERT INTO users (email, password_hash, role, full_name) VALUES ($1,$2,$3,$4)',
      [email, bcrypt.hashSync(password, 4), role, name]
    );
  }

  const r = await pool.query(
    `INSERT INTO recipes (recipe_code, name, category, std_fabric_yards, wastage_cap)
     VALUES ('REC-BL01','Casual Blouse','Blouse',1.8,5.0) RETURNING id`
  );
  const recipeId = r.rows[0].id;
  const comps = [
    ['Front Body Panel', 1],
    ['Back Body Panel', 1],
    ['Sleeves (Left & Right)', 2],
    ['Collar & Stand', 1],
    ['Sleeve Cuffs', 2],
  ];
  for (const [name, pieces] of comps) {
    await pool.query(
      'INSERT INTO recipe_components (recipe_id, component_name, pieces_per_garment) VALUES ($1,$2,$3)',
      [recipeId, name, pieces]
    );
  }
  return { recipeId };
}

export async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return { token: res.body.token, user: res.body.user };
}

// Supervisor creates an order (10 blouses => expected: 10/10/20/10/20). Returns the order id.
export async function newOrder(token, recipeId, overrides = {}) {
  const res = await request(app)
    .post('/api/orders')
    .set(bearer(token))
    .send({
      recipe_id: recipeId,
      target_qty: 10,
      fabric_roll_id: 'FAB-TEST-1',
      actual_fabric_yds: 18.9, // expected 18 yds => exactly 5% wastage
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`Order creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.order.id;
}

// Verifier counts every component. By default counts match expected exactly (all GREEN).
// overrides: { 'Sleeve Cuffs': 19 } sets a specific actual count by component name.
export async function countOrder(token, orderId, overrides = {}) {
  const detail = await request(app).get(`/api/verification/${orderId}`).set(bearer(token));
  const counts = detail.body.order.items.map((i) => ({
    component_id: i.component_id,
    actual_qty: overrides[i.component_name] ?? i.expected_qty,
  }));
  const res = await request(app)
    .post(`/api/verification/${orderId}/count`)
    .set(bearer(token))
    .send({ counts });
  if (res.status !== 200) throw new Error(`Count failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.order;
}

export const dbOrderStatus = async (id) =>
  (await pool.query('SELECT status FROM cutting_orders WHERE id = $1', [id])).rows[0].status;

export const dbLogs = async (id) =>
  (await pool.query('SELECT * FROM verification_logs WHERE order_id = $1 ORDER BY id', [id])).rows;