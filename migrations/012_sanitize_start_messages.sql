-- Migração idempotente: Saneamento de mensagens /start
-- Objetivo: Deduplica, limpa e normaliza registros de bot_messages com slug='start'

BEGIN;

-- 1. Logar quantos registros serão afetados
DO $$
DECLARE
  v_duplicates INT;
  v_corrupted INT;
BEGIN
  -- Contar duplicatas (múltiplos active=TRUE para mesmo bot_id+slug)
  SELECT COUNT(DISTINCT bot_id) INTO v_duplicates
  FROM bot_messages
  WHERE slug = 'start' AND active = TRUE
  GROUP BY bot_id, slug
  HAVING COUNT(*) > 1;

  -- Contar registros com content corrompido
  SELECT COUNT(*) INTO v_corrupted
  FROM bot_messages
  WHERE slug = 'start' AND (
    content = '[object Object]' OR
    content IS NULL OR
    content = ''
  );

  RAISE NOTICE '[SANITIZE:START] Duplicatas encontradas: %, Corrompidos: %', COALESCE(v_duplicates, 0), v_corrupted;
END $$;

-- 2. Desativar registros duplicados (manter apenas o mais recente)
UPDATE bot_messages bm1
SET active = FALSE, updated_at = NOW()
WHERE slug = 'start'
  AND active = TRUE
  AND id NOT IN (
    SELECT id
    FROM bot_messages bm2
    WHERE bm2.slug = 'start'
      AND bm2.active = TRUE
      AND bm2.bot_id = bm1.bot_id
    ORDER BY bm2.updated_at DESC, bm2.id DESC
    LIMIT 1
  );

-- 3. Corrigir registros com content corrompido
UPDATE bot_messages
SET content = '{"messages":[],"medias":[],"plans":[]}',
    updated_at = NOW()
WHERE slug = 'start'
  AND active = TRUE
  AND (
    content = '[object Object]' OR
    content IS NULL OR
    content = ''
  );

-- 4. Garantir que todos os content são JSON válido (conversão defensiva)
UPDATE bot_messages
SET content = '{"messages":[],"medias":[],"plans":[]}'
WHERE slug = 'start'
  AND active = TRUE
  AND (
    -- Detectar strings simples (não JSON)
    content NOT LIKE '{%' OR
    -- Detectar JSON inválido (sem aspas duplas)
    content LIKE '%[object Object]%'
  );

-- 5. Log final
DO $$
DECLARE
  v_final_count INT;
BEGIN
  SELECT COUNT(*) INTO v_final_count
  FROM bot_messages
  WHERE slug = 'start' AND active = TRUE;

  RAISE NOTICE '[SANITIZE:START] Registros ativos finais: %', v_final_count;
END $$;

COMMIT;
