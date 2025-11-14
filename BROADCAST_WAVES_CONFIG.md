# Sistema de Broadcast em Ondas - Configuração

## Visão Geral

Sistema implementado para envio de Downsells e Shots em ondas (batches), evitando flood no Telegram e respeitando rate limits.

## Componentes Implementados

### 1. **rate-limiter.js**
- **Localização**: `src/modules/rate-limiter.js`
- **Função**: Controle de taxa de envio
- **Limites**:
  - Por chat: 5 msg/s (alvo interno)
  - Global: 20 msg/s (configurável)
- **Características**:
  - Token bucket algorithm
  - Backoff automático em caso de 429
  - Cleanup automático de buckets inativos

### 2. **broadcast-service.js**
- **Localização**: `src/modules/broadcast-service.js`
- **Função**: Motor de broadcast em ondas
- **Responsabilidades**:
  - Selecionar usuários ativos (mesma regra do dashboard)
  - Aplicar filtros (trigger_type, deduplicação)
  - Dividir em ondas
  - Agendar jobs na `broadcast_waves_queue`

### 3. **broadcast-wave-worker.js**
- **Localização**: `src/modules/broadcast-wave-worker.js`
- **Função**: Processar ondas individuais
- **Responsabilidades**:
  - Revalidar elegibilidade antes de enviar
  - Enviar usando pipeline existente (MessageService)
  - Registrar eventos no funil

### 4. **Migration: broadcast_waves_queue**
- **Localização**: `migrations/024_add_broadcast_waves_queue.sql`
- **Tabela**: `broadcast_waves_queue`
- **Campos principais**:
  - `bot_id`, `bot_slug`, `kind` (downsell/shot)
  - `context` (JSONB com downsellId ou shotId)
  - `chat_ids` (JSONB array de telegram_ids)
  - `wave_index`, `total_waves`
  - `schedule_at` (quando processar)
  - `status` (pending/processing/completed/error)

## Configuração de Rate Limits

### Variáveis de Ambiente (Opcionais)

```bash
# Rate limit global (msg/s)
BROADCAST_GLOBAL_RATE=20

# Duração entre ondas (ms)
BROADCAST_WAVE_DURATION=1000
```

### Valores Padrão

- **GLOBAL_SAFE_RATE**: 20 msg/s
- **WAVE_DURATION_MS**: 1000ms (1 segundo)
- **WAVE_SIZE**: 20 mensagens por onda
- **Per-chat rate**: 5 msg/s (com backoff se muitos 429)

## Fluxo de Funcionamento

### Para Shots Imediatos

1. Admin salva shot com `schedule_type='immediate'` e `active=true`
2. `ShotScheduler.createImmediateJobs()` é chamado
3. `BroadcastService.scheduleBroadcastInWaves()`:
   - Busca usuários ativos (`bot_users` WHERE `blocked=FALSE`)
   - Aplica filtros de trigger_type (start/pix)
   - Remove quem já recebeu (deduplicação)
   - Divide em ondas de 20 usuários
   - Cria jobs em `broadcast_waves_queue`
4. `Scheduler.processBroadcastWavesQueue()` processa ondas:
   - A cada 5 segundos, busca ondas com `schedule_at <= NOW()`
   - `BroadcastWaveWorker.processWave()`:
     - Revalida cada chat (ainda ativo? ainda não pagou?)
     - Envia via `MessageService.sendMessage()`
     - Rate limiter aplica espera se necessário
     - Registra em `funnel_events`

### Para Downsells Imediatos

Similar aos shots, mas usando `DownsellScheduler.broadcastImmediate()`.

**Nota**: Downsells após /start ou PIX continuam usando o sistema individual (com delay), apenas broadcasts manuais usam ondas.

### Para Downsells/Shots Agendados

Downsells após /start ou PIX usam `downsells_queue` com delay individual (comportamento existente mantido).

## Logs e Monitoramento

### Logs de Broadcast

```
[BROADCAST][SCHEDULE] { bot, kind, totalTargets, waveSize, numWaves }
[BROADCAST][WAVE] { bot, kind, waveIndex, totalWaves, totalInWave }
[BROADCAST][WAVE][SENT] { bot, kind, chatId, latencyMs }
[BROADCAST][WAVE][SKIP] { bot, kind, chatId, reason }
[BROADCAST][WAVE][COMPLETE] { bot, kind, waveIndex, sent, skipped, failed }
```

### Logs de Rate Limiting

```
[RATE_LIMIT][WAIT] { chatId, waitedMs, globalTokens, chatTokens }
[RATE_LIMITER][BACKOFF_APPLIED] { recent429Count, oldMultiplier, newMultiplier }
[TELEGRAM][RATE_LIMIT][429] { scope, chatId, retryAfter, method }
```

## Tratamento de 429 (Too Many Requests)

1. **Detecção**: `MessageService.sendViaTelegramAPI()` detecta status 429
2. **Registro**: `RateLimiter.register429()` é chamado
3. **Backoff**: Se >5 erros 429 em 60s, aplica backoff (multiplica delay por 1.2x)
4. **Retry**: Se Telegram retorna `retry_after`, respeita o valor
5. **Log**: Registra em `[TELEGRAM][RATE_LIMIT][429]`

## Métricas Disponíveis

### Via RateLimiter.getStats()

```javascript
{
  totalRequests: number,
  totalWaits: number,
  total429s: number,
  avgWaitMs: number,
  backoffMultiplier: number,
  recent429Count: number,
  globalTokens: number,
  activeChatBuckets: number
}
```

## Testes Recomendados

### 1. Poucos Usuários (2-3)
- Deve ser praticamente instantâneo
- Sem ondas (tudo em uma onda)

### 2. Muitos Usuários (100+)
- Verificar logs de ondas (`waveIndex`)
- Confirmar que não há flood de 429
- Validar que chats bloqueados não recebem

### 3. Regras de Gatilho
- **trigger_type='start'**: Todos os ativos
- **trigger_type='pix'**: Apenas quem gerou PIX e não pagou

### 4. Deduplicação
- Mesmo shot/downsell não deve ser enviado 2x para o mesmo usuário
- Verificar `funnel_events` e `downsells_queue`

## Ajustes de Performance

### Se aparecerem muitos 429:

1. **Reduzir GLOBAL_SAFE_RATE**:
   ```bash
   BROADCAST_GLOBAL_RATE=10
   ```

2. **Aumentar WAVE_DURATION**:
   ```bash
   BROADCAST_WAVE_DURATION=2000  # 2 segundos entre ondas
   ```

3. **Monitorar backoff**:
   - Se `backoffMultiplier` > 1.5, sistema está sob pressão
   - Considerar reduzir taxa global

### Se envios estiverem muito lentos:

1. **Aumentar GLOBAL_SAFE_RATE** (com cuidado):
   ```bash
   BROADCAST_GLOBAL_RATE=30
   ```

2. **Reduzir WAVE_DURATION**:
   ```bash
   BROADCAST_WAVE_DURATION=500  # 0.5 segundos
   ```

## Migração

### Executar Migration

```bash
# Via psql
psql -U postgres -d elysia -f migrations/024_add_broadcast_waves_queue.sql

# Ou via script de migração do projeto
npm run migrate
```

### Verificar Tabela

```sql
SELECT * FROM broadcast_waves_queue LIMIT 10;
```

## API para Broadcast Manual

### Downsell Imediato

```javascript
const DownsellScheduler = require('./modules/downsell-scheduler');
const scheduler = new DownsellScheduler(pool);

const result = await scheduler.broadcastImmediate(botId, downsellId);
// { totalTargets, waves, queued }
```

### Shot Imediato

Já integrado automaticamente ao salvar shot com `schedule_type='immediate'` e `active=true`.

## Compatibilidade

- ✅ Sistema existente de downsells individuais (após /start, PIX) mantido
- ✅ Sistema existente de shots agendados mantido
- ✅ Pipeline de envio (`MessageService`) reutilizado
- ✅ Mesma lógica de usuários ativos do dashboard
- ✅ Deduplicação via `funnel_events` e `downsells_queue`

## Troubleshooting

### Ondas não estão sendo processadas

1. Verificar se scheduler está rodando
2. Verificar logs: `[SCHEDULER][BROADCAST_WAVE]`
3. Checar tabela: `SELECT * FROM broadcast_waves_queue WHERE status='pending'`

### Muitos 429

1. Verificar `backoffMultiplier` nas stats
2. Reduzir `BROADCAST_GLOBAL_RATE`
3. Aumentar `BROADCAST_WAVE_DURATION`
4. Verificar logs: `[TELEGRAM][RATE_LIMIT][429]`

### Usuários não recebendo

1. Verificar se estão bloqueados: `SELECT blocked FROM bot_users WHERE telegram_id=X`
2. Verificar deduplicação: `SELECT * FROM funnel_events WHERE event_id LIKE 'shot:X:%'`
3. Verificar logs: `[BROADCAST][WAVE][SKIP]`

### Performance lenta

1. Verificar índices na tabela `broadcast_waves_queue`
2. Verificar quantidade de ondas: muitos usuários = muitas ondas
3. Considerar aumentar `WAVE_SIZE` (aumentar `BROADCAST_GLOBAL_RATE`)
