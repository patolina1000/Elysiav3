# Migrações do Banco de Dados

Este diretório contém as migrações SQL para o projeto Elysia Multi-Bots.

## Estrutura

- `001_add_bot_users.sql` – Cria tabela `bot_users` para rastreamento de usuários por bot
- `002_add_tracking_sessions.sql` – Cria tabela `tracking_sessions` para rastreamento web
- `003_extend_funnel_events.sql` – Estende `funnel_events` com colunas de tracking
- `004_extend_payments.sql` – Estende `payments` com colunas de rastreamento

## Como executar

### Opção 1: Usando psql (recomendado)

```bash
# Conectar ao banco e executar todas as migrações em ordem
psql postgresql://postgreesql_elysia_user:PASSWORD@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia < migrations/001_add_bot_users.sql
psql postgresql://postgreesql_elysia_user:PASSWORD@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia < migrations/002_add_tracking_sessions.sql
psql postgresql://postgreesql_elysia_user:PASSWORD@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia < migrations/003_extend_funnel_events.sql
psql postgresql://postgreesql_elysia_user:PASSWORD@dpg-d44igbu3jp1c73dd61og-a.virginia-postgres.render.com/postgreesql_elysia < migrations/004_extend_payments.sql
```

### Opção 2: Usando Node.js (se houver script de migração)

Se o projeto tiver um script de migração em Node.js, executar:

```bash
npm run migrate
```

### Opção 3: Usando DBeaver ou pgAdmin

1. Abrir a conexão com o banco
2. Executar cada arquivo SQL em ordem (001 → 002 → 003 → 004)

## Princípios de segurança

Todas as migrações seguem os princípios definidos no `blueprint.md`:

- ✅ **Idempotentes**: Podem rodar múltiplas vezes sem erro
- ✅ **Não destrutivas**: Nenhum DROP TABLE ou DROP COLUMN
- ✅ **Compatíveis**: Novas colunas são NULLABLE ou têm DEFAULT
- ✅ **Ordenadas**: Tabelas novas antes de ALTER TABLE
- ✅ **Particionamento respeitado**: Alterações apenas na tabela mãe

## Verificação após migração

Depois de executar todas as migrações, verificar a saúde do esquema:

```sql
-- Verificar tabelas novas
SELECT COUNT(*) FROM bot_users;
SELECT COUNT(*) FROM tracking_sessions;

-- Verificar colunas adicionadas
SELECT * FROM funnel_events LIMIT 1;
SELECT * FROM payments LIMIT 1;

-- Verificar índices criados
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('bot_users', 'tracking_sessions', 'funnel_events', 'payments')
ORDER BY tablename, indexname;
```

## Rollback

Como as migrações são **não destrutivas**, não há necessidade de rollback. Se precisar reverter:

1. Remover dados das novas tabelas (se necessário)
2. Parar de usar as novas colunas no código
3. Deixar as colunas/tabelas vazias no banco (limpeza manual futura)

## Troubleshooting

### Erro: "relation already exists"
- Migração já foi executada. Isso é normal com `CREATE TABLE IF NOT EXISTS`.

### Erro: "column already exists"
- Coluna já existe. Isso é normal com `ADD COLUMN IF NOT EXISTS`.

### Erro: "foreign key constraint"
- Verificar se a tabela `bots` existe e tem coluna `id`.
- Executar migrações em ordem (001 → 002 → 003 → 004).

### Erro: "permission denied"
- Verificar credenciais do banco em `.env`
- Garantir que o usuário tem permissão de ALTER TABLE

## Próximos passos

Depois de executar as migrações:

1. Atualizar o código da aplicação para usar as novas tabelas/colunas
2. Implementar os módulos de tracking e pagamentos
3. Testar o funil completo em desenvolvimento
4. Deploy em produção
