-- Migration 019: Adicionar webhook_secret_token à tabela bots
-- Para validação rápida de origem no webhook (X-Telegram-Bot-Api-Secret-Token)

ALTER TABLE bots 
ADD COLUMN IF NOT EXISTS webhook_secret_token VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_bots_webhook_secret_token 
ON bots(webhook_secret_token) 
WHERE webhook_secret_token IS NOT NULL;

COMMENT ON COLUMN bots.webhook_secret_token IS 'Secret token do webhook do Telegram para validação de origem';
