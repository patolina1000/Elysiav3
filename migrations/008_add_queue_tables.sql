-- Migração: Criar tabelas de fila para downsells e shots
-- Descrição: Tabelas para enfileirar envio de downsells e shots
-- Idempotente: SIM (usa CREATE TABLE IF NOT EXISTS)

-- Tabela: downsells_queue
-- Fila de downsells aguardando envio
CREATE TABLE IF NOT EXISTS downsells_queue (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT REFERENCES bots(id) ON DELETE CASCADE,
  downsell_id BIGINT NOT NULL REFERENCES bot_downsells(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  tg_id BIGINT,
  schedule_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downsells_queue_status 
  ON downsells_queue(status);

CREATE INDEX IF NOT EXISTS idx_downsells_queue_bot_id 
  ON downsells_queue(bot_id);

CREATE INDEX IF NOT EXISTS idx_downsells_queue_schedule_at 
  ON downsells_queue(schedule_at);

-- Tabela: shots_queue
-- Fila de shots aguardando envio
CREATE TABLE IF NOT EXISTS shots_queue (
  id BIGSERIAL PRIMARY KEY,
  shot_id BIGINT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  tg_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shots_queue_status 
  ON shots_queue(status);

CREATE INDEX IF NOT EXISTS idx_shots_queue_shot_id 
  ON shots_queue(shot_id);

CREATE INDEX IF NOT EXISTS idx_shots_queue_created_at 
  ON shots_queue(created_at);
