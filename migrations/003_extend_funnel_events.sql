-- Migração: Estender tabela funnel_events com colunas de tracking
-- Descrição: Adiciona colunas necessárias para rastreamento completo do funil
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)
-- Nota: funnel_events é particionada; alterações na tabela mãe propagam para partições

ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS event_name TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS bot_id BIGINT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS bot_user_id BIGINT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS payment_id BIGINT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS fbp TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS fbc TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS meta JSONB;

-- Índices para performance em queries comuns
CREATE INDEX IF NOT EXISTS idx_funnel_events_event_name 
  ON funnel_events(event_name);

CREATE INDEX IF NOT EXISTS idx_funnel_events_bot_id 
  ON funnel_events(bot_id);

CREATE INDEX IF NOT EXISTS idx_funnel_events_session_id 
  ON funnel_events(session_id);

CREATE INDEX IF NOT EXISTS idx_funnel_events_occurred_at 
  ON funnel_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_funnel_events_telegram_id 
  ON funnel_events(telegram_id);

CREATE INDEX IF NOT EXISTS idx_funnel_events_bot_user_id 
  ON funnel_events(bot_user_id);

-- Índice composto para queries de funil por bot e período
CREATE INDEX IF NOT EXISTS idx_funnel_events_bot_id_occurred_at 
  ON funnel_events(bot_id, occurred_at);
