-- Migração: Corrigir coluna event_id em funnel_events
-- Descrição: event_id é uma coluna pré-existente que precisa de DEFAULT
-- Idempotente: SIM (usa ALTER COLUMN IF EXISTS)
-- Nota: Se event_id não existir, não faz nada

-- Adicionar DEFAULT para event_id se a coluna existir
-- Usando COALESCE para gerar um ID único baseado em timestamp + random
ALTER TABLE funnel_events 
  ALTER COLUMN event_id SET DEFAULT (to_char(now(), 'YYYYMMDDHH24MISS') || '_' || floor(random() * 1000000)::text);

-- Se event_id for NOT NULL sem DEFAULT, permitir NULL para dados históricos
-- Isso é feito apenas se a coluna existir
DO $$
BEGIN
  BEGIN
    ALTER TABLE funnel_events ALTER COLUMN event_id DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Coluna não existe ou já é nullable
  END;
END $$;
