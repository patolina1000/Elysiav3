-- Migração: Adicionar campos para integração PushinPay
-- Descrição: Adiciona campos faltantes em bot_users e ajusta payments
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Adicionar has_purchase em bot_users
ALTER TABLE bot_users ADD COLUMN IF NOT EXISTS has_purchase BOOLEAN DEFAULT FALSE;

-- Criar índice para buscar clientes
CREATE INDEX IF NOT EXISTS idx_bot_users_has_purchase 
  ON bot_users(bot_id, has_purchase) 
  WHERE has_purchase = TRUE;

-- Adicionar updated_at em payments se não existir
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
