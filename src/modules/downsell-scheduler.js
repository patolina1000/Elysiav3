/**
 * Downsell Scheduler
 * 
 * Responsabilidades:
 * - Agendar downsells após /start ou após gerar PIX (individual)
 * - Broadcast imediato de downsells (em ondas)
 * - Validar se usuário está ativo (não bloqueado)
 * - Validar se usuário ainda não pagou (para trigger 'pix')
 * - Deduplicação de agendamentos
 * 
 * Fluxo:
 * 1. Carregar downsells ativos para o bot e trigger_type
 * 2. Para cada downsell, validar elegibilidade do usuário
 * 3. Verificar deduplicação (não agendar duplicado)
 * 4. Inserir job na downsells_queue com delay (individual)
 *    OU usar BroadcastService para envio em massa (ondas)
 */

const BroadcastService = require('./broadcast-service');

class DownsellScheduler {
  constructor(pool) {
    this.pool = pool;
    this.broadcastService = new BroadcastService(pool);
  }

  /**
   * Agendar downsells após /start
   * Chamado no webhook do Telegram quando usuário envia /start
   * 
   * @param {number} botId - ID do bot
   * @param {number} telegramId - ID do usuário no Telegram
   * @param {number} botUserId - ID do bot_user
   */
  async scheduleAfterStart(botId, telegramId, botUserId) {
    try {
      // 1. Carregar downsells ativos com trigger_type='start'
      const downsellsResult = await this.pool.query(
        `SELECT id, slug, delay_seconds 
         FROM bot_downsells 
         WHERE bot_id = $1 
           AND active = TRUE 
           AND trigger_type = 'start'
         ORDER BY delay_seconds ASC`,
        [botId]
      );

      if (downsellsResult.rows.length === 0) {
        console.info('[DOWNSELL][SCHEDULE][START] Nenhum downsell ativo para bot', { botId });
        return { scheduled: 0 };
      }

      // 2. Verificar se usuário está ativo (não bloqueado)
      const userResult = await this.pool.query(
        'SELECT blocked FROM bot_users WHERE id = $1',
        [botUserId]
      );

      if (userResult.rows.length === 0 || userResult.rows[0].blocked) {
        console.info('[DOWNSELL][SCHEDULE][START][SKIP][BLOCKED]', { 
          botId, 
          telegramId, 
          botUserId,
          reason: userResult.rows.length === 0 ? 'user_not_found' : 'user_blocked'
        });
        return { scheduled: 0, skipped: downsellsResult.rows.length, reason: 'blocked' };
      }

      let scheduledCount = 0;

      // 3. Para cada downsell, agendar se não existir duplicata
      for (const downsell of downsellsResult.rows) {
        try {
          // Calcular horário de disparo
          const scheduleAt = new Date(Date.now() + (downsell.delay_seconds * 1000));

          // Verificar se já existe agendamento PENDENTE para este downsell + usuário
          // (não bloquear se já foi enviado anteriormente - permite reenvio em novo /start)
          const existingResult = await this.pool.query(
            `SELECT id FROM downsells_queue 
             WHERE bot_id = $1 
               AND downsell_id = $2 
               AND telegram_id = $3 
               AND status = 'pending'
             LIMIT 1`,
            [botId, downsell.id, telegramId]
          );

          if (existingResult.rows.length > 0) {
            console.info('[DOWNSELL][SCHEDULE][START][SKIP][DUPLICATE]', {
              botId,
              telegramId,
              downsellId: downsell.id,
              downsellSlug: downsell.slug,
              reason: 'already_pending'
            });
            continue;
          }

          // Buscar bot_slug
          const botSlugResult = await this.pool.query('SELECT slug FROM bots WHERE id = $1', [botId]);
          const botSlug = botSlugResult.rows[0]?.slug || 'unknown';

          // Inserir na fila
          await this.pool.query(
            `INSERT INTO downsells_queue (
              bot_id, bot_slug, downsell_id, slug, telegram_id, tg_id, 
              schedule_at, scheduled_at, trigger, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), NOW())`,
            [botId, botSlug, downsell.id, downsell.slug, telegramId, telegramId, scheduleAt, scheduleAt, 'start']
          );

          scheduledCount++;

          console.info('[DOWNSELL][SCHEDULE][START][OK]', {
            botId,
            telegramId,
            downsellId: downsell.id,
            downsellSlug: downsell.slug,
            delaySeconds: downsell.delay_seconds,
            scheduleAt: scheduleAt.toISOString()
          });
        } catch (error) {
          console.error('[ERRO][DOWNSELL][SCHEDULE][START]', {
            botId,
            telegramId,
            downsellId: downsell.id,
            error: error.message
          });
        }
      }

      return { scheduled: scheduledCount, total: downsellsResult.rows.length };
    } catch (error) {
      console.error('[ERRO][DOWNSELL][SCHEDULE][START]', {
        botId,
        telegramId,
        error: error.message
      });
      return { scheduled: 0, error: error.message };
    }
  }

  /**
   * Agendar downsells após gerar PIX
   * Chamado no PaymentGateway quando PIX é criado
   * 
   * @param {number} botId - ID do bot
   * @param {number} telegramId - ID do usuário no Telegram
   * @param {number} botUserId - ID do bot_user
   * @param {number} paymentId - ID do pagamento criado
   */
  async scheduleAfterPixCreated(botId, telegramId, botUserId, paymentId) {
    try {
      // 1. Carregar downsells ativos com trigger_type='pix'
      const downsellsResult = await this.pool.query(
        `SELECT id, slug, delay_seconds 
         FROM bot_downsells 
         WHERE bot_id = $1 
           AND active = TRUE 
           AND trigger_type = 'pix'
         ORDER BY delay_seconds ASC`,
        [botId]
      );

      if (downsellsResult.rows.length === 0) {
        console.info('[DOWNSELL][SCHEDULE][PIX] Nenhum downsell ativo para bot', { botId });
        return { scheduled: 0 };
      }

      // 2. Verificar se usuário está ativo (não bloqueado)
      const userResult = await this.pool.query(
        'SELECT blocked FROM bot_users WHERE id = $1',
        [botUserId]
      );

      if (userResult.rows.length === 0 || userResult.rows[0].blocked) {
        console.info('[DOWNSELL][SCHEDULE][PIX][SKIP][BLOCKED]', { 
          botId, 
          telegramId, 
          botUserId,
          paymentId,
          reason: userResult.rows.length === 0 ? 'user_not_found' : 'user_blocked'
        });
        return { scheduled: 0, skipped: downsellsResult.rows.length, reason: 'blocked' };
      }

      // 3. Verificar se usuário já pagou
      const paidResult = await this.pool.query(
        `SELECT id FROM payments 
         WHERE bot_user_id = $1 
           AND status = 'paid' 
         LIMIT 1`,
        [botUserId]
      );

      if (paidResult.rows.length > 0) {
        console.info('[DOWNSELL][SCHEDULE][PIX][SKIP][ALREADY_PAID]', {
          botId,
          telegramId,
          botUserId,
          paymentId
        });
        return { scheduled: 0, skipped: downsellsResult.rows.length, reason: 'already_paid' };
      }

      let scheduledCount = 0;

      // 4. Para cada downsell, agendar se não existir duplicata
      for (const downsell of downsellsResult.rows) {
        try {
          // Calcular horário de disparo
          const scheduleAt = new Date(Date.now() + (downsell.delay_seconds * 1000));

          // Verificar se já existe agendamento PENDENTE para este downsell + usuário + pagamento
          // (não bloquear se já foi enviado anteriormente - permite reenvio em novo PIX)
          const existingResult = await this.pool.query(
            `SELECT id FROM downsells_queue 
             WHERE bot_id = $1 
               AND downsell_id = $2 
               AND telegram_id = $3 
               AND status = 'pending'
             LIMIT 1`,
            [botId, downsell.id, telegramId]
          );

          if (existingResult.rows.length > 0) {
            console.info('[DOWNSELL][SCHEDULE][PIX][SKIP][DUPLICATE]', {
              botId,
              telegramId,
              downsellId: downsell.id,
              downsellSlug: downsell.slug,
              paymentId,
              reason: 'already_pending'
            });
            continue;
          }

          // Buscar bot_slug
          const botSlugResult = await this.pool.query('SELECT slug FROM bots WHERE id = $1', [botId]);
          const botSlug = botSlugResult.rows[0]?.slug || 'unknown';

          // Inserir na fila
          await this.pool.query(
            `INSERT INTO downsells_queue (
              bot_id, bot_slug, downsell_id, slug, telegram_id, tg_id, 
              schedule_at, scheduled_at, trigger, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), NOW())`,
            [botId, botSlug, downsell.id, downsell.slug, telegramId, telegramId, scheduleAt, scheduleAt, 'pix']
          );

          scheduledCount++;

          console.info('[DOWNSELL][SCHEDULE][PIX][OK]', {
            botId,
            telegramId,
            downsellId: downsell.id,
            downsellSlug: downsell.slug,
            delaySeconds: downsell.delay_seconds,
            scheduleAt: scheduleAt.toISOString(),
            paymentId
          });
        } catch (error) {
          console.error('[ERRO][DOWNSELL][SCHEDULE][PIX]', {
            botId,
            telegramId,
            downsellId: downsell.id,
            paymentId,
            error: error.message
          });
        }
      }

      return { scheduled: scheduledCount, total: downsellsResult.rows.length };
    } catch (error) {
      console.error('[ERRO][DOWNSELL][SCHEDULE][PIX]', {
        botId,
        telegramId,
        paymentId,
        error: error.message
      });
      return { scheduled: 0, error: error.message };
    }
  }

  /**
   * Broadcast imediato de downsell para todos os usuários elegíveis
   * Usa sistema de ondas para evitar flood
   * 
   * @param {number} botId - ID do bot
   * @param {number} downsellId - ID do downsell
   * @returns {Promise<{totalTargets: number, waves: number, queued: number}>}
   */
  async broadcastImmediate(botId, downsellId) {
    try {
      console.log('[DOWNSELL][BROADCAST][IMMEDIATE] Iniciando broadcast em ondas', { botId, downsellId });

      // 1. Carregar downsell e bot
      const downsellResult = await this.pool.query(
        `SELECT d.id, d.slug, d.trigger_type, d.active, b.slug as bot_slug
         FROM bot_downsells d
         JOIN bots b ON d.bot_id = b.id
         WHERE d.id = $1 AND d.bot_id = $2`,
        [downsellId, botId]
      );

      if (downsellResult.rows.length === 0) {
        console.warn('[DOWNSELL][BROADCAST][IMMEDIATE][SKIP] Downsell não encontrado', { botId, downsellId });
        return { totalTargets: 0, waves: 0, queued: 0 };
      }

      const downsell = downsellResult.rows[0];

      if (!downsell.active) {
        console.info('[DOWNSELL][BROADCAST][IMMEDIATE][SKIP] Downsell inativo', { botId, downsellId });
        return { totalTargets: 0, waves: 0, queued: 0 };
      }

      // 2. Usar BroadcastService para agendar em ondas
      const result = await this.broadcastService.scheduleBroadcastInWaves({
        botSlug: downsell.bot_slug,
        botId,
        kind: 'downsell',
        context: { downsellId }
      });

      console.log('[DOWNSELL][BROADCAST][IMMEDIATE][SUMMARY]', {
        botId,
        downsellId,
        totalTargets: result.totalTargets,
        waves: result.waves,
        queued: result.queued
      });

      return result;
    } catch (error) {
      console.error('[ERRO][DOWNSELL][BROADCAST][IMMEDIATE]', {
        botId,
        downsellId,
        error: error.message,
        stack: error.stack
      });
      return { totalTargets: 0, waves: 0, queued: 0, error: error.message };
    }
  }
}

module.exports = DownsellScheduler;
