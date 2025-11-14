/**
 * Cliente HTTP otimizado para Telegram Bot API
 * 
 * Responsabilidades:
 * - Reutilizar conexões HTTP/TLS (keep-alive)
 * - Reduzir handshakes TLS (~50-150ms por request)
 * - Configurar timeouts adequados
 * 
 * Uso:
 * const client = require('./telegram-http-client');
 * const response = await client.post(botToken, 'sendMessage', { chat_id, text });
 */

const axios = require('axios');
const https = require('https');

// Agente HTTP com keep-alive habilitado
// Reutiliza conexões TLS para reduzir latência
const httpsAgent = new https.Agent({
  keepAlive: true,              // Manter conexões abertas
  keepAliveMsecs: 30000,        // Enviar keep-alive a cada 30s
  maxSockets: 50,               // Máximo de 50 sockets simultâneos
  maxFreeSockets: 10,           // Manter até 10 sockets livres em pool
  timeout: 60000,               // Timeout de socket de 60s
  scheduling: 'lifo'            // LIFO = reutilizar conexões mais recentes (mais quentes)
});

// Instância axios configurada para Telegram API
const telegramClient = axios.create({
  baseURL: 'https://api.telegram.org',
  timeout: 10000,               // Timeout de request de 10s
  httpsAgent,                   // Usar agente com keep-alive
  validateStatus: () => true    // Não lançar erro em status != 2xx
});

/**
 * Fazer POST para Telegram Bot API
 * @param {string} botToken - Token do bot
 * @param {string} method - Método da API (ex: 'sendMessage', 'sendPhoto')
 * @param {object} data - Payload do request
 * @returns {Promise<object>} - Resposta da API
 */
async function post(botToken, method, data) {
  try {
    const response = await telegramClient.post(`/bot${botToken}/${method}`, data);
    return response.data;
  } catch (error) {
    console.error('[TELEGRAM_CLIENT:ERROR]', JSON.stringify({
      method,
      error: error.message,
      code: error.code
    }));
    return {
      ok: false,
      error: error.message
    };
  }
}

/**
 * Fazer GET para Telegram Bot API
 * @param {string} botToken - Token do bot
 * @param {string} method - Método da API (ex: 'getMe', 'getWebhookInfo')
 * @returns {Promise<object>} - Resposta da API
 */
async function get(botToken, method) {
  try {
    const response = await telegramClient.get(`/bot${botToken}/${method}`);
    return response.data;
  } catch (error) {
    console.error('[TELEGRAM_CLIENT:ERROR]', JSON.stringify({
      method,
      error: error.message,
      code: error.code
    }));
    return {
      ok: false,
      error: error.message
    };
  }
}

/**
 * Obter estatísticas do agente HTTP
 * Útil para debug e monitoramento
 */
function getStats() {
  return {
    maxSockets: httpsAgent.maxSockets,
    maxFreeSockets: httpsAgent.maxFreeSockets,
    sockets: Object.keys(httpsAgent.sockets).length,
    freeSockets: Object.keys(httpsAgent.freeSockets).length,
    requests: Object.keys(httpsAgent.requests).length
  };
}

module.exports = {
  post,
  get,
  getStats,
  // Exportar cliente para uso avançado
  client: telegramClient,
  agent: httpsAgent
};
