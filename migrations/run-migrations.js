#!/usr/bin/env node

/**
 * Script para executar migrações do banco de dados
 * Uso: node run-migrations.js
 * 
 * Requer:
 * - DATABASE_URL em .env
 * - pg (npm install pg)
 * 
 * O script carrega automaticamente o .env da raiz do projeto
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não definida em .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Para Render.com
});

const migrationsDir = __dirname;
const migrations = [
  '001_add_bot_users.sql',
  '002_add_tracking_sessions.sql',
  '003_extend_funnel_events.sql',
  '004_extend_payments.sql',
  '005_add_bot_admin_fields.sql',
  '006_add_token_validation.sql',
  '007_add_bot_config_tables.sql',
  '008_add_queue_tables.sql',
  '009_extend_payments_pix.sql',
  '010_extend_shots_filter_criteria.sql',
  '014_fix_bot_messages_content_json.sql',
  '019_add_webhook_secret_token.sql',
  '019_add_blocked_to_bot_users.sql',
  '020_add_price_cents_to_funnel_events.sql',
  '021_add_trigger_type_to_bot_downsells.sql',
  '022_add_shot_scheduling_fields.sql'
];

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('🚀 Iniciando migrações do banco de dados...\n');

    for (const migration of migrations) {
      const filePath = path.join(migrationsDir, migration);
      
      if (!fs.existsSync(filePath)) {
        console.error(`❌ Arquivo não encontrado: ${migration}`);
        process.exit(1);
      }

      const sql = fs.readFileSync(filePath, 'utf-8');
      
      try {
        console.log(`⏳ Executando: ${migration}`);
        await client.query(sql);
        console.log(`✅ ${migration} - OK\n`);
      } catch (error) {
        console.error(`❌ Erro ao executar ${migration}:`);
        console.error(error.message);
        process.exit(1);
      }
    }

    console.log('✨ Todas as migrações executadas com sucesso!\n');

    // Verificação rápida
    console.log('📊 Verificação rápida do esquema:\n');

    const checks = [
      { query: 'SELECT COUNT(*) FROM bot_users;', name: 'bot_users' },
      { query: 'SELECT COUNT(*) FROM tracking_sessions;', name: 'tracking_sessions' },
      { query: 'SELECT COUNT(*) FROM funnel_events LIMIT 1;', name: 'funnel_events' },
      { query: 'SELECT COUNT(*) FROM payments LIMIT 1;', name: 'payments' },
      { query: 'SELECT COUNT(*) FROM bot_messages LIMIT 1;', name: 'bot_messages' },
      { query: 'SELECT COUNT(*) FROM bot_downsells LIMIT 1;', name: 'bot_downsells' },
      { query: 'SELECT COUNT(*) FROM shots LIMIT 1;', name: 'shots' },
      { query: 'SELECT COUNT(*) FROM downsells_queue LIMIT 1;', name: 'downsells_queue' },
      { query: 'SELECT COUNT(*) FROM shots_queue LIMIT 1;', name: 'shots_queue' }
    ];

    for (const check of checks) {
      try {
        await client.query(check.query);
        console.log(`✅ ${check.name} - Acessível`);
      } catch (error) {
        console.error(`❌ ${check.name} - Erro: ${error.message}`);
      }
    }

    console.log('\n🎉 Banco de dados pronto para uso!');

  } catch (error) {
    console.error('❌ Erro geral:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
