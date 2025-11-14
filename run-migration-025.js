#!/usr/bin/env node

/**
 * Script para executar migração 025_add_payment_fields.sql
 * Adiciona campos para integração PushinPay
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/db');

async function runMigration() {
  try {
    console.log('[MIGRATION] Iniciando migração 025_add_payment_fields...');

    const migrationPath = path.join(__dirname, 'migrations', '025_add_payment_fields.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await pool.query(sql);

    console.log('[MIGRATION] ✓ Migração 025 executada com sucesso');
    console.log('[MIGRATION] Campos adicionados:');
    console.log('  - bot_users.has_purchase (BOOLEAN)');
    console.log('  - payments.updated_at (TIMESTAMPTZ)');
    console.log('  - gateway_events (tabela criada se não existir)');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('[MIGRATION] ✗ Erro ao executar migração:', error.message);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
