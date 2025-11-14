/**
 * Script para executar migration 027 - shot_plans_history
 * Cria tabela para armazenar planos de shots deletados
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Carregar .env
require('dotenv').config();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('[MIGRATION_027] Conectando ao banco...');
    
    // Ler arquivo SQL
    const sqlPath = path.join(__dirname, 'migrations', '027_add_shot_plans_history.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('[MIGRATION_027] Executando migration 027_add_shot_plans_history.sql...');
    
    // Executar SQL
    await pool.query(sql);
    
    console.log('[MIGRATION_027] ✓ Migration executada com sucesso!');
    
    // Verificar tabela
    const result = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'shot_plans_history'
      ORDER BY ordinal_position
    `);
    
    console.log(`[MIGRATION_027] ✓ Tabela criada com ${result.rows.length} colunas:`);
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    // Verificar índices
    const indexes = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'shot_plans_history'
    `);
    
    console.log(`[MIGRATION_027] ✓ ${indexes.rows.length} índices criados:`);
    indexes.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });
    
    console.log('\n[MIGRATION_027] 🎯 Funcionalidade:');
    console.log('  Quando um shot é deletado após envio completo,');
    console.log('  seus planos são salvos nesta tabela para que');
    console.log('  os botões de pagamento continuem funcionando.');
    
  } catch (error) {
    console.error('[ERRO][MIGRATION_027]', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
