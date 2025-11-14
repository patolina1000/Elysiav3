#!/usr/bin/env node

/**
 * Listar últimos pagamentos
 */

require('dotenv').config();
const { pool } = require('./src/db');

async function listPayments() {
  try {
    const result = await pool.query(`
      SELECT id, bot_id, value_cents, status, gateway_charge_id, created_at, paid_at
      FROM payments
      WHERE bot_id = 14
      ORDER BY id DESC
      LIMIT 10
    `);

    console.log('\n=== Últimos 10 Pagamentos (Bot 14) ===\n');
    console.log('ID  | Valor     | Status    | Criado em           | Pago em');
    console.log('─'.repeat(80));

    result.rows.forEach(p => {
      const valor = `R$ ${(p.value_cents / 100).toFixed(2)}`.padEnd(10);
      const status = p.status.padEnd(10);
      const criado = p.created_at.toISOString().substring(0, 19).replace('T', ' ');
      const pago = p.paid_at ? p.paid_at.toISOString().substring(0, 19).replace('T', ' ') : 'N/A';
      
      console.log(`${String(p.id).padEnd(4)}| ${valor}| ${status}| ${criado} | ${pago}`);
    });

    console.log('\n');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Erro:', error.message);
    await pool.end();
    process.exit(1);
  }
}

listPayments();
