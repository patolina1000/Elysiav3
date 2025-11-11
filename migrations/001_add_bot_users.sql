-- Migração: Criar tabela bot_users
-- Descrição: Rastreia usuários por bot, com timestamps e status de pagamento
-- Idempotente: SIM (usa CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS bot_users (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_start_at TIMESTAMPTZ,
  has_paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice único: um usuário por bot
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_users_bot_id_telegram_id 
  ON bot_users(bot_id, telegram_id);

-- Índice simples: buscar por bot
CREATE INDEX IF NOT EXISTS idx_bot_users_bot_id 
  ON bot_users(bot_id);

-- Índice para queries por data
CREATE INDEX IF NOT EXISTS idx_bot_users_first_seen_at 
  ON bot_users(first_seen_at);

CREATE INDEX IF NOT EXISTS idx_bot_users_last_seen_at 
  ON bot_users(last_seen_at);
