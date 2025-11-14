const {Pool} = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {rejectUnauthorized: false}
});

async function fix() {
  await pool.query('UPDATE downsells_queue SET status = $1 WHERE id = $2', ['canceled', 97]);
  console.log('✅ Job 97 marcado como canceled');
  await pool.end();
}

fix();
