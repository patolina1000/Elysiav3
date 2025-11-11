-- Migração: Adicionar campos administrativos à tabela bots
-- Descrição: Adiciona campos name e active para gerenciamento de bots via dashboard
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE bots ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE bots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Índice para queries de bots ativos
CREATE INDEX IF NOT EXISTS idx_bots_active 
  ON bots(active);

-- Índice para buscar por slug (já deve existir, mas garantindo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_slug 
  ON bots(slug);
