/**
 * Bot Engine
 * 
 * Responsabilidades:
 * - Resolver bot pelo slug
 * - Normalizar updates do Telegram
 * - Enfileirar trabalho
 */

class BotEngine {
  constructor(pool) {
    this.pool = pool;
    this.botCache = new Map(); // Cache de bots em memória
  }

  /**
   * Buscar bot pelo slug
   * Usa cache em memória para performance
   * Retorna: { id, slug, name, active, provider, token_encrypted, token_status, bot_username, bot_name, ... }
   */
  async getBotBySlug(slug) {
    if (this.botCache.has(slug)) {
      return this.botCache.get(slug);
    }

    try {
      const result = await this.pool.query(
        `SELECT id, slug, name, active, provider, token_encrypted, token_status, bot_username, bot_name, gateway_default, created_at, updated_at 
         FROM bots WHERE slug = $1 LIMIT 1`,
        [slug]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const bot = result.rows[0];
      this.botCache.set(slug, bot);
      return bot;
    } catch (error) {
      console.error('[ERRO][BOT_ENGINE] Falha ao buscar bot', { slug, error });
      return null;
    }
  }

  /**
   * Normalizar update do Telegram
   * Converte update bruto em evento estruturado
   * 
   * Retorna:
   * {
   *   type: 'message' | 'callback_query' | 'unknown',
   *   telegramId: number,
   *   chatId: number,
   *   text?: string,
   *   command?: string,  // '/start', '/help', etc.
   *   data?: string,     // callback_query data
   *   messageId?: number,
   *   timestamp: number
   * }
   */
  normalizeUpdate(update) {
    if (!update) {
      return null;
    }

    const timestamp = Date.now();

    // Processar message
    if (update.message) {
      const msg = update.message;
      const telegramId = msg.from?.id;
      const chatId = msg.chat?.id;
      const text = msg.text || '';

      if (!telegramId || !chatId) {
        return null;
      }

      // Extrair comando se houver
      let command = null;
      if (text.startsWith('/')) {
        command = text.split(/\s+/)[0]; // '/start', '/help', etc.
      }

      return {
        type: 'message',
        telegramId,
        chatId,
        text,
        command,
        messageId: msg.message_id,
        timestamp
      };
    }

    // Processar callback_query
    if (update.callback_query) {
      const cbq = update.callback_query;
      const telegramId = cbq.from?.id;
      const chatId = cbq.message?.chat?.id;
      const data = cbq.data || '';

      if (!telegramId || !chatId) {
        return null;
      }

      return {
        type: 'callback_query',
        telegramId,
        chatId,
        data,
        messageId: cbq.message?.message_id,
        timestamp
      };
    }

    // Tipo desconhecido
    return {
      type: 'unknown',
      timestamp
    };
  }

  /**
   * Enfileirar processamento de evento
   */
  async enqueueEvent(botId, event) {
    // TODO: Implementar enfileiramento
    // - Inserir em fila (downsells_queue, shots_queue, etc.)
    // - Respeitar prioridade (/start > downsells > shots)
  }
}

module.exports = BotEngine;
