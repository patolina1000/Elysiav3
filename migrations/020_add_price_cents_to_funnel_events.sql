-- Migração: Adicionar campo price_cents em funnel_events
-- Descrição: Rastreia valor em centavos para eventos de compra
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0;

-- Índice composto para queries de faturamento por bot e período
CREATE INDEX IF NOT EXISTS idx_funnel_events_bot_id_event_name_occurred_at 
  ON funnel_events(bot_id, event_name, occurred_at) 
  WHERE event_name = 'purchase' AND price_cents > 0;
