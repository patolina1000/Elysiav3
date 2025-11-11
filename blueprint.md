# Projeto Multi-Bots + Gateways + Tracking  
(Blueprint / Plano + Migrações + Regras de Logs)

> Versão: 2025-11-07  
> Banco: `postgreesql_elysia` (schema `public`)  
> Objetivo: reaproveitar ao máximo o esquema atual e implantar um sistema multi-bots com gateways de pagamento, tracking completo (Facebook + UTMify) e métricas de funil – em 2 dias.

---

## 1. Objetivos e princípios

1. **Multi-bots reais**
   - Cada bot tem:
     - `/start` próprio
     - Downsells próprios
     - Shots próprios
     - Mídias próprias (até **3 mídias por mensagem**).

2. **Pagamentos embutidos**
   - Suporte a vários gateways (ex.: PushinPay, SyncPay) via **interface única**.
   - Cada bot escolhe seu gateway default.

3. **Tracking & Métricas**
   - Funil completo:
     - Presell → clique pro bot → `/start` → PIX gerado → PIX pago.
   - Integração:
     - Facebook Pixel (browser) + CAPI (backend)
     - UTMify (envio de pedidos em `pix_paid`).
   - Métricas chave:
     - Presell views
     - Entradas no bot
     - PIX gerados/pagos
     - Tempo até gerar PIX e até pagar
     - Tempo/permanência no bot.

4. **Ênfase em performance**
   - Tudo deve ser pensado pra **ser rápido primeiro**:
     - ACK do webhook do Telegram: **≤ 200 ms**.
     - Primeira mensagem útil do `/start`: **≤ 500 ms** (p95).
   - Evitar operações pesadas no caminho quente (joins desnecessários, loops enormes, uploads, etc.).
   - **Segurança não é o foco principal deste projeto**, mas:
     - ainda assim não vamos fazer nada *deliberadamente inseguro absurdo* (ex.: logar senhas em texto puro, deixar token em HTML público etc.).
     - o mínimo de cuidado com segredo (`.env`) e tokens deve ser mantido.

### Metas de performance (SLO p95)

| Operação                 | Meta p95  |
|--------------------------|----------:|
| ACK webhook Telegram     | ≤ 200 ms  |
| Primeira mensagem /start | ≤ 500 ms  |
| Criação de PIX           | ≤ 2 s     |

5. **Migrações e código estáveis**
   - Reaproveitar tabelas existentes.
   - Criar poucas tabelas novas.
   - Migrações **idempotentes**, previsíveis e fáceis de entender.

6. **Logs simples e completos**
   - Logar **tudo o que é relevante** (entrada, saída, erros, tempos).
   - Mensagens de log em **PT-BR simples**, para alguém com pouco conhecimento conseguir entender:
     - evitar jargão técnico desnecessário;
     - sempre dizer **o que aconteceu** e **com quem** (bot, usuário, evento).
   - Nunca logar segredos (tokens, senhas, chaves de API).

7. **.env enxuto**
   - O arquivo `.env` deve conter **apenas o essencial**:
     - tokens de bot,
     - chaves de gateway,
     - credenciais de banco,
     - URLs externas necessárias.
   - Configurações de negócio (ex.: delays, textos, planos) devem ficar no **banco**, nunca no `.env`.

---

## 2. Situação atual do Postgres

Tabelas existentes relevantes (conforme inspeção no DBeaver):

- **Bots & mensagens**
  - `bots`
  - `bot_messages`
  - `bot_downsells`
  - `downsells_queue`
  - `shots`
  - `shots_queue`

- **Mídia**
  - `media_store`
  - `media_cache`

- **Funil / tracking**
  - `funnel_events`
  - `funnel_events_2025_10`
  - `funnel_events_2025_11`
  - `funnel_events_2025_12`
  - `funnel_events_default`
  - `funnel_events_legacy`

- **Pagamentos / integrações**
  - `payments`
  - `gateway_events`
  - `outbox`

Há dados já existentes, por exemplo:

- `bots`: bot `vipshadriee_bot` com provider `pushinpay`, token e `token_encrypted`.
- `bot_downsells`: downsell com `slug = vipshadriee_bot`, `content` JSON, `delay_seconds = 60`, `active = true`.
- `funnel_events`: já contém registros.

**Decisão:**  
Essas tabelas serão **o núcleo oficial do novo sistema**.  
Vamos **complementar** o que falta com novas tabelas e colunas, sem quebrar o que está em produção.

---

## 3. Arquitetura (resumo)

1. **API HTTP**
   - `GET /healthz`
   - `POST /tg/:slug/webhook` – webhook Telegram por bot.
   - `POST /api/payments/webhook/:gateway` – webhooks dos gateways.
   - `GET /api/metrics` – métricas básicas de funil.

2. **Bot Engine**
   - Resolve `bot` pelo `slug` (tabela `bots`).
   - Normaliza updates do Telegram em eventos: `/start`, callbacks etc.
   - Enfileira trabalho, responde rápido pro Telegram.

3. **Módulo de Mensagens**
   - Usa `bot_messages`, `bot_downsells`, `downsells_queue`, `shots`, `shots_queue`, `media_store` e `media_cache`.
   - Envia:
     - mensagens de `/start`,
     - downsells,
     - shots,
     - cada uma com até **3 mídias**.

4. **Módulo de Pagamentos**
   - Interface `PaymentGateway`.
   - Registry de gateways (`pushinpay`, `syncpay`, …).
   - Base em `bots.provider` + `payments`.

5. **Tracking & Analytics**
   - `tracking_sessions` (novo) – sessão web com UTMs, `fbp`, `fbc`.
   - `funnel_events` – eventos do funil (presell, bot, pagamentos).
   - Integrações:
     - Facebook Pixel (browser) + CAPI (backend).
     - UTMify (back-end em `pix_paid`).

6. **Scheduler leve**
   - Loop simples em memória (`setInterval`).
   - Processa `downsells_queue` e `shots_queue` respeitando prioridade:
     - `/start` > downsells > shots.

---

## 4. Modelo de dados (alvo)

*(Mesma ideia da versão anterior, só mantendo aqui resumido; foco desta atualização é migração, logs e env.)*

### 4.1. Tabelas reaproveitadas

- `bots` – catálogo de bots (multi-bots).
- `bot_messages` – templates de mensagens (`start`, `shot`, etc.).
- `bot_downsells` + `downsells_queue` – sistema de downsell.
- `shots` + `shots_queue` – sistema de disparos.
- `media_store` + `media_cache` – armazenamento/cache de mídias.
- `payments` – cobranças (PIX, etc.).
- `funnel_events` (+ partições) – eventos de funil.
- `gateway_events` / `outbox` – logs de integração.

### 4.2. Tabelas novas

1. `bot_users`
2. `tracking_sessions`

### 4.3. Colunas novas

- Em `funnel_events`
- Em `payments`

*(Detalhadas nas migrações abaixo.)*

---

## 5. Regras de logs

### 5.1. Princípios

1. **Logar tudo que importa:**
   - Entrada de webhook do Telegram (bot, chat, tipo de update).
   - Envio de mensagens (bot, usuário, tipo de mensagem, mídias, tempo).
   - Criação de cobrança (bot, usuário, valor, gateway).
   - Atualização de pagamento (status vindo do gateway).
   - Eventos de funil importantes (presell, clique, start, pix_created, pix_paid).

2. **Linguagem simples**
   - Português claro, frases como:
     - `[BOT][START] Mensagem inicial enviada para 7205343917 em 180 ms`
     - `[PAYMENT][PIX_CREATED] bot=vipshadriee_bot user=7205343917 valor=9.90 status=pending`
   - Evitar coisas que assustem quem não programa:
     - em vez de “Unhandled exception in async handler”, usar
       - `[ERRO] Falha ao enviar mensagem para o usuário 7205343917: <detalhe curto>`.

3. **Sem segredos em log**
   - Nunca logar:
     - tokens de bot,
     - chaves de API de gateways,
     - senhas de banco ou `.env`.
   - Quando precisar se referir a token, usar versão mascarada:
     - `8240789...LEOBE`.

4. **Campos mínimos sempre logados**
   - `request_id` (se existir).
   - `slug` / `bot_id`.
   - `telegram_id` ou `bot_user_id`.
   - `event_name` ou ação (`start`, `shot_send`, `pix_created`, etc.).
   - `latency_ms` quando for operação de envio/message/pagamento.

5. **Níveis de log**
   - INFO: tudo que dá certo.
   - WARN: coisas inesperadas, mas que o sistema recupera (ex.: gateway voltou 429).
   - ERROR: falhas que impedem envio de mensagem ou registro de pagamento.

### 5.2. Glossário de event_name (padrão)

Valores padrão para a coluna `event_name` em `funnel_events`:

- `presell_view` – Usuário viu presell (landing page).
- `to_bot_click` – Usuário clicou no link para entrar no bot.
- `bot_start` – Usuário disparou `/start` no bot.
- `pix_created` – PIX foi gerado para o usuário.
- `pix_paid` – PIX foi pago com sucesso.
- `bot_interaction` – Usuário interagiu com o bot (clique em botão, etc.).
- `bot_session_end` – (Futuro) Sessão do usuário no bot terminou.

---

## 6. Regras para `.env`

### 6.1. Só o mínimo necessário

- `DATABASE_URL` – Credenciais de banco de dados.
- Tokens de bots (Telegram).
- Credenciais dos gateways de pagamento (PushinPay, SyncPay, etc.).
- Credenciais da UTMify.
- Pixel ID e access token do Facebook CAPI.
- URLs base de serviços externos (se não forem fixas no código).

### 6.2. O que NÃO deve ir pro `.env`

- Textos de mensagens de bot.
- Delays de downsell (`delay_seconds`).
- Planos de preço, descontos, etc.
- Configurações de filtro de shots.
- **Qualquer coisa que seja "negócio"** e precise ser alterada via painel ou SQL deve morar no banco:
  - `bots`, `bot_messages`, `bot_downsells`, `shots`, etc.

### 6.3. Impacto em performance

- `.env` é lido **uma única vez** na inicialização do servidor.
- **Nunca** reprocessar `.env` no meio de uma request.
- Carregar todas as variáveis de ambiente na memória no startup e reutilizá-las.
- Evitar ler arquivo de configuração em disco dentro do hot path.

---

## 7. Migrações – regras gerais

### 7.1. Princípios de migração (para não quebrar o código)

#### 1. Idempotência

Toda migração deve poder rodar mais de uma vez sem erro.

Sempre usar:
- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`

#### 2. Nunca apagar coisas em produção neste projeto

Não usar `DROP TABLE`, `DROP COLUMN` ou mudanças destrutivas.

Se um campo "morrer", apenas pare de usá-lo no código; a limpeza pode ser feita manualmente no futuro.

#### 3. Compatibilidade com código antigo

- Novas colunas devem ser `NULLABLE` ou ter `DEFAULT` quando fizer sentido.
- Não transformar coluna antiga em `NOT NULL` sem antes popular todos os dados.
- Não renomear colunas em produção; se precisar, criar uma nova coluna, migrar dados e deprecar a antiga em outra fase.

#### 4. Ordem das migrações

Sempre:
1. Criar tabelas novas (`bot_users`, `tracking_sessions`).
2. Adicionar colunas em tabelas existentes (`funnel_events`, `payments`).
3. Só depois alterar o código para depender dessas colunas/tabelas novas.
4. No deploy, garantir que as migrações rodam antes de subir o novo código.

#### 5. Particionamento

`funnel_events` é particionada.

Sempre alterar apenas a tabela mãe: `ALTER TABLE funnel_events ...`

Confiar no PostgreSQL para propagar as novas colunas para as partições automaticamente.

#### 6. Verificação rápida após migração

Depois de rodar as migrações em desenvolvimento, executar:

```sql
SELECT COUNT(*) FROM bot_users;
SELECT * FROM funnel_events LIMIT 10;
SELECT * FROM payments LIMIT 10;
```

Se essas consultas funcionarem sem erro, o esquema base está saudável.

---

## 8. Fase futura — Sistema de mídia avançado (resumo)

Esta é uma visão de futuro (V2+) para otimizar ainda mais o envio de imagens:
- Usar Cloudflare R2 ou similar para armazenar mídias de forma centralizada e escalável.
- Fazer warm-up das mídias em canal de aquecimento privado do Telegram e cachear `tg_file_id` em `media_cache`.
- No caminho quente (envio para usuários), sempre usar `file_id` para máxima performance, sem upload em tempo real.
- Painel simples de upload e vinculação de mídia aos bots/mensagens, acessível em `/admin`.

---

