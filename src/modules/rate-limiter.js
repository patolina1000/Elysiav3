/**
 * Rate Limiter Service
 * 
 * Implementa controle de taxa para envio de mensagens do Telegram:
 * - Por chat: até 5 msg/s (alvo interno, sabendo que oficial é 1 msg/s)
 * - Global: até 20-30 msg/s para o bot inteiro
 * 
 * Usa token bucket para permitir bursts controlados
 * Se aparecerem muitos 429, aplica backoff suave
 */

class RateLimiter {
  constructor(options = {}) {
    // Configurações globais
    this.globalMaxRate = options.globalMaxRate || 20; // msg/s
    this.globalTokens = this.globalMaxRate;
    this.globalLastRefill = Date.now();
    
    // Configurações por chat
    this.perChatMaxRate = options.perChatMaxRate || 5; // msg/s
    this.chatBuckets = new Map(); // chatId -> { tokens, lastRefill }
    
    // Backoff para 429
    this.backoffMultiplier = 1.0; // Começa em 1.0, aumenta se houver muitos 429
    this.recent429Count = 0;
    this.recent429Window = Date.now();
    
    // Estatísticas
    this.stats = {
      totalRequests: 0,
      totalWaits: 0,
      total429s: 0,
      avgWaitMs: 0
    };
  }

  /**
   * Aguardar até que haja tokens disponíveis para enviar
   * @param {number} chatId - ID do chat
   * @returns {Promise<{waitedMs: number, globalTokens: number, chatTokens: number}>}
   */
  async acquireToken(chatId) {
    const startTime = Date.now();
    let totalWaitMs = 0;

    // Loop até conseguir tokens tanto global quanto por chat
    while (true) {
      // 1. Refill de tokens
      this._refillGlobalTokens();
      this._refillChatTokens(chatId);

      // 2. Verificar se há tokens disponíveis
      const globalAvailable = this.globalTokens >= 1;
      const chatBucket = this.chatBuckets.get(chatId);
      const chatAvailable = chatBucket && chatBucket.tokens >= 1;

      if (globalAvailable && chatAvailable) {
        // Consumir tokens
        this.globalTokens -= 1;
        chatBucket.tokens -= 1;

        const waitedMs = Date.now() - startTime;
        if (waitedMs > 0) {
          this.stats.totalWaits++;
          this.stats.avgWaitMs = 
            (this.stats.avgWaitMs * (this.stats.totalWaits - 1) + waitedMs) / this.stats.totalWaits;
        }

        this.stats.totalRequests++;

        return {
          waitedMs,
          globalTokens: this.globalTokens,
          chatTokens: chatBucket.tokens
        };
      }

      // 3. Aguardar um pouco antes de tentar novamente
      // Calcular quanto tempo falta para o próximo token
      const globalRefillIn = globalAvailable ? 0 : (1000 / this.globalMaxRate) * this.backoffMultiplier;
      const chatRefillIn = chatAvailable ? 0 : (1000 / this.perChatMaxRate) * this.backoffMultiplier;
      const waitMs = Math.max(10, Math.min(globalRefillIn, chatRefillIn));

      await new Promise(resolve => setTimeout(resolve, waitMs));
      totalWaitMs += waitMs;

      // Timeout de segurança: não esperar mais de 5 segundos
      if (totalWaitMs > 5000) {
        console.warn('[RATE_LIMITER][TIMEOUT]', {
          chatId,
          totalWaitMs,
          globalTokens: this.globalTokens,
          chatTokens: chatBucket?.tokens || 0
        });
        // Forçar liberação
        this.globalTokens = Math.max(this.globalTokens, 1);
        if (chatBucket) {
          chatBucket.tokens = Math.max(chatBucket.tokens, 1);
        }
      }
    }
  }

  /**
   * Registrar um erro 429 (Too Many Requests)
   * Aplica backoff suave se houver muitos 429s
   */
  register429(chatId, retryAfter = null) {
    this.stats.total429s++;
    this.recent429Count++;

    // Resetar janela de 429s a cada 60 segundos
    const now = Date.now();
    if (now - this.recent429Window > 60000) {
      this.recent429Window = now;
      this.recent429Count = 1;
    }

    // Se houver muitos 429s (>5 em 60s), aplicar backoff
    if (this.recent429Count > 5) {
      const oldMultiplier = this.backoffMultiplier;
      this.backoffMultiplier = Math.min(2.0, this.backoffMultiplier * 1.2);
      
      console.warn('[RATE_LIMITER][BACKOFF_APPLIED]', {
        recent429Count: this.recent429Count,
        oldMultiplier: oldMultiplier.toFixed(2),
        newMultiplier: this.backoffMultiplier.toFixed(2),
        chatId
      });
    }

    // Se Telegram especificou retry_after, respeitar
    if (retryAfter && retryAfter > 0) {
      // Zerar tokens para forçar espera
      this.globalTokens = 0;
      const chatBucket = this.chatBuckets.get(chatId);
      if (chatBucket) {
        chatBucket.tokens = 0;
      }

      console.warn('[RATE_LIMITER][429_RETRY_AFTER]', {
        chatId,
        retryAfter,
        willWaitMs: retryAfter * 1000
      });
    }
  }

  /**
   * Refill de tokens globais (token bucket)
   */
  _refillGlobalTokens() {
    const now = Date.now();
    const elapsedMs = now - this.globalLastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.globalMaxRate;

    if (tokensToAdd >= 1) {
      this.globalTokens = Math.min(
        this.globalMaxRate,
        this.globalTokens + Math.floor(tokensToAdd)
      );
      this.globalLastRefill = now;
    }
  }

  /**
   * Refill de tokens por chat (token bucket)
   */
  _refillChatTokens(chatId) {
    const now = Date.now();
    
    if (!this.chatBuckets.has(chatId)) {
      this.chatBuckets.set(chatId, {
        tokens: this.perChatMaxRate,
        lastRefill: now
      });
      return;
    }

    const bucket = this.chatBuckets.get(chatId);
    const elapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.perChatMaxRate;

    if (tokensToAdd >= 1) {
      bucket.tokens = Math.min(
        this.perChatMaxRate,
        bucket.tokens + Math.floor(tokensToAdd)
      );
      bucket.lastRefill = now;
    }
  }

  /**
   * Obter estatísticas do rate limiter
   */
  getStats() {
    return {
      ...this.stats,
      backoffMultiplier: this.backoffMultiplier,
      recent429Count: this.recent429Count,
      globalTokens: this.globalTokens,
      activeChatBuckets: this.chatBuckets.size
    };
  }

  /**
   * Resetar backoff (útil para testes ou após período de calmaria)
   */
  resetBackoff() {
    this.backoffMultiplier = 1.0;
    this.recent429Count = 0;
    this.recent429Window = Date.now();
  }

  /**
   * Limpar buckets de chats inativos (para evitar memory leak)
   * Chamar periodicamente (ex: a cada 5 minutos)
   */
  cleanupInactiveBuckets() {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutos
    let cleaned = 0;

    for (const [chatId, bucket] of this.chatBuckets.entries()) {
      if (now - bucket.lastRefill > inactiveThreshold) {
        this.chatBuckets.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.info('[RATE_LIMITER][CLEANUP]', {
        cleaned,
        remaining: this.chatBuckets.size
      });
    }
  }
}

// Instância singleton global
let globalRateLimiter = null;

/**
 * Obter instância global do rate limiter
 */
function getRateLimiter(options = {}) {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(options);
    
    // Cleanup automático a cada 5 minutos
    setInterval(() => {
      globalRateLimiter.cleanupInactiveBuckets();
    }, 5 * 60 * 1000);
  }
  return globalRateLimiter;
}

module.exports = {
  RateLimiter,
  getRateLimiter
};
