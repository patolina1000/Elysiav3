-- Migração: Adicionar campos de cliente e origem aos pagamentos
-- Descrição: Adiciona customer_first_name, customer_last_name, source_kind, source_slug
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Campos do cliente (nome do pagador vindo do webhook)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_first_name TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_last_name TEXT;

-- Campos de origem da compra (de onde veio: /start, downsell, shot)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source_slug TEXT;

-- Índices para performance em queries de listagem de usuários
CREATE INDEX IF NOT EXISTS idx_payments_bot_id_status 
  ON payments(bot_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_source_kind 
  ON payments(source_kind) 
  WHERE source_kind IS NOT NULL;

-- Comentários para documentação
COMMENT ON COLUMN payments.customer_first_name IS 'Primeiro nome do pagador (vindo do webhook do gateway)';
COMMENT ON COLUMN payments.customer_last_name IS 'Sobrenome do pagador (vindo do webhook do gateway)';
COMMENT ON COLUMN payments.source_kind IS 'Tipo de origem: start, downsell, shot';
COMMENT ON COLUMN payments.source_slug IS 'Slug/identificador da origem (ex: downsell_1, shot_promo)';
