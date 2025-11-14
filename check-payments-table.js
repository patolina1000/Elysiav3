#!/usr/bin/env node

/**
 * Verificar estrutura da tabela payments
 */

require('dotenv').config();
const { pool } = require('./src/db');

async function checkPaymentsTable() {
  try {
    console.log('[CHECK] Verificando estrutura da tabela payments...\n');

    // Verificar colunas da tabela
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'payments'
      ORDER BY ordinal_position
    `);

    console.log('Colunas da tabela payments:');
    console.log('─'.repeat(80));
    result.rows.forEach(col => {
      console.log(`${col.column_name.padEnd(25)} | ${col.data_type.padEnd(20)} | NULL: ${col.is_nullable}`);
    });
    console.log('─'.repeat(80));
    console.log(`\nTotal: ${result.rows.length} colunas\n`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('[ERRO]', error.message);
    await pool.end();
    process.exit(1);
  }
}

checkPaymentsTable();
