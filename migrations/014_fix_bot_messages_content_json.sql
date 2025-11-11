-- Migração: Corrigir bot_messages.content para JSON válido
-- Descrição: Converte content de string simples para JSON estruturado
-- Idempotente: SIM

-- Nota: Esta migração é um placeholder
-- O backend já trata content como string ou JSON automaticamente
-- Não é necessário converter no banco, pois o código Node.js normaliza os dados

-- Apenas registrar que a migração foi executada
SELECT 'Migração 014: Normalização de bot_messages.content delegada ao backend' AS migration_status;
