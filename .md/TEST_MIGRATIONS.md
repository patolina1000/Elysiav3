# Guia de Teste das Migrações

Este documento descreve como testar as migrações do banco de dados antes de usar em produção.

## 1. Pré-requisitos

- PostgreSQL 12+ (seu banco já está em Render.com)
- Node.js 14+ (para script run-migrations.js)
- Acesso ao banco de dados
- Arquivo `.env` com DATABASE_URL

## 2. Preparação

### 2.1 Criar arquivo .env (se não existir)

```bash
# .env
DATABASE_URL=postgresql://postgreesql_elysia_user:JMghyYpUjhVkhfrvjDDIqBcl5YyHwcKR@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia
```

### 2.2 Instalar dependências

```bash
npm install pg dotenv
```

## 3. Executar Migrações

### Opção A: Script Node.js (Recomendado)

```bash
# Executar todas as migrações
node migrations/run-migrations.js
```

**Saída esperada:**
```
🚀 Iniciando migrações do banco de dados...

⏳ Executando: 001_add_bot_users.sql
✅ 001_add_bot_users.sql - OK

⏳ Executando: 002_add_tracking_sessions.sql
✅ 002_add_tracking_sessions.sql - OK

⏳ Executando: 003_extend_funnel_events.sql
✅ 003_extend_funnel_events.sql - OK

⏳ Executando: 004_extend_payments.sql
✅ 004_extend_payments.sql - OK

✨ Todas as migrações executadas com sucesso!

📊 Verificação rápida do esquema:

✅ bot_users - Acessível
✅ tracking_sessions - Acessível
✅ funnel_events - Acessível
✅ payments - Acessível

🎉 Banco de dados pronto para uso!
```

### Opção B: psql direto

```bash
# Conectar ao banco
psql postgresql://postgreesql_elysia_user:JMghyYpUjhVkhfrvjDDIqBcl5YyHwcKR@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia

# Dentro do psql, executar cada arquivo
\i migrations/001_add_bot_users.sql
\i migrations/002_add_tracking_sessions.sql
\i migrations/003_extend_funnel_events.sql
\i migrations/004_extend_payments.sql
```

### Opção C: DBeaver ou pgAdmin

1. Conectar ao banco
2. Abrir cada arquivo SQL em ordem
3. Executar (F5 ou botão Run)

## 4. Verificação Detalhada

### 4.1 Verificar Tabelas Novas

```sql
-- Verificar bot_users
\d bot_users
SELECT COUNT(*) FROM bot_users;

-- Verificar tracking_sessions
\d tracking_sessions
SELECT COUNT(*) FROM tracking_sessions;
```

**Saída esperada:**
```
                                      Table "public.bot_users"
      Column      |           Type           | Collation | Nullable |      Default
------------------+--------------------------+-----------+----------+-------------------
 id               | bigint                   |           | not null | nextval('bot_users_id_seq'::regclass)
 bot_id           | bigint                   |           | not null |
 telegram_id      | bigint                   |           | not null |
 first_seen_at    | timestamp with time zone |           | not null | now()
 last_seen_at     | timestamp with time zone |           | not null | now()
 last_start_at    | timestamp with time zone |           |          |
 has_paid         | boolean                  |           | not null | false
 created_at       | timestamp with time zone |           | not null | now()
 updated_at       | timestamp with time zone |           | not null | now()
Indexes:
    "bot_users_pkey" PRIMARY KEY, btree (id)
    "idx_bot_users_bot_id" btree (bot_id)
    "idx_bot_users_bot_id_telegram_id" UNIQUE, btree (bot_id, telegram_id)
    "idx_bot_users_first_seen_at" btree (first_seen_at)
    "idx_bot_users_last_seen_at" btree (last_seen_at)
Foreign-key constraints:
    "bot_users_bot_id_fkey" FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
```

### 4.2 Verificar Colunas Adicionadas

```sql
-- Verificar colunas em funnel_events
\d funnel_events

-- Listar colunas específicas
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'funnel_events' 
AND column_name IN ('event_name', 'bot_id', 'session_id', 'meta')
ORDER BY ordinal_position;
```

**Saída esperada:**
```
    column_name    |           data_type           | is_nullable
-------------------+-------------------------------+-------------
 event_name        | text                          | YES
 bot_id            | bigint                        | YES
 session_id        | text                          | YES
 meta              | jsonb                         | YES
```

### 4.3 Verificar Índices

```sql
-- Listar todos os índices criados
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE tablename IN ('bot_users', 'tracking_sessions', 'funnel_events', 'payments')
ORDER BY tablename, indexname;
```

**Saída esperada (parcial):**
```
                    indexname                    |   tablename    |                                    indexdef
-------------------------------------------------+----------------+----------------------------------------------------------------------------------------------------
 bot_users_pkey                                  | bot_users      | CREATE UNIQUE INDEX bot_users_pkey ON public.bot_users USING btree (id)
 idx_bot_users_bot_id                            | bot_users      | CREATE INDEX idx_bot_users_bot_id ON public.bot_users USING btree (bot_id)
 idx_bot_users_bot_id_telegram_id                | bot_users      | CREATE UNIQUE INDEX idx_bot_users_bot_id_telegram_id ON public.bot_users USING btree (bot_id, telegram_id)
 idx_bot_users_first_seen_at                     | bot_users      | CREATE INDEX idx_bot_users_first_seen_at ON public.bot_users USING btree (first_seen_at)
 idx_bot_users_last_seen_at                      | bot_users      | CREATE INDEX idx_bot_users_last_seen_at ON public.bot_users USING btree (last_seen_at)
 idx_funnel_events_bot_id                        | funnel_events  | CREATE INDEX idx_funnel_events_bot_id ON public.funnel_events USING btree (bot_id)
 idx_funnel_events_bot_id_occurred_at            | funnel_events  | CREATE INDEX idx_funnel_events_bot_id_occurred_at ON public.funnel_events USING btree (bot_id, occurred_at)
 ...
```

### 4.4 Verificar Foreign Keys

```sql
-- Verificar constraint de bot_users → bots
SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name
FROM information_schema.key_column_usage
WHERE table_name = 'bot_users' AND column_name = 'bot_id';
```

**Saída esperada:**
```
 constraint_name  | table_name | column_name | referenced_table_name | referenced_column_name
------------------+------------+-------------+-----------------------+------------------------
 bot_users_bot_id_fkey | bot_users  | bot_id      | bots                  | id
```

## 5. Testes de Funcionalidade

### 5.1 Inserir Dados de Teste

```sql
-- Verificar se existe um bot
SELECT id, slug FROM bots LIMIT 1;

-- Inserir um bot_user de teste (substituir bot_id com um real)
INSERT INTO bot_users (bot_id, telegram_id, first_seen_at, last_seen_at)
VALUES (1, 123456789, NOW(), NOW())
ON CONFLICT (bot_id, telegram_id) DO NOTHING;

-- Verificar inserção
SELECT * FROM bot_users WHERE telegram_id = 123456789;
```

### 5.2 Testar Índices

```sql
-- Query que usa índice bot_id
EXPLAIN ANALYZE
SELECT * FROM bot_users WHERE bot_id = 1;

-- Query que usa índice session_id
EXPLAIN ANALYZE
SELECT * FROM funnel_events WHERE session_id = 'test-session-123';

-- Query que usa índice composto
EXPLAIN ANALYZE
SELECT * FROM payments WHERE bot_id = 1 AND created_at > NOW() - INTERVAL '7 days';
```

**Saída esperada:** Deve mostrar "Index Scan" em vez de "Seq Scan"

### 5.3 Testar Particionamento

```sql
-- Verificar se funnel_events é particionada
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE tablename LIKE 'funnel_events%'
ORDER BY tablename;

-- Inserir evento de teste
INSERT INTO funnel_events (event_name, bot_id, telegram_id, occurred_at)
VALUES ('bot_start', 1, 123456789, NOW());

-- Verificar inserção
SELECT * FROM funnel_events WHERE telegram_id = 123456789;
```

## 6. Testes de Idempotência

### 6.1 Executar Migrações Novamente

```bash
# Executar o script novamente
node migrations/run-migrations.js
```

**Resultado esperado:** Sem erros, apenas mensagens de "já existe"

### 6.2 Executar SQL Manualmente

```bash
# Executar cada arquivo SQL novamente
psql $DATABASE_URL < migrations/001_add_bot_users.sql
psql $DATABASE_URL < migrations/002_add_tracking_sessions.sql
psql $DATABASE_URL < migrations/003_extend_funnel_events.sql
psql $DATABASE_URL < migrations/004_extend_payments.sql
```

**Resultado esperado:** Sem erros

## 7. Testes de Performance

### 7.1 Verificar Tamanho do Banco

```sql
-- Tamanho total do banco
SELECT pg_size_pretty(pg_database_size('postgreesql_elysia'));

-- Tamanho por tabela
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 7.2 Verificar Índices Não Usados

```sql
-- Índices que podem estar não sendo usados
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC;
```

## 8. Troubleshooting

### Erro: "relation already exists"

```
ERROR: relation "bot_users" already exists
```

**Solução:** Normal com `CREATE TABLE IF NOT EXISTS`. Significa que a tabela já foi criada.

### Erro: "column already exists"

```
ERROR: column "event_name" of relation "funnel_events" already exists
```

**Solução:** Normal com `ADD COLUMN IF NOT EXISTS`. Significa que a coluna já foi adicionada.

### Erro: "foreign key constraint"

```
ERROR: insert or update on table "bot_users" violates foreign key constraint
```

**Solução:** Verificar se a tabela `bots` existe e tem dados:
```sql
SELECT COUNT(*) FROM bots;
```

### Erro: "permission denied"

```
ERROR: permission denied for schema public
```

**Solução:** Verificar credenciais do banco em `.env`. Usuário precisa ter permissão de ALTER TABLE.

## 9. Checklist Final

- [ ] Todas as 4 migrações executadas sem erro
- [ ] bot_users criada com índices corretos
- [ ] tracking_sessions criada com índices corretos
- [ ] funnel_events estendida com 16 colunas novas
- [ ] payments estendida com 9 colunas novas
- [ ] Todos os índices criados
- [ ] Foreign keys funcionando
- [ ] Dados de teste inseridos com sucesso
- [ ] Queries com índices usando "Index Scan"
- [ ] Migrações são idempotentes (rodam 2x sem erro)
- [ ] Banco está pronto para desenvolvimento

## 10. Próximos Passos

Depois de confirmar que todas as migrações funcionam:

1. Atualizar código da aplicação para usar novas tabelas
2. Implementar módulos de tracking e pagamentos
3. Testar funil completo
4. Deploy em produção

---

**Última Atualização**: 2025-11-08
**Status**: Pronto para teste
