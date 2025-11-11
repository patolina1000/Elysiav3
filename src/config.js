/**
 * Configuração centralizada
 * 
 * Carrega variáveis de ambiente uma única vez na inicialização
 * Nunca reprocessar .env no meio de uma request
 */

require('dotenv').config();

const config = {
  // Servidor
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ngrok (para desenvolvimento com Telegram)
  useNgrok: process.env.USE_NGROK === 'true' || process.env.NODE_ENV !== 'production',
  ngrokApiUrl: process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api',

  // Banco de dados
  databaseUrl: process.env.DATABASE_URL,

  // Performance
  queueProcessInterval: parseInt(process.env.QUEUE_PROCESS_INTERVAL || '5000', 10),
  httpTimeout: parseInt(process.env.HTTP_TIMEOUT || '10000', 10),

  // Gateways de pagamento
  gateways: {
    pushinpay: {
      apiKey: process.env.PUSHINPAY_API_KEY,
      apiSecret: process.env.PUSHINPAY_API_SECRET
    },
    syncpay: {
      apiKey: process.env.SYNCPAY_API_KEY,
      apiSecret: process.env.SYNCPAY_API_SECRET
    }
  },

  // Integrações externas
  utmify: {
    apiKey: process.env.UTMIFY_API_KEY,
    apiUrl: process.env.UTMIFY_API_URL || 'https://api.utmify.com'
  },

  facebook: {
    pixelId: process.env.FACEBOOK_PIXEL_ID,
    capiAccessToken: process.env.FACEBOOK_CAPI_ACCESS_TOKEN
  },

  // Segurança
  tokenSecret: process.env.TOKEN_SECRET || 'dev-secret-change-in-production-min-32-chars'
};

// Validações básicas
if (!config.databaseUrl) {
  throw new Error('DATABASE_URL não definida em .env');
}

if (!process.env.TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('TOKEN_SECRET não definida em .env (obrigatório em produção)');
}

module.exports = config;
