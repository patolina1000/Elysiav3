const {Pool} = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {rejectUnauthorized: false}
});

async function createDownsells() {
  console.log('📝 Criando downsells para bot 14...\n');

  // Downsell após /start
  const ds1 = await pool.query(
    `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (bot_id, slug) DO UPDATE 
     SET name = EXCLUDED.name, content = EXCLUDED.content, delay_seconds = EXCLUDED.delay_seconds, 
         active = EXCLUDED.active, trigger_type = EXCLUDED.trigger_type, updated_at = NOW()
     RETURNING id, slug, trigger_type`,
    [14, 'downsell-start-60s', 'Downsell Start 60s', JSON.stringify({ text: '🎯 Ei! Ainda está aí? Temos uma oferta especial para você!' }), 60, true, 'start']
  );
  console.log(`✅ Downsell criado: ID ${ds1.rows[0].id}, trigger: ${ds1.rows[0].trigger_type}`);

  // Downsell após PIX
  const ds2 = await pool.query(
    `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (bot_id, slug) DO UPDATE 
     SET name = EXCLUDED.name, content = EXCLUDED.content, delay_seconds = EXCLUDED.delay_seconds, 
         active = EXCLUDED.active, trigger_type = EXCLUDED.trigger_type, updated_at = NOW()
     RETURNING id, slug, trigger_type`,
    [14, 'downsell-pix-60s', 'Downsell PIX 60s', JSON.stringify({ text: '💰 Ainda não pagou? Aproveite essa condição especial!' }), 60, true, 'pix']
  );
  console.log(`✅ Downsell criado: ID ${ds2.rows[0].id}, trigger: ${ds2.rows[0].trigger_type}`);

  // Verificar
  const check = await pool.query('SELECT id, slug, trigger_type, active FROM bot_downsells WHERE bot_id = 14');
  console.log(`\n📋 Downsells do bot 14: ${check.rows.length} total`);
  check.rows.forEach(d => {
    console.log(`  - [${d.trigger_type}] ${d.slug} (active: ${d.active})`);
  });

  await pool.end();
  console.log('\n✅ Pronto! Agora envie /start no bot 14');
}

createDownsells();
