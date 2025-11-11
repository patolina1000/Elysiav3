-- Migração: Estender tabela payments com colunas de rastreamento
-- Descrição: Adiciona colunas para melhor rastreamento de pagamentos e integração com funil
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE payments ADD COLUMN IF NOT EXISTS bot_id BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bot_user_id BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS value_cents INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS meta JSONB;

-- Índices para performance em queries comuns
CREATE INDEX IF NOT EXISTS idx_payments_bot_id 
  ON payments(bot_id);

CREATE INDEX IF NOT EXISTS idx_payments_bot_user_id 
  ON payments(bot_user_id);

CREATE INDEX IF NOT EXISTS idx_payments_gateway_external_id 
  ON payments(gateway, external_id);

CREATE INDEX IF NOT EXISTS idx_payments_status 
  ON payments(status);

CREATE INDEX IF NOT EXISTS idx_payments_created_at 
  ON payments(created_at);

-- Índice composto para queries de pagamentos por bot e período
CREATE INDEX IF NOT EXISTS idx_payments_bot_id_created_at 
  ON payments(bot_id, created_at);

-- Índice para buscar pagamentos pendentes
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at 
  ON payments(status, created_at) 
  WHERE status IN ('pending', 'processing');
