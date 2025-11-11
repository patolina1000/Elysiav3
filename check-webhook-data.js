#!/usr/bin/env node

require('dotenv').config();

const { Pool } = require('pg');

async function checkData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('📊 Verificando dados após webhook...\n');

    // Verificar bot_users
    console.log('=== BOT_USERS ===');
    const botUsersResult = await pool.query(
      'SELECT id, bot_id, telegram_id, first_seen_at, last_start_at FROM bot_users WHERE telegram_id = 7205343917 LIMIT 5'
    );
    console.log(botUsersResult.rows);

    // Verificar funnel_events
    console.log('\n=== FUNNEL_EVENTS ===');
    const funnelResult = await pool.query(
      'SELECT id, event_name, bot_id, bot_user_id, telegram_id, occurred_at FROM funnel_events WHERE telegram_id = 7205343917 ORDER BY occurred_at DESC LIMIT 5'
    );
    console.log(funnelResult.rows);

    // Verificar bot_messages
    console.log('\n=== BOT_MESSAGES (para bot_id=14) ===');
    const messagesResult = await pool.query(
      'SELECT id, bot_id, slug, content FROM bot_messages WHERE bot_id = 14 LIMIT 5'
    );
    console.log(messagesResult.rows);

    console.log('\n✅ Verificação concluída!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkData();
