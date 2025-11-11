/**
 * Módulo centralizado de conexão com PostgreSQL
 * 
 * Responsabilidades:
 * - Criar e exportar um único Pool de conexões
 * - Validar DATABASE_URL na inicialização
 * - Configurar SSL para ambientes remotos (Render, Heroku, etc.)
 * 
 * Uso:
 * const { pool } = require('./db');
 * const result = await pool.query('SELECT * FROM bots');
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
console.log('[DB] Procurando .env em:', envPath);
console.log('[DB] .env existe:', fs.existsSync(envPath) ? 'SIM' : 'NÃO');

require('dotenv').config({ path: envPath });
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

console.log('[DB] DATABASE_URL carregada:', connectionString ? 'SIM (primeiros 50 chars: ' + connectionString.substring(0, 50) + '...)' : 'NÃO');

if (!connectionString) {
  console.error('[ERRO] DATABASE_URL não está definida no .env');
  console.error('[ERRO] Configure DATABASE_URL com a string de conexão do Postgres');
  console.error('[ERRO] NODE_ENV:', process.env.NODE_ENV);
  console.error('[ERRO] CWD:', process.cwd());
  process.exit(1);
}

// Criar pool com SSL para ambientes remotos (Render, Heroku, etc.)
// SSL é necessário para conexões remotas seguras
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Listeners para eventos de erro do pool
pool.on('error', (err) => {
  console.error('[ERRO][DB_POOL] Erro não tratado no pool:', err.message);
});

pool.on('connect', () => {
  console.log('[INFO][DB] Nova conexão estabelecida com o banco');
});

module.exports = { pool };
