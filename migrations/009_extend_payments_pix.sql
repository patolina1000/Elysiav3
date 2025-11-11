-- Migração: Estender tabela payments com colunas de PIX
-- Descrição: Adiciona colunas para armazenar dados de cobrança PIX
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_cents INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_charge_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_qr_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_payments_gateway_charge_id 
  ON payments(gateway_charge_id);

CREATE INDEX IF NOT EXISTS idx_payments_expires_at 
  ON payments(expires_at);
