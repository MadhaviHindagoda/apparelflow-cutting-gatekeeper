require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const USERS = [
  { email: 'supervisor@demo.com', password: 'Supervisor@123', role: 'cutting_supervisor', full_name: 'Nimal Perera (Cutting Supervisor)' },
  { email: 'verifier@demo.com',   password: 'Verifier@123',   role: 'cutting_verifier',   full_name: 'Kamala Silva (Cutting Verifier)' },
  { email: 'sewing@demo.com',     password: 'Sewing@123',     role: 'sewing_supervisor',  full_name: 'Sunil Fernando (Sewing Supervisor)' },
];

const RECIPES = [
  {
    recipe_code: 'REC-BL01', name: 'Casual Blouse', category: 'Blouse',
    std_fabric_yards: 1.8, wastage_cap: 5.0,
    components: [
      ['Front Body Panel', 1],
      ['Back Body Panel', 1],
      ['Sleeves (Left & Right)', 2],
      ['Collar & Stand', 1],
      ['Sleeve Cuffs', 2],
    ],
  },
  {
    recipe_code: 'REC-CT02', name: 'Crop Top', category: 'Crop Top',
    std_fabric_yards: 1.1, wastage_cap: 8.0,
    components: [
      ['Front Chest Panel', 1],
      ['Back Support Panel', 1],
      ['Neck Binding Strip', 1],
      ['Hem Elastic Casing', 1],
      ['Side Strap Accents', 2],
    ],
  },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users (idempotent: re-running resets demo passwords)
    for (const u of USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               role = EXCLUDED.role,
               full_name = EXCLUDED.full_name`,
        [u.email, hash, u.role, u.full_name]
      );
    }

    // Recipes + components (idempotent)
    for (const r of RECIPES) {
      const { rows } = await client.query(
        `INSERT INTO recipes (recipe_code, name, category, std_fabric_yards, wastage_cap)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (recipe_code) DO UPDATE
           SET name = EXCLUDED.name,
               category = EXCLUDED.category,
               std_fabric_yards = EXCLUDED.std_fabric_yards,
               wastage_cap = EXCLUDED.wastage_cap
         RETURNING id`,
        [r.recipe_code, r.name, r.category, r.std_fabric_yards, r.wastage_cap]
      );
      const recipeId = rows[0].id;

      for (const [name, pieces] of r.components) {
        await client.query(
          `INSERT INTO recipe_components (recipe_id, component_name, pieces_per_garment)
           VALUES ($1, $2, $3)
           ON CONFLICT (recipe_id, component_name) DO UPDATE
             SET pieces_per_garment = EXCLUDED.pieces_per_garment`,
          [recipeId, name, pieces]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Seed completed: 3 users, 2 recipes, 10 components');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();