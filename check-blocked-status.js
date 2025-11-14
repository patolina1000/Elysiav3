#!/usr/bin/env node

/**
 * Script para verificar status de bloqueio dos usuários
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkBlockedStatus() {
  try {
    console.log('🔍 Verificando status de bloqueio dos usuários...\n');

    // Buscar bot vipshadriee_bot
    const botResult = await pool.query(
      "SELECT id, slug FROM bots WHERE slug = 'vipshadriee_bot'"
    );

    if (botResult.rows.length === 0) {
      console.log('❌ Bot vipshadriee_bot não encontrado');
      return;
    }

    const bot = botResult.rows[0];
    console.log(`✓ Bot encontrado: ${bot.slug} (id: ${bot.id})\n`);

    // Buscar todos os usuários do bot
    const usersResult = await pool.query(
      `SELECT telegram_id, blocked, first_seen_at, last_seen_at, last_start_at
       FROM bot_users 
       WHERE bot_id = $1
       ORDER BY last_seen_at DESC`,
      [bot.id]
    );

    console.log(`📊 Total de usuários: ${usersResult.rows.length}\n`);

    if (usersResult.rows.length === 0) {
      console.log('Nenhum usuário encontrado para este bot.');
      return;
    }

    // Contar ativos e bloqueados
    const active = usersResult.rows.filter(u => !u.blocked).length;
    const blocked = usersResult.rows.filter(u => u.blocked).length;

    console.log(`✅ Ativos: ${active}`);
    console.log(`🚫 Bloqueados: ${blocked}\n`);

    console.log('Detalhes dos usuários:');
    console.log('─'.repeat(80));

    usersResult.rows.forEach((user, index) => {
      const status = user.blocked ? '🚫 BLOQUEADO' : '✅ ATIVO';
      console.log(`${index + 1}. Telegram ID: ${user.telegram_id}`);
      console.log(`   Status: ${status}`);
      console.log(`   Primeira visita: ${user.first_seen_at}`);
      console.log(`   Última visita: ${user.last_seen_at}`);
      console.log(`   Último /start: ${user.last_start_at || 'Nunca'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await pool.end();
  }
}

checkBlockedStatus();
