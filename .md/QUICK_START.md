# 🚀 Quick Start - Multi-Bots + Gateways + Tracking

Guia rápido para começar com o projeto Elysia.

---

## 1️⃣ Ler a Arquitetura (5 min)

```bash
cat blueprint.md
```

**O que você vai entender:**
- Objetivos do projeto
- Arquitetura geral
- Modelo de dados
- Regras de logs e .env

---

## 2️⃣ Desenvolvimento Local no Windows (PowerShell)

### ⚠️ Importante: Não use `&&` no PowerShell

**❌ ERRADO (não funciona):**
```powershell
npm install && npm run migrate && npm run dev
```

**✅ CERTO (execute um por um):**

Abra o PowerShell na pasta do projeto e execute cada comando em uma linha separada:

```powershell
# 1. Instalar dependências
npm install

# 2. Executar migrações
npm run migrate

# 3. Iniciar servidor
npm run dev
```

**Saída esperada:**
```
✨ Todas as migrações executadas com sucesso!
✅ bot_users - Acessível
✅ tracking_sessions - Acessível
✅ funnel_events - Acessível
✅ payments - Acessível
🎉 Banco de dados pronto para uso!

[INFO] Servidor iniciado na porta 3000
[INFO] Ambiente: development
[INFO] Banco de dados: conectado via DATABASE_URL
```

---

## 3️⃣ Configurar Banco Remoto (Render)

O projeto usa PostgreSQL remoto no Render. Não é necessário instalar Postgres localmente.

**Verificar conexão:**

```powershell
# Abra PowerShell e execute:
$env:DATABASE_URL
```

Se retornar uma URL `postgresql://...`, está tudo certo!

**Testar conexão com psql (opcional):**

```powershell
# Se tiver psql instalado:
psql $env:DATABASE_URL -c "SELECT COUNT(*) FROM bot_users;"
```

---

## 4️⃣ Configurar Webhook do Telegram com ngrok

Para receber webhooks do Telegram em desenvolvimento local, use ngrok.

### Passo 1: Instalar ngrok

Baixe em: https://ngrok.com/download

Ou via Chocolatey:
```powershell
choco install ngrok
```

### Passo 2: Iniciar ngrok

Em um PowerShell separado, execute:

```powershell
ngrok http 3000
```

Você verá algo como:
```
Forwarding                    https://abc123.ngrok.io -> http://localhost:3000
```

Copie a URL pública: `https://abc123.ngrok.io`

### Passo 3: Configurar Webhook do Telegram

Use a URL pública do ngrok para configurar o webhook. Existem duas formas:

**Opção A: Via BotFather (recomendado)**

1. Abra Telegram e procure por `@BotFather`
2. Envie: `/setwebhook`
3. Escolha seu bot
4. Envie a URL: `https://abc123.ngrok.io/tg/seu_bot_slug/webhook`

**Opção B: Via API do Telegram**

```powershell
# Substitua TOKEN e SLUG
$TOKEN = "seu_token_do_bot"
$SLUG = "seu_bot_slug"
$WEBHOOK_URL = "https://abc123.ngrok.io/tg/$SLUG/webhook"

Invoke-WebRequest -Uri "https://api.telegram.org/bot$TOKEN/setWebhook?url=$WEBHOOK_URL"
```

### Passo 4: Testar

Envie `/start` para seu bot no Telegram. Você deve ver logs no servidor:

```
[WEBHOOK][OK] slug=seu_bot_slug user=123456789 event=/start latency=45ms
```

---

## 5️⃣ Verificar o Banco (2 min)

```powershell
# Conectar ao banco (se tiver psql)
psql $env:DATABASE_URL

# Dentro do psql, executar:
SELECT COUNT(*) FROM bot_users;
SELECT COUNT(*) FROM tracking_sessions;
SELECT * FROM funnel_events LIMIT 1;
SELECT * FROM payments LIMIT 1;
```

**Se tudo retornar sem erro:** ✅ Banco está pronto!

---

## 6️⃣ Testar API Localmente

Com o servidor rodando em `http://localhost:3000`, teste os endpoints:

```powershell
# Health check
Invoke-WebRequest -Uri "http://localhost:3000/healthz"

# Listar bots
Invoke-WebRequest -Uri "http://localhost:3000/api/admin/bots"

# Criar bot
$body = @{
    slug = "test_bot"
    name = "Test Bot"
    provider = "pushinpay"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/admin/bots" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

---

## 7️⃣ Entender o Próximo Passo (5 min)

```powershell
cat .md\IMPLEMENTATION_CHECKLIST.md
```

**Foco na Fase 3:**
- Estrutura de diretórios
- Setup do projeto
- Camada de banco de dados

---

## 📚 Documentação Completa

| Arquivo | Tempo | Propósito |
|---------|-------|----------|
| blueprint.md | 10 min | Arquitetura completa |
| MIGRATION_SUMMARY.md | 5 min | Resumo das mudanças |
| IMPLEMENTATION_CHECKLIST.md | 10 min | Progresso do projeto |
| TEST_MIGRATIONS.md | 15 min | Guia de testes |
| migrations/README.md | 5 min | Detalhes técnicos |

---

## 🎯 Checklist Rápido

- [ ] Ler blueprint.md
- [ ] Instalar dependências (`npm install`)
- [ ] Executar migrações (`npm run migrate`)
- [ ] Verificar banco (SELECT COUNT(*) FROM bot_users;)
- [ ] Iniciar servidor (`npm run dev`)
- [ ] Instalar ngrok
- [ ] Configurar webhook do Telegram
- [ ] Testar `/start` no Telegram

---

## 🆘 Problemas Comuns

### Erro: "DATABASE_URL não definida"
```powershell
# Verificar se .env existe e tem DATABASE_URL
cat .env | Select-String DATABASE_URL
```

### Erro: "Cannot find module 'pg'"
```powershell
npm install
```

### Erro: "relation already exists"
Normal! Significa que a migração já foi executada. Pode rodar novamente sem problema (idempotente).

### Erro: "permission denied" ao conectar banco
Verificar credenciais do banco em `.env`. Testar conexão:
```powershell
psql $env:DATABASE_URL -c "SELECT 1;"
```

### ngrok não funciona
- Verificar se porta 3000 está livre: `netstat -ano | findstr :3000`
- Verificar se servidor está rodando: `npm run dev`
- Reiniciar ngrok em PowerShell novo

### Webhook do Telegram não recebe mensagens
- Verificar URL do ngrok está correta
- Verificar que bot slug existe no banco
- Verificar logs do servidor: `[WEBHOOK][OK]`

---

## 📞 Suporte

Consulte:
- `TEST_MIGRATIONS.md` → Troubleshooting
- `migrations/README.md` → Detalhes técnicos
- `blueprint.md` → Princípios do projeto

---

## ⏱️ Timeline Estimado

| Fase | Tempo | Status |
|------|-------|--------|
| 1. Planejamento & Banco | ✅ 2h | CONCLUÍDO |
| 2. Execução de Migrações | ✅ 30 min | CONCLUÍDO |
| 3. Estrutura de Código | ✅ 2h | CONCLUÍDO |
| 4. Bot Engine & Tracking | ✅ 3h | CONCLUÍDO |
| 5. Pagamentos & Scheduler | ✅ 3h | CONCLUÍDO |
| 6. Admin Config & Docs | ✅ 2h | CONCLUÍDO |
| 7. Testes | ⏳ 2h | PRÓXIMO |
| 8. Deploy | ⏳ 1h | DEPOIS |

**Total estimado**: ~2 dias (conforme planejado!)

---

## 🎉 Próximo Passo

```powershell
# 1. Instalar dependências
npm install

# 2. Executar migrações
npm run migrate

# 3. Iniciar servidor
npm run dev

# 4. Em outro PowerShell, iniciar ngrok
ngrok http 3000

# 5. Configurar webhook do Telegram
# (veja seção 4️⃣ acima)
```

---

**Boa sorte! 🚀**
