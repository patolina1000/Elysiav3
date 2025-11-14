/**
 * Broadcast Service
 * 
 * Motor genérico de broadcast em ondas para Downsells e Shots
 * 
 * Responsabilidades:
 * - Selecionar usuários elegíveis (ativos, não bloqueados, filtros)
 * - Dividir em ondas (batches) respeitando rate limits
 * - Agendar jobs de broadcast_wave na fila
 * 
 * Configuração de ondas:
 * - GLOBAL_SAFE_RATE: 20 msg/s (configurável)
 * - WAVE_DURATION_MS: 1000ms (1 segundo entre ondas)
 * - WAVE_SIZE: GLOBAL_SAFE_RATE (20 mensagens por onda)
 */

class BroadcastService {
  constructor(pool) {
    this.pool = pool;
    
    // Configurações de throttling
    this.GLOBAL_SAFE_RATE = process.env.BROADCAST_GLOBAL_RATE || 20; // msg/s
    this.WAVE_DURATION_MS = process.env.BROADCAST_WAVE_DURATION || 1000; // ms
    this.WAVE_SIZE = this.GLOBAL_SAFE_RATE;
  }

  /**
   * Agendar broadcast em ondas
   * 
   * @param {Object} options
   * @param {string} options.botSlug - Slug do bot
   * @param {number} options.botId - ID do bot
   * @param {string} options.kind - 'downsell' | 'shot'
   * @param {Object} options.context - { downsellId, shotId, etc. }
   * @param {Array} options.targets - Lista de chats (opcional, se não vier será calculada)
   * @returns {Promise<{totalTargets: number, waves: number, queued: number}>}
   */
  async scheduleBroadcastInWaves(options) {
    const { botSlug, botId, kind, context } = options;
    let { targets } = options;

    try {
      console.log('[BROADCAST][SCHEDULE]', {
        bot: botSlug,
        kind,
        context,
        hasTargets: Boolean(targets)
      });

      // 1. Descobrir lista de chats alvo (se não fornecida)
      if (!targets || targets.length === 0) {
        targets = await this.selectTargets(botId, kind, context);
      }

      console.log('[BROADCAST][TARGETS]', {
        bot: botSlug,
        kind,
        totalTargets: targets.length
      });

      if (targets.length === 0) {
        return { totalTargets: 0, waves: 0, queued: 0 };
      }

      // 2. Dividir em ondas
      const numWaves = Math.ceil(targets.length / this.WAVE_SIZE);
      let queuedCount = 0;

      for (let waveIndex = 0; waveIndex < numWaves; waveIndex++) {
        const waveStart = waveIndex * this.WAVE_SIZE;
        const waveEnd = Math.min(waveStart + this.WAVE_SIZE, targets.length);
        const waveTargets = targets.slice(waveStart, waveEnd);
        const chatIds = waveTargets.map(t => t.telegram_id);

        // Calcular delay para esta onda
        const delayMs = waveIndex * this.WAVE_DURATION_MS;
        const scheduleAt = new Date(Date.now() + delayMs);

        // 3. Criar job de broadcast_wave
        const result = await this.pool.query(
          `INSERT INTO broadcast_waves_queue (
            bot_id, bot_slug, kind, context, chat_ids, 
            wave_index, total_waves, schedule_at, 
            status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())
          RETURNING id`,
          [
            botId,
            botSlug,
            kind,
            JSON.stringify(context),
            JSON.stringify(chatIds),
            waveIndex,
            numWaves,
            scheduleAt
          ]
        );

        queuedCount++;

        console.log('[BROADCAST][WAVE_SCHEDULED]', {
          bot: botSlug,
          kind,
          waveIndex,
          totalWaves: numWaves,
          waveSize: waveTargets.length,
          scheduleAt: scheduleAt.toISOString(),
          queueId: result.rows[0].id
        });
      }

      console.log('[BROADCAST][SCHEDULE][COMPLETE]', {
        bot: botSlug,
        kind,
        totalTargets: targets.length,
        waveSize: this.WAVE_SIZE,
        numWaves,
        queued: queuedCount
      });

      return {
        totalTargets: targets.length,
        waves: numWaves,
        queued: queuedCount
      };
    } catch (error) {
      console.error('[ERRO][BROADCAST][SCHEDULE]', {
        bot: botSlug,
        kind,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Selecionar usuários elegíveis para broadcast
   * Aplica regras específicas de cada tipo (downsell, shot)
   */
  async selectTargets(botId, kind, context) {
    try {
      // 1. Começar com usuários ativos
      const activeChats = await this.getActiveChatsForBot(botId);

      if (activeChats.length === 0) {
        return [];
      }

      // 2. Aplicar filtros específicos
      let filtered = activeChats;

      if (kind === 'downsell') {
        filtered = await this.filterForDownsell(botId, context, activeChats);
      } else if (kind === 'shot') {
        filtered = await this.filterForShot(botId, context, activeChats);
      }

      console.log('[BROADCAST][SELECT_TARGETS]', {
        botId,
        kind,
        activeChats: activeChats.length,
        afterFilters: filtered.length
      });

      return filtered;
    } catch (error) {
      console.error('[ERRO][BROADCAST][SELECT_TARGETS]', {
        botId,
        kind,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Obter chats ativos para o bot
   * Usa mesma regra do dashboard (blocked = false)
   */
  async getActiveChatsForBot(botId) {
    try {
      const result = await this.pool.query(
        `SELECT telegram_id, id as bot_user_id, has_paid
         FROM bot_users
         WHERE bot_id = $1 AND blocked = FALSE`,
        [botId]
      );

      return result.rows;
    } catch (error) {
      console.error('[ERRO][BROADCAST][GET_ACTIVE_CHATS]', {
        botId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Filtrar usuários para downsell
   * Aplica regras de trigger_type e deduplicação
   */
  async filterForDownsell(botId, context, activeChats) {
    const { downsellId } = context;

    try {
      // Carregar downsell
      const downsellResult = await this.pool.query(
        'SELECT trigger_type FROM bot_downsells WHERE id = $1 AND bot_id = $2',
        [downsellId, botId]
      );

      if (downsellResult.rows.length === 0) {
        return [];
      }

      const triggerType = downsellResult.rows[0].trigger_type;
      let filtered = activeChats;

      // Filtro por trigger_type
      if (triggerType === 'pix') {
        // Apenas usuários que geraram PIX e ainda não pagaram
        const pixUsers = await this.pool.query(
          `SELECT DISTINCT bu.telegram_id
           FROM bot_users bu
           WHERE bu.bot_id = $1
             AND bu.blocked = FALSE
             AND EXISTS (
               SELECT 1 FROM payments p 
               WHERE p.bot_user_id = bu.id 
                 AND p.status IN ('pending', 'created')
             )
             AND NOT EXISTS (
               SELECT 1 FROM payments p 
               WHERE p.bot_user_id = bu.id 
                 AND p.status = 'paid'
             )`,
          [botId]
        );

        const pixTelegramIds = new Set(pixUsers.rows.map(r => r.telegram_id));
        filtered = filtered.filter(chat => pixTelegramIds.has(chat.telegram_id));
      }

      // Remover quem já recebeu este downsell (deduplicação)
      // Verificar se já existe na fila com status 'sent'
      const alreadySentResult = await this.pool.query(
        `SELECT DISTINCT telegram_id 
         FROM downsells_queue 
         WHERE bot_id = $1 
           AND downsell_id = $2 
           AND status = 'sent'`,
        [botId, downsellId]
      );

      const alreadySentIds = new Set(alreadySentResult.rows.map(r => r.telegram_id));
      filtered = filtered.filter(chat => !alreadySentIds.has(chat.telegram_id));

      return filtered;
    } catch (error) {
      console.error('[ERRO][BROADCAST][FILTER_DOWNSELL]', {
        botId,
        downsellId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Filtrar usuários para shot
   * Aplica regras de trigger_type, filtros e deduplicação
   */
  async filterForShot(botId, context, activeChats) {
    const { shotId } = context;

    try {
      // Carregar shot
      const shotResult = await this.pool.query(
        'SELECT trigger_type, filter_criteria FROM shots WHERE id = $1 AND bot_id = $2',
        [shotId, botId]
      );

      if (shotResult.rows.length === 0) {
        return [];
      }

      const { trigger_type, filter_criteria } = shotResult.rows[0];
      let filtered = activeChats;

      // Filtro por trigger_type
      if (trigger_type === 'pix_created' || trigger_type === 'pix') {
        // Apenas usuários que geraram PIX e ainda não pagaram
        const pixUsers = await this.pool.query(
          `SELECT DISTINCT bu.telegram_id
           FROM bot_users bu
           WHERE bu.bot_id = $1
             AND bu.blocked = FALSE
             AND EXISTS (
               SELECT 1 FROM payments p 
               WHERE p.bot_user_id = bu.id 
                 AND p.status IN ('pending', 'created')
             )
             AND NOT EXISTS (
               SELECT 1 FROM payments p 
               WHERE p.bot_user_id = bu.id 
                 AND p.status = 'paid'
             )`,
          [botId]
        );

        const pixTelegramIds = new Set(pixUsers.rows.map(r => r.telegram_id));
        filtered = filtered.filter(chat => pixTelegramIds.has(chat.telegram_id));
      }

      // TODO: Aplicar filter_criteria se houver
      // Por enquanto, ignorar filtros customizados

      // Remover quem já recebeu este shot (deduplicação via funnel_events)
      const eventIdPrefix = `shot:${shotId}:`;
      const alreadySentResult = await this.pool.query(
        `SELECT DISTINCT telegram_id 
         FROM funnel_events 
         WHERE bot_id = $1 
           AND event_id LIKE $2`,
        [botId, `${eventIdPrefix}%`]
      );

      const alreadySentIds = new Set(alreadySentResult.rows.map(r => r.telegram_id));
      filtered = filtered.filter(chat => !alreadySentIds.has(chat.telegram_id));

      return filtered;
    } catch (error) {
      console.error('[ERRO][BROADCAST][FILTER_SHOT]', {
        botId,
        shotId,
        error: error.message
      });
      return [];
    }
  }
}

module.exports = BroadcastService;
