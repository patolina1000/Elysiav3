-- Migração: Adicionar trigger_type a bot_downsells
-- Descrição: Define se downsell é disparado após /start ou após gerar PIX
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Adicionar coluna trigger_type
-- Valores: 'start' (após /start) ou 'pix' (após gerar PIX)
ALTER TABLE bot_downsells ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'start';

-- Adicionar constraint para validar valores permitidos
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'bot_downsells_trigger_type_check'
  ) THEN
    ALTER TABLE bot_downsells 
    ADD CONSTRAINT bot_downsells_trigger_type_check 
    CHECK (trigger_type IN ('start', 'pix'));
  END IF;
END $$;

-- Índice para queries de downsells por trigger_type
CREATE INDEX IF NOT EXISTS idx_bot_downsells_trigger_type 
  ON bot_downsells(trigger_type);

-- Índice composto para queries de downsells ativos por bot e trigger
CREATE INDEX IF NOT EXISTS idx_bot_downsells_bot_id_trigger_type_active 
  ON bot_downsells(bot_id, trigger_type, active) 
  WHERE active = TRUE;
