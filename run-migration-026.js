/**
 * Script para executar migration 026
 * Adiciona campos de cliente e origem aos pagamentos
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('[MIGRATION_026] Conectando ao banco...');
    
    const migrationPath = path.join(__dirname, 'migrations', '026_add_payment_customer_source.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('[MIGRATION_026] Executando migration...');
    await pool.query(sql);
    
    console.log('[MIGRATION_026] ✓ Migration executada com sucesso!');
    console.log('[MIGRATION_026] Colunas adicionadas:');
    console.log('  - payments.customer_first_name');
    console.log('  - payments.customer_last_name');
    console.log('  - payments.source_kind');
    console.log('  - payments.source_slug');
    
    // Verificar se as colunas foram criadas
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' 
        AND column_name IN ('customer_first_name', 'customer_last_name', 'source_kind', 'source_slug')
      ORDER BY column_name
    `);
    
    console.log('[MIGRATION_026] Verificação:');
    checkResult.rows.forEach(row => {
      console.log(`  ✓ ${row.column_name}`);
    });
    
  } catch (error) {
    console.error('[MIGRATION_026] ✗ Erro:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
