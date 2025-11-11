-- Migração: Adicionar campo de grupo de aquecimento (warmup)
-- Descrição: Adiciona suporte a warmup de mídias em um grupo específico
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Campo para armazenar ID do chat/grupo de aquecimento
ALTER TABLE bots ADD COLUMN IF NOT EXISTS warmup_chat_id BIGINT NULL;

-- Índice para buscar bots com warmup configurado
CREATE INDEX IF NOT EXISTS idx_bots_warmup_configured 
  ON bots(warmup_chat_id) 
  WHERE warmup_chat_id IS NOT NULL;
