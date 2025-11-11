/**
 * Scheduler de Filas
 * 
 * Loop simples em memória que processa:
 * - downsells_queue
 * - shots_queue
 * 
 * Respeita prioridade: /start > downsells > shots
 */

const { getCryptoService } = require('./modules/crypto-singleton');

class QueueScheduler {
  constructor(pool, messageService) {
    this.pool = pool;
    this.messageService = messageService;
    this.isRunning = false;
  }

  /**
   * Iniciar scheduler
   */
  start(intervalMs = 5000) {
    if (this.isRunning) {
      console.warn('[SCHEDULER] Já está em execução');
      return;
    }

    this.isRunning = true;
    console.log(`[SCHEDULER] Iniciado com intervalo de ${intervalMs}ms`);

    this.interval = setInterval(() => {
      this.processQueues().catch(err => {
        console.error('[ERRO][SCHEDULER]', err.message);
      });
    }, intervalMs);
  }

  /**
   * Parar scheduler
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    clearInterval(this.interval);
    console.log('[SCHEDULER] Parado');
  }

  /**
   * Processar filas
   * Prioridade: /start > downsells > shots
   * 
   * Fluxo:
   * 1. Processar downsells_queue (prioridade alta)
   * 2. Processar shots_queue (prioridade baixa)
   * 3. Respeitar delays (ex: downsell após X minutos do /start)
   * 4. Enviar mensagens via MessageService
   * 5. Atualizar status em fila
   */
  async processQueues() {
    try {
      // Processar downsells primeiro (prioridade alta)
      await this.processDownsellsQueue();

      // Depois processar shots (prioridade baixa)
      await this.processShotsQueue();
    } catch (error) {
      console.error('[ERRO][SCHEDULER] Falha ao processar filas:', error.message);
    }
  }

  /**
   * Processar fila de downsells
   * Downsells são enviados após X minutos do /start ou após PIX não pago
   */
  async processDownsellsQueue() {
    try {
      // Buscar downsells pendentes que estão prontos para envio
      const result = await this.pool.query(
        `SELECT dq.id,
                COALESCE(dq.bot_id, bd.bot_id) AS bot_id,
                dq.downsell_id,
                dq.schedule_at,
                dq.scheduled_at,
                dq.telegram_id,
                dq.tg_id,
                b.token_encrypted,
                b.name
         FROM downsells_queue dq
         JOIN bot_downsells bd ON dq.downsell_id = bd.id
         JOIN bots b ON b.id = COALESCE(dq.bot_id, bd.bot_id)
         WHERE dq.status = 'pending'
         ORDER BY COALESCE(dq.schedule_at, dq.scheduled_at, dq.created_at, dq.updated_at)
         LIMIT 10`
      );

      if (result.rows.length === 0) {
        return;
      }

      const MessageService = require('./modules/message-service');
      const messageService = new MessageService(this.pool);

      for (const item of result.rows) {
        try {
          const scheduledAt = item.schedule_at || item.scheduled_at;
          if (scheduledAt) {
            const scheduleTime = new Date(scheduledAt);
            if (!Number.isNaN(scheduleTime.getTime()) && scheduleTime > new Date()) {
              // Ainda não é hora de enviar
              continue;
            }
          }

          const telegramId = item.telegram_id || item.tg_id;
          if (!telegramId) {
            console.warn(`[SCHEDULER][DOWNSELL] item=${item.id} sem telegram_id`);
            await this.pool.query(
              'UPDATE downsells_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
              ['error', 'telegram_id ausente', item.id]
            );
            continue;
          }

          // Enviar mensagem de downsell
          const context = {
            userName: 'Usuário',
            botName: item.name || 'Bot',
            userId: telegramId
          };

          // Descriptografar token
          const crypto = getCryptoService();
          const botToken = item.token_encrypted ? crypto.decrypt(item.token_encrypted) : null;

          const sendResult = await messageService.sendMessage(
            item.bot_id,
            telegramId,
            'downsell',
            context,
            botToken
          );

          if (sendResult.success) {
            console.log(`[SCHEDULER][DOWNSELL] Enviado para user=${item.telegram_id} downsell=${item.downsell_id} latency=${sendResult.duration}ms`);

            // Marcar como enviado
            await this.pool.query(
              'UPDATE downsells_queue SET status = $1, updated_at = NOW() WHERE id = $2',
              ['sent', item.id]
            );
          } else {
            throw new Error(sendResult.error);
          }
        } catch (error) {
          console.error(`[ERRO][SCHEDULER][DOWNSELL] item=${item.id} error=${error.message}`);
          // Marcar como erro mas não falhar todo o processamento
          await this.pool.query(
            'UPDATE downsells_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['error', error.message, item.id]
          );
        }
      }
    } catch (error) {
      console.error('[ERRO][SCHEDULER][DOWNSELLS_QUEUE]', error.message);
    }
  }

  /**
   * Processar fila de shots (disparos em massa)
   * Shots são mensagens enviadas para múltiplos usuários
   */
  async processShotsQueue() {
    try {
      // Buscar shots pendentes que estão prontos para envio
      const result = await this.pool.query(
        `SELECT sq.id,
                s.bot_id,
                sq.shot_id,
                sq.created_at,
                sq.telegram_id,
                sq.tg_id,
                b.token_encrypted,
                b.name
         FROM shots_queue sq
         JOIN shots s ON sq.shot_id = s.id
         JOIN bots b ON b.id = s.bot_id
         WHERE sq.status = 'pending'
         ORDER BY sq.created_at ASC
         LIMIT 10`
      );

      if (result.rows.length === 0) {
        return;
      }

      const MessageService = require('./modules/message-service');
      const messageService = new MessageService(this.pool);

      for (const item of result.rows) {
        try {
          // Buscar usuários que devem receber este shot
          const usersResult = await this.pool.query(
            `SELECT bu.id, bu.telegram_id FROM bot_users bu
             WHERE bu.bot_id = $1
             LIMIT 100`,
            [item.bot_id]
          );

          const telegramId = item.telegram_id || item.tg_id;
          if (!telegramId) {
            console.warn(`[SCHEDULER][SHOT] item=${item.id} sem telegram_id`);
            await this.pool.query(
              'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
              ['error', 'telegram_id ausente', item.id]
            );
            continue;
          }

          const context = {
            userName: 'Usuário',
            botName: item.name || 'Bot',
            userId: telegramId
          };

          // Descriptografar token
          const crypto = getCryptoService();
          const botToken = item.token_encrypted ? crypto.decrypt(item.token_encrypted) : null;

          const sendResult = await messageService.sendMessage(
            item.bot_id,
            telegramId,
            'shot',
            context,
            botToken
          );

          if (sendResult.success) {
            console.log(`[SCHEDULER][SHOT] Enviado shot=${item.shot_id} user=${telegramId} latency=${sendResult.duration}ms`);
          } else {
            throw new Error(sendResult.error);
          }

          // Marcar como enviado
          await this.pool.query(
            'UPDATE shots_queue SET status = $1, updated_at = NOW() WHERE id = $2',
            ['sent', item.id]
          );
        } catch (error) {
          console.error(`[ERRO][SCHEDULER][SHOT] item=${item.id} error=${error.message}`);
          await this.pool.query(
            'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['error', error.message, item.id]
          );
        }
      }
    } catch (error) {
      console.error('[ERRO][SCHEDULER][SHOTS_QUEUE]', error.message);
    }
  }
}

module.exports = QueueScheduler;
