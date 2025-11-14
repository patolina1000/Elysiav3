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
   * Prioridade: broadcast_waves > downsells > shots
   * 
   * Fluxo:
   * 1. Processar broadcast_waves_queue (prioridade máxima - ondas agendadas)
   * 2. Processar downsells_queue (prioridade alta)
   * 3. Processar shots_queue (prioridade baixa)
   * 4. Enviar mensagens via MessageService
   * 5. Atualizar status em fila
   */
  async processQueues() {
    try {
      // Processar broadcast waves primeiro (prioridade máxima)
      await this.processBroadcastWavesQueue();

      // Processar downsells (prioridade alta)
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

          // Validar se usuário ainda está ativo (não bloqueado)
          const userCheck = await this.pool.query(
            'SELECT blocked FROM bot_users WHERE bot_id = $1 AND telegram_id = $2',
            [item.bot_id, telegramId]
          );

          if (userCheck.rows.length === 0 || userCheck.rows[0].blocked) {
            console.info('[SCHEDULER][DOWNSELL][SKIP][BLOCKED]', {
              queueId: item.id,
              botId: item.bot_id,
              telegramId,
              reason: userCheck.rows.length === 0 ? 'user_not_found' : 'user_blocked'
            });
            await this.pool.query(
              'UPDATE downsells_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
              ['canceled', 'user_blocked', item.id]
            );
            continue;
          }

          // Para downsells com trigger 'pix', validar se usuário ainda não pagou
          const downsellCheck = await this.pool.query(
            'SELECT trigger_type FROM bot_downsells WHERE id = $1',
            [item.downsell_id]
          );

          if (downsellCheck.rows.length > 0 && downsellCheck.rows[0].trigger_type === 'pix') {
            const botUserCheck = await this.pool.query(
              'SELECT id FROM bot_users WHERE bot_id = $1 AND telegram_id = $2',
              [item.bot_id, telegramId]
            );

            if (botUserCheck.rows.length > 0) {
              const paidCheck = await this.pool.query(
                'SELECT id FROM payments WHERE bot_user_id = $1 AND status = $2 LIMIT 1',
                [botUserCheck.rows[0].id, 'paid']
              );

              if (paidCheck.rows.length > 0) {
                console.info('[SCHEDULER][DOWNSELL][SKIP][ALREADY_PAID]', {
                  queueId: item.id,
                  botId: item.bot_id,
                  telegramId
                });
                await this.pool.query(
                  'UPDATE downsells_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
                  ['canceled', 'already_paid', item.id]
                );
                continue;
              }
            }
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
            console.info('[SCHEDULER][DOWNSELL][SENT]', JSON.stringify({
              queueId: item.id,
              botId: item.bot_id,
              telegramId: item.telegram_id,
              downsellId: item.downsell_id,
              latencyMs: sendResult.duration,
              payloadCount: sendResult.messageCount,
              mediaCount: sendResult.mediaCount,
              timestamp: new Date().toISOString()
            }));

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
                s.slug,
                sq.shot_id,
                s.trigger_type,
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
          const telegramId = item.telegram_id || item.tg_id;
          if (!telegramId) {
            console.warn(`[SCHEDULER][SHOT] item=${item.id} sem telegram_id`);
            await this.pool.query(
              'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
              ['error', 'telegram_id ausente', item.id]
            );
            continue;
          }

          // Validar se usuário ainda está ativo (não bloqueado)
          const userCheck = await this.pool.query(
            'SELECT id, blocked FROM bot_users WHERE bot_id = $1 AND telegram_id = $2',
            [item.bot_id, telegramId]
          );

          if (userCheck.rows.length === 0 || userCheck.rows[0].blocked) {
            console.info('[SCHEDULER][SHOT][SKIP][BLOCKED]', {
              queueId: item.id,
              shotId: item.shot_id,
              botId: item.bot_id,
              telegramId,
              reason: userCheck.rows.length === 0 ? 'user_not_found' : 'user_blocked'
            });
            await this.pool.query(
              'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
              ['canceled', 'user_blocked', item.id]
            );
            continue;
          }

          const botUserId = userCheck.rows[0].id;

          // Para shots com trigger 'pix', validar se usuário ainda não pagou
          if (item.trigger_type === 'pix_created' || item.trigger_type === 'pix') {
            const paidCheck = await this.pool.query(
              'SELECT id FROM payments WHERE bot_user_id = $1 AND status = $2 LIMIT 1',
              [botUserId, 'paid']
            );

            if (paidCheck.rows.length > 0) {
              console.info('[SCHEDULER][SHOT][SKIP][ALREADY_PAID]', {
                queueId: item.id,
                shotId: item.shot_id,
                botId: item.bot_id,
                telegramId
              });
              await this.pool.query(
                'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
                ['canceled', 'already_paid', item.id]
              );
              continue;
            }
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
            botToken,
            item.shot_id // Passar ID específico do shot
          );

          if (sendResult.success) {
            console.info('[SCHEDULER][SHOT][SENT]', JSON.stringify({
              queueId: item.id,
              shotId: item.shot_id,
              shotSlug: item.slug,
              botId: item.bot_id,
              telegramId,
              triggerType: item.trigger_type,
              latencyMs: sendResult.duration,
              payloadCount: sendResult.messageCount,
              mediaCount: sendResult.mediaCount,
              timestamp: new Date().toISOString()
            }));

            // Marcar como enviado
            await this.pool.query(
              'UPDATE shots_queue SET status = $1, updated_at = NOW() WHERE id = $2',
              ['sent', item.id]
            );

            // Registrar evento para deduplicação
            const eventId = `shot:${item.shot_id}:${telegramId}`;
            try {
              await this.pool.query(
                `INSERT INTO funnel_events (
                  event_id, bot_id, telegram_id, event_name, 
                  meta, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (event_id) DO NOTHING`,
                [
                  eventId,
                  item.bot_id,
                  telegramId,
                  'shot_sent',
                  JSON.stringify({ shot_id: item.shot_id, slug: item.slug })
                ]
              );
            } catch (eventError) {
              console.warn('[SCHEDULER][SHOT][EVENT_ERROR]', {
                shotId: item.shot_id,
                telegramId,
                error: eventError.message
              });
            }
          } else {
            throw new Error(sendResult.error);
          }
        } catch (error) {
          console.error(`[ERRO][SCHEDULER][SHOT] item=${item.id} error=${error.message}`);
          await this.pool.query(
            'UPDATE shots_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['error', error.message, item.id]
          );
        }
      }

      // Verificar se todos os jobs de shots foram processados e deletar shots completados
      await this.cleanupCompletedShots();
    } catch (error) {
      console.error('[ERRO][SCHEDULER][SHOTS_QUEUE]', error.message);
    }
  }

  /**
   * Limpar shots que foram completamente processados
   * Um shot é considerado completo quando:
   * 1. Todos os jobs na shots_queue têm status 'sent' ou 'canceled'
   * 2. Nenhum job está pendente ou em erro
   */
  async cleanupCompletedShots() {
    try {
      // Buscar shots que têm todos os jobs processados
      const completedShots = await this.pool.query(
        `SELECT DISTINCT s.id, s.slug, s.bot_id
         FROM shots s
         WHERE s.active = TRUE
           AND s.schedule_type = 'immediate'
           AND NOT EXISTS (
             SELECT 1 FROM shots_queue sq
             WHERE sq.shot_id = s.id
               AND sq.status NOT IN ('sent', 'canceled')
           )
           AND EXISTS (
             SELECT 1 FROM shots_queue sq
             WHERE sq.shot_id = s.id
           )`
      );

      for (const shot of completedShots.rows) {
        try {
          // Contar quantos usuários receberam este shot
          const sentCount = await this.pool.query(
            `SELECT COUNT(*) as count FROM shots_queue 
             WHERE shot_id = $1 AND status = 'sent'`,
            [shot.id]
          );

          const count = parseInt(sentCount.rows[0].count, 10);

          if (count > 0) {
            // Deletar o shot após todos receberem
            await this.pool.query(
              'DELETE FROM shots WHERE id = $1',
              [shot.id]
            );

            console.info('[SCHEDULER][SHOT][CLEANUP]', {
              shotId: shot.id,
              shotSlug: shot.slug,
              botId: shot.bot_id,
              usersSent: count,
              action: 'deleted'
            });
          }
        } catch (error) {
          console.error('[ERRO][SCHEDULER][SHOT][CLEANUP]', {
            shotId: shot.id,
            error: error.message
          });
        }
      }
    } catch (error) {
      console.error('[ERRO][SCHEDULER][SHOTS_CLEANUP]', error.message);
    }
  }

  /**
   * Processar fila de broadcast waves
   * Ondas são processadas em ordem, respeitando schedule_at
   */
  async processBroadcastWavesQueue() {
    try {
      // Buscar ondas pendentes que estão prontas para processar
      const result = await this.pool.query(
        `SELECT id, bot_id, bot_slug, kind, context, chat_ids, 
                wave_index, total_waves, schedule_at
         FROM broadcast_waves_queue
         WHERE status = 'pending'
           AND schedule_at <= NOW()
         ORDER BY schedule_at ASC, wave_index ASC
         LIMIT 5`
      );

      if (result.rows.length === 0) {
        return;
      }

      const BroadcastWaveWorker = require('./modules/broadcast-wave-worker');
      const waveWorker = new BroadcastWaveWorker(this.pool);

      for (const wave of result.rows) {
        try {
          // Marcar como processando
          await this.pool.query(
            'UPDATE broadcast_waves_queue SET status = $1, updated_at = NOW() WHERE id = $2',
            ['processing', wave.id]
          );

          // Processar onda
          const result = await waveWorker.processWave(wave);

          // Marcar como completo
          await this.pool.query(
            `UPDATE broadcast_waves_queue 
             SET status = $1, sent_count = $2, skipped_count = $3, 
                 failed_count = $4, updated_at = NOW() 
             WHERE id = $5`,
            ['completed', result.sent, result.skipped, result.failed, wave.id]
          );

          console.info('[SCHEDULER][BROADCAST_WAVE][COMPLETE]', {
            waveId: wave.id,
            bot: wave.bot_slug,
            kind: wave.kind,
            waveIndex: wave.wave_index,
            totalWaves: wave.total_waves,
            sent: result.sent,
            skipped: result.skipped,
            failed: result.failed
          });
        } catch (error) {
          console.error('[ERRO][SCHEDULER][BROADCAST_WAVE]', {
            waveId: wave.id,
            bot: wave.bot_slug,
            kind: wave.kind,
            error: error.message
          });

          // Marcar como erro
          await this.pool.query(
            'UPDATE broadcast_waves_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['error', error.message, wave.id]
          );
        }
      }
    } catch (error) {
      console.error('[ERRO][SCHEDULER][BROADCAST_WAVES_QUEUE]', error.message);
    }
  }
}

module.exports = QueueScheduler;
