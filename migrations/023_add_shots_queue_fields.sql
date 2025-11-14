-- Migração: Adicionar campos faltantes à shots_queue
-- Descrição: Adiciona bot_id, bot_slug, slug para compatibilidade com downsells_queue
-- Idempotente: SIM (usa ADD COLUMN IF NOT EXISTS)

-- Adicionar bot_id (opcional, pode ser obtido via JOIN com shots)
ALTER TABLE shots_queue ADD COLUMN IF NOT EXISTS bot_id BIGINT REFERENCES bots(id) ON DELETE CASCADE;

-- Adicionar bot_slug para facilitar queries e logs
ALTER TABLE shots_queue ADD COLUMN IF NOT EXISTS bot_slug TEXT;

-- Adicionar slug do shot para facilitar queries e logs
ALTER TABLE shots_queue ADD COLUMN IF NOT EXISTS slug TEXT;

-- Adicionar trigger (para compatibilidade futura, se necessário)
ALTER TABLE shots_queue ADD COLUMN IF NOT EXISTS trigger TEXT;

-- Criar índice para bot_id se não existir
CREATE INDEX IF NOT EXISTS idx_shots_queue_bot_id 
  ON shots_queue(bot_id);

-- Comentários para documentação
COMMENT ON COLUMN shots_queue.bot_id IS 'ID do bot (desnormalizado para performance)';
COMMENT ON COLUMN shots_queue.bot_slug IS 'Slug do bot (desnormalizado para logs)';
COMMENT ON COLUMN shots_queue.slug IS 'Slug do shot (desnormalizado para logs)';
COMMENT ON COLUMN shots_queue.trigger IS 'Tipo de gatilho que originou o shot (start, pix, etc)';
