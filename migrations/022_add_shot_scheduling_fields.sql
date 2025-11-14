-- Migração: Adicionar campos de agendamento e gatilho aos shots
-- Descrição: Adiciona trigger_type, schedule_type e scheduled_at à tabela shots
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Adicionar coluna trigger_type (quando o shot será disparado)
ALTER TABLE shots ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'start';

-- Adicionar coluna schedule_type (imediato ou agendado)
ALTER TABLE shots ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'immediate';

-- Adicionar coluna scheduled_at (data/hora do disparo agendado)
ALTER TABLE shots ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP;

-- Adicionar comentários para documentação
COMMENT ON COLUMN shots.trigger_type IS 'Gatilho do shot: start (após /start) ou pix_created (após gerar PIX)';
COMMENT ON COLUMN shots.schedule_type IS 'Tipo de disparo: immediate (imediato) ou scheduled (agendado)';
COMMENT ON COLUMN shots.scheduled_at IS 'Data e hora do disparo agendado (apenas quando schedule_type = scheduled)';
