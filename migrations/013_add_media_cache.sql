-- Migração: Criar tabela de cache de mídia para warmup
-- Descrição: Armazena file_id do Telegram após warmup de mídias
-- Idempotente: SIM (usa CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS media_cache (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'audio', 'document')),
  tg_file_id TEXT NULL,
  tg_file_unique_id TEXT NULL,
  warmup_chat_id BIGINT NULL,
  warmup_message_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'error')),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_media_cache_bot_key 
  ON media_cache(bot_id, media_key);

CREATE INDEX IF NOT EXISTS idx_media_cache_status 
  ON media_cache(bot_id, status);

CREATE INDEX IF NOT EXISTS idx_media_cache_file_id 
  ON media_cache(tg_file_id) 
  WHERE tg_file_id IS NOT NULL;
