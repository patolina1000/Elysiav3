#!/usr/bin/env node

/**
 * Script para debugar descriptografia de tokens
 * Busca token_encrypted do banco e tenta descriptografar
 */

require('dotenv').config();

const { Pool } = require('pg');
const { getCryptoService } = require('./src/modules/crypto-singleton');

async function debugDecrypt() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('[DEBUG] Conectando ao banco...');
    const result = await pool.query(
      `SELECT id, slug, token_encrypted, token_status, bot_username 
       FROM bots WHERE active = TRUE AND token_encrypted IS NOT NULL`
    );

    if (result.rows.length === 0) {
      console.log('[DEBUG] Nenhum bot encontrado');
      await pool.end();
      return;
    }

    console.log(`[DEBUG] Encontrado(s) ${result.rows.length} bot(s) com token:\n`);

    for (const bot of result.rows) {
      console.log(`========================================`);
      console.log(`Bot: ${bot.slug} (ID: ${bot.id})`);
      console.log(`Status: ${bot.token_status}`);
      console.log(`Username: ${bot.bot_username || 'N/A'}`);
      console.log(`Token encrypted type: ${typeof bot.token_encrypted}`);
      console.log(`Token encrypted is Buffer: ${Buffer.isBuffer(bot.token_encrypted)}`);
      console.log(`\nTentando descriptografar DIRETO (sem conversão)...`);
      
      const crypto = getCryptoService();
      const decrypted = crypto.decrypt(bot.token_encrypted);
      
      if (decrypted) {
        console.log(`✓ Descriptografia bem-sucedida!`);
        console.log(`Token descriptografado (mascarado): ${decrypted.substring(0, 10)}...${decrypted.substring(decrypted.length - 6)}`);
      } else {
        console.log(`✗ Falha ao descriptografar`);
      }
      console.log(`========================================\n`);
    }

    await pool.end();
  } catch (error) {
    console.error('[DEBUG] Erro:', error.message);
    console.error(error);
    process.exit(1);
  }
}

debugDecrypt();
