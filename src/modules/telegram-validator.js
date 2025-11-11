/**
 * Validador de Token Telegram
 * 
 * Responsabilidades:
 * - Chamar Telegram getMe com token
 * - Mapear erros comuns (401, 429, rede)
 * - Aplicar rate limit (máx 1 tentativa por bot a cada 10s)
 * - Retornar username e nome do bot
 */

const axios = require('axios');

class TelegramValidator {
  constructor() {
    // Rate limit: { botId: timestamp }
    this.lastValidationAttempt = new Map();
    this.RATE_LIMIT_SECONDS = 10;
  }

  /**
   * Validar token via Telegram getMe
   * Retorna: { ok: true, username, name } ou { ok: false, code, message }
   */
  async validateToken(token) {
    const startTime = Date.now();

    try {
      if (!token || typeof token !== 'string') {
        return {
          ok: false,
          code: 'INVALID_INPUT',
          message: 'Token inválido ou vazio'
        };
      }

      // Chamar Telegram getMe
      const response = await axios.get(
        `https://api.telegram.org/bot${token}/getMe`,
        { timeout: 10000 } // 10s timeout
      );

      const took = Date.now() - startTime;

      if (response.data.ok && response.data.result) {
        const result = response.data.result;
        return {
          ok: true,
          username: result.username || null,
          name: result.first_name || result.name || 'Bot',
          took
        };
      }

      return {
        ok: false,
        code: 'TELEGRAM_ERROR',
        message: response.data.description || 'Erro desconhecido do Telegram',
        took
      };
    } catch (error) {
      const took = Date.now() - startTime;

      // Mapear erros comuns
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 401) {
          return {
            ok: false,
            code: 'INVALID_TOKEN',
            message: 'Token inválido ou expirado',
            took
          };
        }

        if (status === 429) {
          // Rate limit do Telegram
          const retryAfter = error.response.headers['retry-after'] || '15';
          return {
            ok: false,
            code: 'RATE_LIMIT',
            message: `Aguarde ${retryAfter}s para tentar novamente`,
            retryAfter: parseInt(retryAfter, 10),
            took
          };
        }

        return {
          ok: false,
          code: 'TELEGRAM_ERROR',
          message: data.description || `Erro HTTP ${status}`,
          took
        };
      }

      // Erros de rede/timeout
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          message: 'Falha de rede. Tente novamente.',
          took
        };
      }

      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: error.message || 'Erro de rede desconhecido',
        took
      };
    }
  }

  /**
   * Verificar rate limit de validação
   * Retorna: { allowed: true } ou { allowed: false, waitSeconds }
   */
  checkRateLimit(botId) {
    const now = Date.now();
    const lastAttempt = this.lastValidationAttempt.get(botId);

    if (!lastAttempt) {
      this.lastValidationAttempt.set(botId, now);
      return { allowed: true };
    }

    const elapsedSeconds = (now - lastAttempt) / 1000;

    if (elapsedSeconds < this.RATE_LIMIT_SECONDS) {
      const waitSeconds = Math.ceil(this.RATE_LIMIT_SECONDS - elapsedSeconds);
      return { allowed: false, waitSeconds };
    }

    this.lastValidationAttempt.set(botId, now);
    return { allowed: true };
  }

  /**
   * Limpar rate limit (para testes)
   */
  clearRateLimit(botId) {
    this.lastValidationAttempt.delete(botId);
  }
}

module.exports = TelegramValidator;
