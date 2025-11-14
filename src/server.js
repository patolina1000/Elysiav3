#!/usr/bin/env node

/**
 * Servidor principal da aplicação Elysia
 * 
 * Responsabilidades:
 * - Inicializar Express
 * - Conectar ao banco de dados (via módulo centralizado db.js)
 * - Registrar rotas
 * - Iniciar scheduler de filas
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const { pool } = require('./db'); // Usar módulo centralizado de banco de dados
const config = require('./config');

// Importar rotas e módulos
const healthzRouter = require('./routes/healthz');
const telegramRouter = require('./routes/telegram');
const paymentsRouter = require('./routes/payments');
const metricsRouter = require('./routes/metrics');
const adminBotsRouter = require('./routes/admin-bots');
const adminBotConfigRouter = require('./routes/admin-bot-config');
const adminMediaRouter = require('./routes/admin-media');
const adminControlKpisRouter = require('./routes/admin-control-kpis');
const ngrokWebhooksRouter = require('./routes/ngrok-webhooks');
const publicUrlRouter = require('./routes/public-url');

// Importar serviços
const BotEngine = require('./modules/bot-engine');
const BotService = require('./modules/bot-service');
const QueueScheduler = require('./scheduler');
const ScheduledShotsWorker = require('./scheduled-shots-worker');
const NgrokManager = require('./modules/ngrok-manager');
const botTokenCache = require('./modules/bot-token-cache');
const { getCryptoService } = require('./modules/crypto-singleton');
const publicUrlManager = require('./modules/public-url-manager');

const PORT = config.port;

// Inicializar Express
const app = express();

// Inicializar serviços
const botEngine = new BotEngine(pool);
const botService = new BotService(pool, botEngine);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Para FormData

// Configurar multer para upload de mídias em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

app.use(express.static('public')); // Servir arquivos estáticos (frontend)

// Middleware de logging simples
app.use((req, res, next) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Middleware para adicionar URL pública do ngrok em headers (se disponível)
app.use((req, res, next) => {
  if (ngrokManager && ngrokManager.getPublicUrl()) {
    res.set('X-Public-URL', ngrokManager.getPublicUrl());
  }
  next();
});

// Injetar pool e serviços nas rotas
let ngrokManager = null;
app.use((req, res, next) => {
  req.pool = pool;
  req.botEngine = botEngine;
  req.botService = botService;
  req.ngrokManager = ngrokManager;
  req.app = app; // Disponibilizar app para acessar app.get('paymentGateway')
  next();
});

// Rotas
app.use('/healthz', healthzRouter);
app.use('/tg', telegramRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/admin/bots', adminBotsRouter);

// Middleware de upload para rota de media/upload
app.post('/api/admin/bots/:id/media/upload', upload.single('file'), (req, res, next) => {
  // Converter arquivo para req.body.file para compatibilidade com rota
  if (req.file) {
    req.body.file = req.file.buffer;
  }
  next();
});

app.use('/api/admin/bots', adminBotConfigRouter); // Config detalhada de bots
app.use('/api/admin/bots', adminMediaRouter); // Upload de mídia com warmup
app.use('/api/admin/bots', adminControlKpisRouter); // KPIs de controle
app.use('/api/ngrok', ngrokWebhooksRouter); // Gerenciamento de webhooks ngrok
app.use('/api/public-url', publicUrlRouter); // URL pública do ngrok

// Rota 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Inicializar scheduler de filas
const queueScheduler = new QueueScheduler(pool);
queueScheduler.start(5000); // Processar filas a cada 5 segundos

// Inicializar worker de shots agendados
const scheduledShotsWorker = new ScheduledShotsWorker();
scheduledShotsWorker.start(60000); // Verificar shots agendados a cada 1 minuto

// Inicializar ngrok (se habilitado)
async function initializeNgrok() {
  if (!config.useNgrok) {
    console.log('[NGROK] Desabilitado (NODE_ENV=production ou USE_NGROK=false)');
    return;
  }

  try {
    ngrokManager = new NgrokManager();
    const initialized = await ngrokManager.initialize();
    
    if (initialized) {
      console.log(`[NGROK] ✓ Inicializado com sucesso`);
      console.log(`[NGROK] URL pública: ${ngrokManager.getPublicUrl()}`);
      
      // Injetar ngrokManager no publicUrlManager
      publicUrlManager.setNgrokManager(ngrokManager);
      
      // Log de informações da URL pública
      const urlInfo = publicUrlManager.getInfo();
      console.log(`[PUBLIC_URL] Fonte: ${urlInfo.source} | Base: ${urlInfo.baseUrl}`);
      
      // Registrar webhooks de todos os bots ativos
      await registerAllBotWebhooks();
    } else {
      console.warn('[NGROK] ⚠ Não foi possível inicializar ngrok');
      console.warn('[NGROK] Certifique-se de que ngrok está rodando: ngrok http 3000');
    }
  } catch (error) {
    console.error('[NGROK] Erro ao inicializar:', error.message);
  }
}

// Registrar webhooks de todos os bots ativos
async function registerAllBotWebhooks() {
  try {
    const result = await pool.query(
      `SELECT id, slug, token_status FROM bots WHERE active = TRUE AND token_encrypted IS NOT NULL AND token_status = 'validated'`
    );

    if (result.rows.length === 0) {
      console.log('[NGROK] Nenhum bot ativo com token validado encontrado para registrar webhooks');
      return;
    }

    console.log(`[NGROK] Registrando webhooks para ${result.rows.length} bot(s)...`);

    for (const bot of result.rows) {
      try {
        // Obter token do cache (já descriptografado no boot)
        const botToken = botTokenCache.getToken(bot.id);
        
        if (!botToken) {
          console.warn(`[NGROK] Bot ${bot.slug} sem token no cache, pulando...`);
          continue;
        }

        const webhookResult = await ngrokManager.registerTelegramWebhook(botToken, bot.slug);
        
        if (webhookResult.ok) {
          console.log(`[NGROK] ✓ Webhook registrado: ${bot.slug}`);
          
          // Salvar secret_token no banco e cache
          if (webhookResult.secretToken) {
            await pool.query(
              'UPDATE bots SET webhook_secret_token = $1 WHERE id = $2',
              [webhookResult.secretToken, bot.id]
            );
            botTokenCache.setSecretToken(bot.id, webhookResult.secretToken);
          }
        } else {
          console.warn(`[NGROK] ✗ Erro ao registrar webhook para ${bot.slug}: ${webhookResult.error}`);
        }
      } catch (error) {
        console.error(`[NGROK] Erro ao registrar webhook para bot ${bot.slug}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[NGROK] Erro ao buscar bots:', error.message);
  }
}

// Inicializar servidor
app.listen(PORT, async () => {
  console.log(`[INFO] Servidor iniciado na porta ${PORT}`);
  console.log(`[INFO] Ambiente: ${config.nodeEnv}`);
  console.log(`[INFO] Banco de dados: conectado via DATABASE_URL`);
  console.log(`[INFO] Scheduler de filas iniciado`);
  
  // Inicializar cache de tokens (descriptografar no boot, não no hot path)
  try {
    const crypto = getCryptoService();
    await botTokenCache.initialize(pool, crypto);
    console.log('[INFO] Cache de tokens inicializado');
  } catch (error) {
    console.error('[ERRO] Falha ao inicializar cache de tokens:', error.message);
  }
  
  // Inicializar ngrok PRIMEIRO (para ter URL pública disponível)
  await initializeNgrok();
  
  // Inicializar gateways de pagamento DEPOIS do ngrok
  try {
    const PaymentGateway = require('./modules/payment-gateway');
    const PushinPayAdapter = require('./modules/gateways/pushinpay-adapter');
    
    const paymentGateway = new PaymentGateway(pool);
    
    // Registrar PushinPay (webhook_url é dinâmica via publicUrlManager)
    const pushinpayAdapter = new PushinPayAdapter({
      apiKey: process.env.PUSHINPAY_TOKEN,
      baseUrl: process.env.PUSHINPAY_BASE_URL
    });
    paymentGateway.registerGateway('pushinpay', pushinpayAdapter);
    
    // Tornar disponível globalmente para as rotas
    app.set('paymentGateway', paymentGateway);
    
    // Log de webhook URL da PushinPay
    const pushinpayWebhookUrl = pushinpayAdapter.getWebhookUrl();
    if (pushinpayWebhookUrl) {
      console.log(`[INFO] Gateways de pagamento inicializados: pushinpay`);
      console.log(`[INFO] PushinPay webhook URL: ${pushinpayWebhookUrl}`);
    } else {
      console.warn('[WARN] PushinPay inicializado mas webhook URL não disponível');
    }
  } catch (error) {
    console.error('[ERRO] Falha ao inicializar gateways de pagamento:', error.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[INFO] SIGTERM recebido, encerrando gracefully...');
  await pool.end();
  queueScheduler.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[INFO] SIGINT recebido, encerrando gracefully...');
  queueScheduler.stop();
  await pool.end();
  process.exit(0);
});

module.exports = app;
