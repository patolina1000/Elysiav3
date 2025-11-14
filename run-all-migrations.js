#!/usr/bin/env node

/**
 * Script para executar todas as migrações SQL pendentes
 * Roda migrações em ordem numérica
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/db');

async function runAllMigrations() {
  try {
    console.log('[MIGRATIONS] Iniciando execução de migrações...\n');

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Ordem alfabética = ordem numérica (001, 002, etc.)

    console.log(`[MIGRATIONS] Encontradas ${files.length} migrações:\n`);

    let executed = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      const migrationPath = path.join(migrationsDir, file);
      
      try {
        console.log(`[MIGRATIONS] Executando: ${file}`);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        await pool.query(sql);
        
        console.log(`[MIGRATIONS] ✓ ${file} executada com sucesso\n`);
        executed++;
      } catch (error) {
        // Se erro for "already exists" ou "duplicate", é porque já foi executada
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate') ||
          error.message.includes('does not exist')
        ) {
          console.log(`[MIGRATIONS] ⊘ ${file} já executada ou não aplicável\n`);
          skipped++;
        } else {
          console.error(`[MIGRATIONS] ✗ Erro ao executar ${file}:`);
          console.error(`  ${error.message}\n`);
          failed++;
        }
      }
    }

    console.log('[MIGRATIONS] Resumo:');
    console.log(`  ✓ Executadas: ${executed}`);
    console.log(`  ⊘ Puladas: ${skipped}`);
    console.log(`  ✗ Falhadas: ${failed}`);
    console.log(`  Total: ${files.length}\n`);

    if (failed > 0) {
      console.warn('[MIGRATIONS] ⚠ Algumas migrações falharam. Verifique os erros acima.');
    } else {
      console.log('[MIGRATIONS] ✓ Todas as migrações foram processadas com sucesso!');
    }

    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('[MIGRATIONS] ✗ Erro fatal:', error.message);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

runAllMigrations();
