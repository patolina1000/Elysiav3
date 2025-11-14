-- Migration 026: Criar tabela de histórico de planos de shots deletados
-- Quando um shot é deletado após envio, salvamos os planos aqui
-- para que os botões de pagamento continuem funcionando

CREATE TABLE IF NOT EXISTS shot_plans_history (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  shot_slug VARCHAR(255) NOT NULL,
  plans JSONB NOT NULL DEFAULT '[]',
  deleted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índice para busca rápida por bot_id + shot_slug
CREATE INDEX IF NOT EXISTS idx_shot_plans_history_bot_slug 
  ON shot_plans_history(bot_id, shot_slug);

-- Índice para limpeza de dados antigos (opcional)
CREATE INDEX IF NOT EXISTS idx_shot_plans_history_deleted_at 
  ON shot_plans_history(deleted_at);

COMMENT ON TABLE shot_plans_history IS 'Histórico de planos de shots deletados para manter botões de pagamento funcionais';
COMMENT ON COLUMN shot_plans_history.plans IS 'Array JSON com os planos do shot no momento da deleção';
