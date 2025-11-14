/**
 * Script para executar migration 024 - broadcast_waves_queue
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Carregar .env
require('dotenv').config();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('[MIGRATION] Conectando ao banco...');
    
    // Ler arquivo SQL
    const sqlPath = path.join(__dirname, 'migrations', '024_add_broadcast_waves_queue.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('[MIGRATION] Executando migration 024_add_broadcast_waves_queue.sql...');
    
    // Executar SQL
    await pool.query(sql);
    
    console.log('[MIGRATION] ✓ Migration executada com sucesso!');
    
    // Verificar tabela
    const result = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'broadcast_waves_queue'
      ORDER BY ordinal_position
    `);
    
    console.log(`[MIGRATION] ✓ Tabela criada com ${result.rows.length} colunas:`);
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    // Verificar índices
    const indexes = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'broadcast_waves_queue'
    `);
    
    console.log(`[MIGRATION] ✓ ${indexes.rows.length} índices criados:`);
    indexes.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });
    
  } catch (error) {
    console.error('[ERRO][MIGRATION]', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
