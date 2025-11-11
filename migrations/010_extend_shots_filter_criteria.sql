-- Migração: Adicionar colunas faltantes à tabela shots
-- Descrição: Adiciona filter_criteria e active para suporte completo a shots
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE shots ADD COLUMN IF NOT EXISTS filter_criteria JSONB;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- Índice para performance em queries de shots com filtros
CREATE INDEX IF NOT EXISTS idx_shots_filter_criteria 
  ON shots USING GIN(filter_criteria);

-- Índice para queries de shots ativos
CREATE INDEX IF NOT EXISTS idx_shots_active 
  ON shots(active);
