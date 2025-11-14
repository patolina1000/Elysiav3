-- Migração: Adicionar campo blocked em bot_users
-- Descrição: Rastreia se o usuário bloqueou o bot
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE bot_users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice para queries de usuários bloqueados/ativos por bot
CREATE INDEX IF NOT EXISTS idx_bot_users_bot_id_blocked 
  ON bot_users(bot_id, blocked);

-- Índice parcial para usuários bloqueados (menor, mais rápido)
CREATE INDEX IF NOT EXISTS idx_bot_users_blocked_true 
  ON bot_users(bot_id) 
  WHERE blocked = TRUE;

-- Índice parcial para usuários ativos (não bloqueados)
CREATE INDEX IF NOT EXISTS idx_bot_users_blocked_false 
  ON bot_users(bot_id) 
  WHERE blocked = FALSE;
