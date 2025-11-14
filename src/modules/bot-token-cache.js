/**
 * Cache em memória de tokens descriptografados
 * 
 * Responsabilidades:
 * - Descriptografar tokens no boot (não no hot path)
 * - Manter tokens em memória para acesso rápido
 * - Atualizar cache quando tokens mudam
 * 
 * Benefícios:
 * - Elimina overhead de descriptografia no webhook (~5-20ms)
 * - Reduz latência de ACK
 * 
 * Uso:
 * const tokenCache = require('./bot-token-cache');
 * await tokenCache.initialize(pool, cryptoService);
 * const token = tokenCache.getToken(botId);
 */

class BotTokenCache {
  constructor() {
    this.tokens = new Map(); // botId -> token descriptografado
    this.secretTokens = new Map(); // botId -> secret_token do webhook
    this.isInitialized = false;
  }

  /**
   * Inicializar cache carregando todos os tokens do banco
   * @param {Pool} pool - Pool de conexões do Postgres
   * @param {CryptoService} cryptoService - Serviço de criptografia
   */
  async initialize(pool, cryptoService) {
    try {
      console.log('[TOKEN_CACHE] Inicializando cache de tokens...');
      
      const result = await pool.query(
        `SELECT id, slug, token_encrypted, webhook_secret_token 
         FROM bots 
         WHERE active = TRUE AND token_encrypted IS NOT NULL`
      );

      let successCount = 0;
      let failCount = 0;

      for (const bot of result.rows) {
        try {
          const decryptedToken = cryptoService.decrypt(bot.token_encrypted);
          this.tokens.set(bot.id, decryptedToken);
          
          if (bot.webhook_secret_token) {
            this.secretTokens.set(bot.id, bot.webhook_secret_token);
          }
          
          successCount++;
        } catch (error) {
          console.error(`[TOKEN_CACHE] Erro ao descriptografar token do bot ${bot.slug}:`, error.message);
          failCount++;
        }
      }

      this.isInitialized = true;
      console.log(`[TOKEN_CACHE] ✓ Cache inicializado: ${successCount} tokens carregados, ${failCount} falhas`);
      
      return { success: successCount, failed: failCount };
    } catch (error) {
      console.error('[TOKEN_CACHE] Erro ao inicializar cache:', error.message);
      throw error;
    }
  }

  /**
   * Obter token descriptografado de um bot
   * @param {number} botId - ID do bot
   * @returns {string|null} - Token descriptografado ou null
   */
  getToken(botId) {
    return this.tokens.get(botId) || null;
  }

  /**
   * Obter secret_token do webhook de um bot
   * @param {number} botId - ID do bot
   * @returns {string|null} - Secret token ou null
   */
  getSecretToken(botId) {
    return this.secretTokens.get(botId) || null;
  }

  /**
   * Adicionar ou atualizar token no cache
   * @param {number} botId - ID do bot
   * @param {string} token - Token descriptografado
   */
  setToken(botId, token) {
    this.tokens.set(botId, token);
  }

  /**
   * Adicionar ou atualizar secret_token no cache
   * @param {number} botId - ID do bot
   * @param {string} secretToken - Secret token do webhook
   */
  setSecretToken(botId, secretToken) {
    this.secretTokens.set(botId, secretToken);
  }

  /**
   * Remover token do cache
   * @param {number} botId - ID do bot
   */
  removeToken(botId) {
    this.tokens.delete(botId);
    this.secretTokens.delete(botId);
  }

  /**
   * Verificar se cache está inicializado
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Obter estatísticas do cache
   */
  getStats() {
    return {
      tokenCount: this.tokens.size,
      secretTokenCount: this.secretTokens.size,
      initialized: this.isInitialized
    };
  }

  /**
   * Limpar cache (útil para testes)
   */
  clear() {
    this.tokens.clear();
    this.secretTokens.clear();
    this.isInitialized = false;
  }
}

// Singleton
const instance = new BotTokenCache();

module.exports = instance;
