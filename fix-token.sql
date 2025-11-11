-- Script para limpar tokens inválidos e resetar status
-- Execute isso no seu banco de dados para resolver o erro de descriptografia

UPDATE bots 
SET token_encrypted = NULL,
    token_status = 'unverified',
    token_checked_at = NULL
WHERE token_status = 'validated' AND active = TRUE;

-- Verificar resultado
SELECT id, slug, token_status, active FROM bots;
