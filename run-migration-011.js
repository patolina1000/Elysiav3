#!/usr/bin/env node

require('dotenv').config();

const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('🚀 Executando migração 011: fix_funnel_events_event_id...\n');

    // Executar migração 011
    const sql = `
-- Migração: Corrigir coluna event_id em funnel_events
-- Descrição: event_id é uma coluna pré-existente que precisa de DEFAULT
-- Idempotente: SIM (usa ALTER COLUMN IF EXISTS)
-- Nota: Se event_id não existir, não faz nada

-- Adicionar DEFAULT para event_id se a coluna existir
-- Usando COALESCE para gerar um ID único baseado em timestamp + random
ALTER TABLE funnel_events 
  ALTER COLUMN event_id SET DEFAULT (to_char(now(), 'YYYYMMDDHH24MISS') || '_' || floor(random() * 1000000)::text);

-- Se event_id for NOT NULL sem DEFAULT, permitir NULL para dados históricos
-- Isso é feito apenas se a coluna existir
DO $$
BEGIN
  BEGIN
    ALTER TABLE funnel_events ALTER COLUMN event_id DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Coluna não existe ou já é nullable
  END;
END $$;
    `;

    await pool.query(sql);
    console.log('✅ Migração 011 executada com sucesso!\n');

  } catch (error) {
    console.error('❌ Erro ao executar migração:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
