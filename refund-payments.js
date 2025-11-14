#!/usr/bin/env node

/**
 * Script para marcar pagamentos como reembolsados
 * Uso: node refund-payments.js <payment_id1> <payment_id2> <payment_id3> ...
 */

require('dotenv').config();
const { pool } = require('./src/db');

async function refundPayments() {
  const paymentIds = process.argv.slice(2);

  if (paymentIds.length === 0) {
    console.error('Uso: node refund-payments.js <payment_id1> <payment_id2> ...');
    console.error('Exemplo: node refund-payments.js 13 14 15');
    process.exit(1);
  }

  try {
    console.log(`[REFUND] Processando ${paymentIds.length} reembolso(s)...\n`);

    for (const paymentId of paymentIds) {
      // Buscar pagamento
      const payment = await pool.query(
        'SELECT id, bot_id, value_cents, status FROM payments WHERE id = $1',
        [paymentId]
      );

      if (payment.rows.length === 0) {
        console.warn(`[REFUND] ✗ Pagamento ${paymentId} não encontrado`);
        continue;
      }

      const p = payment.rows[0];

      if (p.status === 'refunded') {
        console.log(`[REFUND] ⊘ Pagamento ${paymentId} já está reembolsado`);
        continue;
      }

      if (p.status !== 'paid') {
        console.warn(`[REFUND] ✗ Pagamento ${paymentId} não está pago (status: ${p.status})`);
        continue;
      }

      // Marcar como reembolsado
      await pool.query(
        'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
        ['refunded', paymentId]
      );

      const valorReais = (p.value_cents / 100).toFixed(2);
      console.log(`[REFUND] ✓ Pagamento ${paymentId} reembolsado: R$ ${valorReais} (bot_id: ${p.bot_id})`);
    }

    console.log('\n[REFUND] Concluído!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('[REFUND] Erro:', error.message);
    await pool.end();
    process.exit(1);
  }
}

refundPayments();
