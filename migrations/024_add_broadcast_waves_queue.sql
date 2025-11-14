-- Migração: Criar tabela broadcast_waves_queue
-- Descrição: Fila de ondas (batches) para broadcast de downsells e shots
-- Idempotente: SIM (usa CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS broadcast_waves_queue (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bot_slug TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'downsell' | 'shot'
  context JSONB NOT NULL, -- { downsellId, shotId, etc. }
  chat_ids JSONB NOT NULL, -- Array de telegram_ids desta onda
  wave_index INTEGER NOT NULL, -- Índice da onda (0, 1, 2, ...)
  total_waves INTEGER NOT NULL, -- Total de ondas para este broadcast
  schedule_at TIMESTAMPTZ NOT NULL, -- Quando esta onda deve ser processada
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'error'
  error_message TEXT,
  sent_count INTEGER DEFAULT 0, -- Quantas mensagens foram enviadas
  skipped_count INTEGER DEFAULT 0, -- Quantas foram puladas
  failed_count INTEGER DEFAULT 0, -- Quantas falharam
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_broadcast_waves_queue_status 
  ON broadcast_waves_queue(status);

CREATE INDEX IF NOT EXISTS idx_broadcast_waves_queue_schedule_at 
  ON broadcast_waves_queue(schedule_at) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_broadcast_waves_queue_bot_id 
  ON broadcast_waves_queue(bot_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_waves_queue_kind 
  ON broadcast_waves_queue(kind);

-- Índice composto para queries de processamento
CREATE INDEX IF NOT EXISTS idx_broadcast_waves_queue_processing 
  ON broadcast_waves_queue(status, schedule_at, bot_id);
