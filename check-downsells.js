const {Pool} = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {rejectUnauthorized: false}
});

async function check() {
  // 1. Ver downsells cadastrados
  const downsells = await pool.query('SELECT id, bot_id, slug, trigger_type, active FROM bot_downsells WHERE bot_id IN (14, 15) ORDER BY bot_id, trigger_type');
  console.log('\n📋 Downsells cadastrados:');
  downsells.rows.forEach(d => {
    console.log(`  Bot ${d.bot_id}: [${d.trigger_type}] ${d.slug} (active: ${d.active})`);
  });

  // 2. Ver fila atual
  const queue = await pool.query('SELECT id, bot_id, downsell_id, status, schedule_at FROM downsells_queue WHERE bot_id IN (14, 15) ORDER BY created_at DESC LIMIT 10');
  console.log('\n📬 Fila de downsells:');
  queue.rows.forEach(q => {
    console.log(`  Job ${q.id}: Bot ${q.bot_id}, Downsell ${q.downsell_id}, Status: ${q.status}`);
  });

  // 3. Ver constraint da fila
  const constraint = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) as definition
    FROM pg_constraint
    WHERE conrelid = 'downsells_queue'::regclass
    AND conname LIKE '%status%'
  `);
  console.log('\n🔒 Constraint de status:');
  constraint.rows.forEach(c => {
    console.log(`  ${c.conname}: ${c.definition}`);
  });

  await pool.end();
}

check();
