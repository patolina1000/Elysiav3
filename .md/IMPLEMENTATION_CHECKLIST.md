# Checklist de Implementação - Multi-Bots + Gateways + Tracking

## ✅ Fase 1: Planejamento & Banco de Dados (CONCLUÍDO)

- [x] Atualizar blueprint.md com arquitetura completa
- [x] Adicionar tabela de metas de performance
- [x] Reorganizar seção .env com clareza
- [x] Completar regras de migrações
- [x] Adicionar glossário de event_name
- [x] Criar 4 migrações SQL idempotentes
  - [x] 001_add_bot_users.sql
  - [x] 002_add_tracking_sessions.sql
  - [x] 003_extend_funnel_events.sql
  - [x] 004_extend_payments.sql
- [x] Criar script run-migrations.js
- [x] Documentar migrações em README.md

---

## 🔄 Fase 2: Execução de Migrações (PRÓXIMO)

- [ ] Executar migrações em desenvolvimento
  - [ ] `node migrations/run-migrations.js`
  - [ ] Ou via psql/DBeaver
- [ ] Verificar saúde do esquema
  - [ ] SELECT COUNT(*) FROM bot_users;
  - [ ] SELECT COUNT(*) FROM tracking_sessions;
  - [ ] SELECT * FROM funnel_events LIMIT 1;
  - [ ] SELECT * FROM payments LIMIT 1;
- [ ] Verificar índices criados
  - [ ] SELECT indexname FROM pg_indexes WHERE tablename IN (...)
- [ ] Confirmar que nenhum erro ocorreu

---

## 🏗️ Fase 3: Estrutura de Código (PRÓXIMO)

### 3.1 Setup do Projeto

- [ ] Criar estrutura de diretórios
  ```
  src/
  ├── config/
  │   ├── env.ts          (Carregar .env uma vez)
  │   └── database.ts     (Pool de conexão)
  ├── modules/
  │   ├── bots/
  │   ├── tracking/
  │   ├── payments/
  │   └── messages/
  ├── services/
  ├── utils/
  ├── middleware/
  └── types/
  ```

- [ ] Instalar dependências
  ```bash
  npm install express pg dotenv
  npm install -D typescript @types/node @types/express
  ```

- [ ] Configurar TypeScript
  - [ ] tsconfig.json
  - [ ] Compilação para dist/

- [ ] Criar arquivo .env.example
  ```
  DATABASE_URL=postgresql://...
  TELEGRAM_BOT_TOKEN=...
  TELEGRAM_WARMING_GROUP=...
  PUSHINPAY_API_KEY=...
  SYNCPAY_API_KEY=...
  UTMIFY_API_KEY=...
  FACEBOOK_PIXEL_ID=...
  FACEBOOK_CAPI_TOKEN=...
  ```

### 3.2 Camada de Banco de Dados

- [ ] Criar `src/config/database.ts`
  - [ ] Pool de conexão PostgreSQL
  - [ ] Executar migrações no startup (opcional)
  - [ ] Health check

- [ ] Criar tipos TypeScript para tabelas
  - [ ] BotUser
  - [ ] TrackingSession
  - [ ] FunnelEvent
  - [ ] Payment

- [ ] Criar DAOs/Repositories
  - [ ] BotUserRepository
  - [ ] TrackingSessionRepository
  - [ ] FunnelEventRepository
  - [ ] PaymentRepository

---

## 🤖 Fase 4: Bot Engine (PRÓXIMO)

### 4.1 Webhook do Telegram

- [ ] Criar `src/modules/bots/telegram.controller.ts`
  - [ ] POST /tg/:slug/webhook
  - [ ] Validar token do bot
  - [ ] Responder rápido (< 200ms)
  - [ ] Enfileirar trabalho assincronamente

- [ ] Criar `src/modules/bots/bot.service.ts`
  - [ ] Resolver bot pelo slug
  - [ ] Normalizar updates do Telegram
  - [ ] Disparar eventos (start, callback, etc.)

### 4.2 Rastreamento de Usuários

- [ ] Criar `src/modules/tracking/bot-user.service.ts`
  - [ ] Criar/atualizar bot_user no webhook
  - [ ] Registrar first_seen_at, last_seen_at
  - [ ] Registrar last_start_at

- [ ] Criar `src/modules/tracking/session.service.ts`
  - [ ] Criar tracking_session a partir do frontend
  - [ ] Associar session_id com bot_user

### 4.3 Logging

- [ ] Criar `src/utils/logger.ts`
  - [ ] Logs em PT-BR simples
  - [ ] Formato: [MODULO][ACAO] mensagem
  - [ ] Nunca logar tokens/senhas
  - [ ] Incluir latency_ms em operações críticas

---

## 💳 Fase 5: Módulo de Pagamentos (PRÓXIMO)

### 5.1 Interface de Gateways

- [ ] Criar `src/modules/payments/gateway.interface.ts`
  ```typescript
  interface PaymentGateway {
    createPayment(params): Promise<Payment>;
    getPaymentStatus(externalId): Promise<string>;
    handleWebhook(body): Promise<void>;
  }
  ```

- [ ] Criar `src/modules/payments/gateway.registry.ts`
  - [ ] Registry de gateways (PushinPay, SyncPay, etc.)
  - [ ] Resolver gateway por nome

### 5.2 Implementação de Gateways

- [ ] Criar `src/modules/payments/gateways/pushinpay.gateway.ts`
  - [ ] Implementar interface PaymentGateway
  - [ ] Criar PIX
  - [ ] Verificar status

- [ ] Criar `src/modules/payments/gateways/syncpay.gateway.ts`
  - [ ] Idem

### 5.3 Webhook de Pagamentos

- [ ] Criar `src/modules/payments/payment.controller.ts`
  - [ ] POST /api/payments/webhook/:gateway
  - [ ] Validar assinatura do webhook
  - [ ] Atualizar status do pagamento
  - [ ] Disparar evento pix_paid

---

## 📊 Fase 6: Tracking & Analytics (PRÓXIMO)

### 6.1 Funil de Eventos

- [ ] Criar `src/modules/tracking/funnel.service.ts`
  - [ ] Registrar eventos no funnel_events
  - [ ] Usar event_name padrão (presell_view, bot_start, pix_created, etc.)
  - [ ] Incluir UTMs, fbp, fbc

### 6.2 Integração Facebook CAPI

- [ ] Criar `src/modules/tracking/facebook-capi.service.ts`
  - [ ] Enviar eventos para Facebook CAPI
  - [ ] Mapear event_name → Facebook event
  - [ ] Incluir fbp/fbc para matching

### 6.3 Integração UTMify

- [ ] Criar `src/modules/tracking/utmify.service.ts`
  - [ ] Enviar pedidos quando pix_paid
  - [ ] Incluir UTMs, valor, status

---

## 📨 Fase 7: Módulo de Mensagens (PRÓXIMO)

### 7.1 Envio de Mensagens

- [ ] Criar `src/modules/messages/message.service.ts`
  - [ ] Enviar /start
  - [ ] Enviar downsells
  - [ ] Enviar shots
  - [ ] Suportar até 3 mídias por mensagem

- [ ] Criar `src/modules/messages/media.service.ts`
  - [ ] Buscar mídias de media_store/media_cache
  - [ ] Suportar múltiplas mídias

### 7.2 Scheduler de Downsells e Shots

- [ ] Criar `src/scheduler/scheduler.ts`
  - [ ] Loop em memória (setInterval)
  - [ ] Processar downsells_queue
  - [ ] Processar shots_queue
  - [ ] Respeitar prioridade: /start > downsells > shots

---

## 🔒 Fase 8: Segurança & Performance (PRÓXIMO)

### 8.1 Variáveis de Ambiente

- [ ] Criar `src/config/env.ts`
  - [ ] Carregar .env uma única vez no startup
  - [ ] Validar variáveis obrigatórias
  - [ ] Exportar como singleton

### 8.2 Rate Limiting

- [ ] Implementar rate limiting em webhooks
  - [ ] Por bot
  - [ ] Por usuário

### 8.3 Monitoramento de Performance

- [ ] Adicionar métricas
  - [ ] Latência de webhook (meta: ≤ 200ms)
  - [ ] Latência de /start (meta: ≤ 500ms)
  - [ ] Latência de criação de PIX (meta: ≤ 2s)

---

## 🧪 Fase 9: Testes (PRÓXIMO)

### 9.1 Testes Unitários

- [ ] BotUserService
- [ ] TrackingSessionService
- [ ] PaymentGateway implementations
- [ ] FunnelService

### 9.2 Testes de Integração

- [ ] Webhook do Telegram → bot_user criado
- [ ] bot_user → tracking_session associada
- [ ] Pagamento criado → evento pix_created
- [ ] Pagamento pago → evento pix_paid + Facebook CAPI + UTMify

### 9.3 Testes de Performance

- [ ] ACK webhook < 200ms
- [ ] /start < 500ms
- [ ] Criação de PIX < 2s

---

## 🚀 Fase 10: Deploy (PRÓXIMO)

### 10.1 Preparação

- [ ] Revisar blueprint.md
- [ ] Revisar código
- [ ] Executar testes
- [ ] Verificar logs

### 10.2 Deploy em Produção

- [ ] Executar migrações em produção
- [ ] Deploy do código
- [ ] Monitorar logs
- [ ] Testar funil completo

---

## 📝 Notas Importantes

### Performance
- Sempre responder rápido ao Telegram (< 200ms)
- Enfileirar trabalho pesado assincronamente
- Usar índices no banco para queries frequentes
- Carregar .env uma única vez

### Segurança
- Nunca logar tokens/senhas
- Validar webhooks (assinatura)
- Usar HTTPS em produção
- Mascarar tokens em logs

### Migrações
- Sempre rodar em ordem (001 → 002 → 003 → 004)
- Verificar saúde do esquema após
- Nunca usar DROP em produção
- Manter compatibilidade com dados existentes

### Logs
- PT-BR simples
- Sempre incluir: bot, user, event_name, latency_ms
- Formato: [MODULO][ACAO] mensagem
- Níveis: INFO, WARN, ERROR

---

**Status Geral**: ✅ Fase 1 Completa | 🔄 Fase 2 Próxima
**Última Atualização**: 2025-11-08
**Responsável**: Cascade AI
