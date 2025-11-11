-- Migração: Adicionar campos de validação de token e gateway padrão
-- Descrição: Adiciona suporte a validação de token Telegram e seleção de gateway padrão
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Campo de gateway padrão (PushinPay ou SyncPay)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS gateway_default TEXT NOT NULL DEFAULT 'pushinpay';

-- Token do bot Telegram (criptografado em repouso)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS token_encrypted TEXT NULL;

-- Status de validação do token: unverified|validated|invalid
ALTER TABLE bots ADD COLUMN IF NOT EXISTS token_status TEXT NOT NULL DEFAULT 'unverified';

-- Timestamp da última verificação do token
ALTER TABLE bots ADD COLUMN IF NOT EXISTS token_checked_at TIMESTAMPTZ NULL;

-- Username do bot Telegram (@username)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS bot_username TEXT NULL;

-- Nome do bot Telegram (first_name)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS bot_name TEXT NULL;

-- Índice para buscar bots por status de validação (útil para queries de admin)
CREATE INDEX IF NOT EXISTS idx_bots_token_status 
  ON bots(token_status);

-- Índice para buscar bots validados (para ativar apenas bots com token válido)
CREATE INDEX IF NOT EXISTS idx_bots_validated 
  ON bots(token_status, active);
