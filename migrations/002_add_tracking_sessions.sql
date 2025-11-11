-- Migração: Criar tabela tracking_sessions
-- Descrição: Rastreia sessões web com UTMs, Facebook IDs e timestamps
-- Idempotente: SIM (usa CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS tracking_sessions (
  id TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip INET,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbp TEXT,
  fbc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para queries por período
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_first_seen_at 
  ON tracking_sessions(first_seen_at);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_last_seen_at 
  ON tracking_sessions(last_seen_at);

-- Índices para UTMs (úteis para analytics)
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_utm_source 
  ON tracking_sessions(utm_source);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_utm_campaign 
  ON tracking_sessions(utm_campaign);
