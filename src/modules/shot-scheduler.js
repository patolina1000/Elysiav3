/**
 * Shot Scheduler
 * 
 * Responsabilidades:
 * - Criar jobs de shots imediatos ao salvar (via broadcast waves)
 * - Agendar shots com schedule_type='scheduled'
 * - Validar elegibilidade de usuários (ativo, não bloqueado, gatilho)
 * - Deduplicação de envios
 * 
 * Fluxo (ATUALIZADO para usar broadcast waves):
 * 1. Carregar shot e suas configurações
 * 2. Usar BroadcastService para agendar em ondas
 * 3. BroadcastService cuida de seleção, filtros e deduplicação
 */

const BroadcastService = require('./broadcast-service');

class ShotScheduler {
  constructor(pool) {
    this.pool = pool;
    this.broadcastService = new BroadcastService(pool);
  }

  /**
   * Criar jobs para shot imediato (usando broadcast waves)
   * Chamado ao salvar um shot com schedule_type='immediate' e active=true
   * 
   * @param {number} shotId - ID do shot
   * @param {number} botId - ID do bot
   * @returns {Promise<{queued: number, skipped: number, waves: number}>}
   */
  async createImmediateJobs(shotId, botId) {
    try {
      console.log('[SHOT][BROADCAST][IMMEDIATE] Iniciando broadcast em ondas', { shotId, botId });

      // 1. Carregar shot e bot (incluir content para passar no contexto)
      const shotResult = await this.pool.query(
        `SELECT s.id, s.slug, s.content, s.trigger_type, s.filter_criteria, s.active, b.slug as bot_slug
         FROM shots s
         JOIN bots b ON s.bot_id = b.id
         WHERE s.id = $1 AND s.bot_id = $2`,
        [shotId, botId]
      );

      if (shotResult.rows.length === 0) {
        console.warn('[SHOT][BROADCAST][IMMEDIATE][SKIP] Shot não encontrado', { shotId, botId });
        return { queued: 0, skipped: 0, waves: 0 };
      }

      const shot = shotResult.rows[0];

      if (!shot.active) {
        console.info('[SHOT][BROADCAST][IMMEDIATE][SKIP] Shot inativo', { shotId, botId });
        return { queued: 0, skipped: 0, waves: 0 };
      }

      // 2. Usar BroadcastService para agendar em ondas
      // IMPORTANTE: Passar a configuração completa no contexto para evitar race condition
      // (shot pode ser deletado antes do broadcast processar)
      const result = await this.broadcastService.scheduleBroadcastInWaves({
        botSlug: shot.bot_slug,
        botId,
        kind: 'shot',
        context: { 
          shotId,
          shotConfig: shot  // Passar configuração completa
        }
      });

      console.log('[SHOT][BROADCAST][IMMEDIATE][SUMMARY]', {
        shotId,
        botId,
        totalTargets: result.totalTargets,
        waves: result.waves,
        queued: result.queued
      });

      return { 
        queued: result.queued, 
        skipped: 0, 
        waves: result.waves,
        totalTargets: result.totalTargets
      };
    } catch (error) {
      console.error('[ERRO][SHOT][BROADCAST][IMMEDIATE]', {
        shotId,
        botId,
        error: error.message,
        stack: error.stack
      });
      return { queued: 0, skipped: 0, waves: 0, error: error.message };
    }
  }

  /**
   * Selecionar usuários elegíveis para receber o shot
   * 
   * @param {number} botId - ID do bot
   * @param {string} triggerType - Tipo de gatilho ('start' ou 'pix_created')
   * @param {object} filterCriteria - Critérios de filtro (JSONB)
   * @returns {Promise<Array<{telegram_id: number, bot_user_id: number}>>}
   */
  async selectTargets(botId, triggerType, filterCriteria) {
    try {
      let query = `
        SELECT telegram_id, id as bot_user_id
        FROM bot_users
        WHERE bot_id = $1
          AND blocked = FALSE
      `;
      const params = [botId];

      // Aplicar filtro baseado no trigger_type
      if (triggerType === 'pix_created' || triggerType === 'pix') {
        // Apenas usuários que geraram PIX e ainda não pagaram
        query += `
          AND id IN (
            SELECT DISTINCT bot_user_id 
            FROM payments 
            WHERE bot_user_id = bot_users.id 
              AND status IN ('pending', 'created')
          )
          AND id NOT IN (
            SELECT DISTINCT bot_user_id 
            FROM payments 
            WHERE bot_user_id = bot_users.id 
              AND status = 'paid'
          )
        `;
      } else {
        // trigger_type = 'start': todos os usuários ativos que já fizeram /start
        // Assumindo que se o usuário está em bot_users, já fez /start
        // Nenhum filtro adicional necessário além de blocked=FALSE
      }

      // Aplicar filtros customizados (se houver)
      // TODO: Implementar parser de filter_criteria se necessário
      // Exemplo: { "segment": "premium" } -> WHERE segment = 'premium'

      const result = await this.pool.query(query, params);

      return result.rows;
    } catch (error) {
      console.error('[ERRO][SHOT][SELECT_TARGETS]', {
        botId,
        triggerType,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Processar shots agendados que chegaram no horário
   * Chamado pelo scheduler periodicamente (ex: a cada minuto)
   * 
   * @returns {Promise<{processed: number}>}
   */
  async processScheduledShots() {
    try {
      console.log('[SHOT][SCHEDULER] Verificando shots agendados...');

      // 1. Buscar shots agendados que chegaram no horário e ainda não foram processados
      const shotsResult = await this.pool.query(
        `SELECT s.id, s.bot_id, s.slug, s.content, s.trigger_type, s.filter_criteria, s.scheduled_at, b.slug as bot_slug
         FROM shots s
         JOIN bots b ON s.bot_id = b.id
         WHERE s.active = TRUE
           AND s.schedule_type = 'scheduled'
           AND s.scheduled_at <= NOW()
           AND s.id NOT IN (
             SELECT DISTINCT shot_id 
             FROM shots_queue 
             WHERE shot_id IS NOT NULL
           )
         ORDER BY s.scheduled_at ASC
         LIMIT 10`
      );

      if (shotsResult.rows.length === 0) {
        console.log('[SHOT][SCHEDULER] Nenhum shot agendado para processar');
        return { processed: 0 };
      }

      let processedCount = 0;

      // 2. Para cada shot, criar jobs e depois deletar
      for (const shot of shotsResult.rows) {
        console.log('[SHOT][SCHEDULER][PROCESS]', {
          shotId: shot.id,
          botId: shot.bot_id,
          slug: shot.slug,
          scheduledAt: shot.scheduled_at
        });

        const result = await this.createImmediateJobs(shot.id, shot.bot_id);

        if (result.queued > 0) {
          processedCount++;
          // NOTA: Shot agendado será deletado pelo broadcast após envio completo
          // Config foi passada no contexto do broadcast para evitar race condition
        }

        console.log('[SHOT][SCHEDULER][PROCESSED]', {
          shotId: shot.id,
          queued: result.queued,
          skipped: result.skipped
        });
      }

      console.log('[SHOT][SCHEDULER][SUMMARY]', {
        totalShots: shotsResult.rows.length,
        processed: processedCount
      });

      return { processed: processedCount };
    } catch (error) {
      console.error('[ERRO][SHOT][SCHEDULER]', {
        error: error.message,
        stack: error.stack
      });
      return { processed: 0, error: error.message };
    }
  }
}

module.exports = ShotScheduler;
