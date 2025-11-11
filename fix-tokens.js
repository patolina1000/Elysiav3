#!/usr/bin/env node

/**
 * Script para limpar tokens inválidos do banco de dados
 * Executa quando há erro de descriptografia (chave mudou)
 * 
 * Uso: node fix-tokens.js
 */

require('dotenv').config();

const { Pool } = require('pg');

async function fixTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('[FIX-TOKENS] Conectando ao banco de dados...');
    await pool.query('SELECT 1');
    console.log('[FIX-TOKENS] ✓ Conectado com sucesso');

    // Buscar bots com tokens inválidos
    console.log('[FIX-TOKENS] Buscando bots com tokens...');
    const result = await pool.query(
      `SELECT id, slug, token_status, active FROM bots WHERE token_encrypted IS NOT NULL`
    );

    if (result.rows.length === 0) {
      console.log('[FIX-TOKENS] Nenhum bot com token encontrado');
      await pool.end();
      return;
    }

    console.log(`[FIX-TOKENS] Encontrados ${result.rows.length} bot(s) com token`);

    // Limpar tokens inválidos
    console.log('[FIX-TOKENS] Limpando tokens inválidos...');
    const updateResult = await pool.query(
      `UPDATE bots 
       SET token_encrypted = NULL,
           token_status = 'unverified',
           token_checked_at = NULL,
           updated_at = NOW()
       WHERE token_encrypted IS NOT NULL`
    );

    console.log(`[FIX-TOKENS] ✓ ${updateResult.rowCount} bot(s) atualizado(s)`);

    // Verificar resultado
    const verifyResult = await pool.query(
      `SELECT id, slug, token_status, active FROM bots WHERE active = TRUE`
    );

    console.log('[FIX-TOKENS] Status dos bots ativos:');
    verifyResult.rows.forEach(bot => {
      console.log(`  - ${bot.slug}: token_status=${bot.token_status}`);
    });

    console.log('[FIX-TOKENS] ✓ Tokens limpos com sucesso!');
    console.log('[FIX-TOKENS] Próximo passo: Validar tokens novamente via admin panel');

    await pool.end();
  } catch (error) {
    console.error('[FIX-TOKENS] Erro:', error.message);
    process.exit(1);
  }
}

fixTokens();
