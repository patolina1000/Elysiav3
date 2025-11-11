-- Migração: Adicionar colunas faltantes às tabelas de configuração de bots
-- Descrição: Adiciona slug e outras colunas às tabelas existentes
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Adicionar coluna slug a bot_messages se não existir
ALTER TABLE bot_messages ADD COLUMN IF NOT EXISTS slug TEXT;

-- Adicionar coluna slug a bot_downsells se não existir
ALTER TABLE bot_downsells ADD COLUMN IF NOT EXISTS slug TEXT;

-- Adicionar coluna slug a shots se não existir
ALTER TABLE shots ADD COLUMN IF NOT EXISTS slug TEXT;

-- Criar índices se não existirem
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_messages_bot_id_slug 
  ON bot_messages(bot_id, slug);

CREATE INDEX IF NOT EXISTS idx_bot_messages_bot_id 
  ON bot_messages(bot_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_downsells_bot_id_slug 
  ON bot_downsells(bot_id, slug);

CREATE INDEX IF NOT EXISTS idx_bot_downsells_bot_id 
  ON bot_downsells(bot_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shots_bot_id_slug 
  ON shots(bot_id, slug);

CREATE INDEX IF NOT EXISTS idx_shots_bot_id 
  ON shots(bot_id);
