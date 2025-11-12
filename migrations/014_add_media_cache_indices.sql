-- Migração 014: Adicionar índices em media_cache para resolução rápida de mídias
-- Idempotente: SIM (usa CREATE INDEX IF NOT EXISTS)
-- 
-- Objetivo:
-- - Índice único (bot_slug, kind, sha256) para garantir unicidade de mídias
-- - Índice de busca rápida por (bot_slug, kind, status)
-- - Índice para buscar mídias prontas (status='ready')

-- Índice único: garante que não há duplicatas de (bot_slug, kind, sha256)
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_cache_unique_key 
  ON media_cache(bot_slug, kind, sha256);

-- Índice composto para busca rápida: bot_slug + kind + status
CREATE INDEX IF NOT EXISTS idx_media_cache_lookup 
  ON media_cache(bot_slug, kind, status);

-- Índice para buscar mídias prontas (status='ready')
CREATE INDEX IF NOT EXISTS idx_media_cache_ready 
  ON media_cache(bot_slug, status) 
  WHERE status = 'ready';

-- Índice para buscar mídias com file_id válido
CREATE INDEX IF NOT EXISTS idx_media_cache_with_file_id 
  ON media_cache(bot_slug, kind) 
  WHERE tg_file_id IS NOT NULL AND status = 'ready';
