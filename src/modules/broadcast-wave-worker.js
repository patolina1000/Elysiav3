/**
 * Broadcast Wave Worker
 * 
 * Processa jobs de broadcast_wave:
 * - Carrega configurações do downsell/shot
 * - Revalida elegibilidade de cada chat
 * - Envia mensagens usando pipeline existente
 * - Registra eventos no funil
 * 
 * Rate limiting é aplicado no nível do message-service
 */

const MessageService = require('./message-service');
const { getCryptoService } = require('./crypto-singleton');

class BroadcastWaveWorker {
  constructor(pool) {
    this.pool = pool;
    this.messageService = new MessageService(pool);
  }

  /**
   * Processar um job de broadcast_wave
   * 
   * @param {Object} waveJob - Job da fila broadcast_waves_queue
   * @returns {Promise<{sent: number, skipped: number, failed: number}>}
   */
  async processWave(waveJob) {
    const { id, bot_id, bot_slug, kind, context, chat_ids, wave_index, total_waves } = waveJob;
    const parsedContext = typeof context === 'string' ? JSON.parse(context) : context;
    const parsedChatIds = typeof chat_ids === 'string' ? JSON.parse(chat_ids) : chat_ids;

    console.log('[BROADCAST][WAVE]', {
      bot: bot_slug,
      kind,
      waveIndex: wave_index,
      totalWaves: total_waves,
      totalInWave: parsedChatIds.length
    });

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      // 1. Carregar configurações do contexto
      const config = await this.loadConfig(bot_id, kind, parsedContext);
      if (!config) {
        throw new Error(`Configuração não encontrada: kind=${kind}`);
      }

      // 2. Buscar bot token
      const botResult = await this.pool.query(
        'SELECT token_encrypted, name FROM bots WHERE id = $1',
        [bot_id]
      );

      if (botResult.rows.length === 0) {
        throw new Error(`Bot não encontrado: id=${bot_id}`);
      }

      const crypto = getCryptoService();
      const botToken = botResult.rows[0].token_encrypted 
        ? crypto.decrypt(botResult.rows[0].token_encrypted) 
        : null;
      const botName = botResult.rows[0].name || 'Bot';

      if (!botToken) {
        throw new Error(`Bot token não disponível: id=${bot_id}`);
      }

      // 3. Processar cada chat da onda
      for (const chatId of parsedChatIds) {
        try {
          // Revalidar elegibilidade
          const isEligible = await this.revalidateEligibility(
            bot_id,
            chatId,
            kind,
            parsedContext,
            config
          );

          if (!isEligible.eligible) {
            console.info(`[BROADCAST][WAVE][SKIP] { bot:"${bot_slug}", kind:"${kind}", chatId:${chatId}, reason:"${isEligible.reason}" }`);
            skippedCount++;
            continue;
          }

          // Montar contexto para mensagem
          const messageContext = {
            userName: 'Usuário',
            botName,
            userId: chatId
          };

          // Enviar mensagem usando pipeline existente
          // Passar config pré-carregado para evitar busca no banco (shot pode ter sido deletado)
          const specificId = kind === 'downsell' ? parsedContext.downsellId : parsedContext.shotId;
          const sendResult = await this.messageService.sendMessage(
            bot_id,
            chatId,
            kind,
            messageContext,
            botToken,
            specificId,
            config  // Passar template pré-carregado
          );

          if (sendResult.success) {
            sentCount++;
            
            // Registrar evento específico
            await this.recordEvent(bot_id, chatId, kind, parsedContext);

            console.info(`[BROADCAST][WAVE][SENT] { bot:"${bot_slug}", kind:"${kind}", chatId:${chatId}, latencyMs:${sendResult.duration} }`);
          } else {
            failedCount++;
            console.warn(`[BROADCAST][WAVE][FAILED] { bot:"${bot_slug}", kind:"${kind}", chatId:${chatId}, error:"${sendResult.error}" }`);
          }
        } catch (error) {
          failedCount++;
          console.error('[ERRO][BROADCAST][WAVE][CHAT]', {
            bot: bot_slug,
            kind,
            chatId,
            error: error.message
          });
        }
      }

      console.log('[BROADCAST][WAVE][COMPLETE]', {
        bot: bot_slug,
        kind,
        waveIndex: wave_index,
        totalInWave: parsedChatIds.length,
        sent: sentCount,
        skipped: skippedCount,
        failed: failedCount
      });

      // Deletar shot após envio completo (apenas na última onda)
      if (kind === 'shot' && wave_index === total_waves - 1) {
        try {
          const shotId = parsedContext.shotId;
          
          // ANTES de deletar, salvar os planos em shot_plans_history
          // para que os botões de pagamento continuem funcionando
          if (config && config.content) {
            const content = typeof config.content === 'string' 
              ? JSON.parse(config.content) 
              : config.content;
            
            const plans = Array.isArray(content.plans) ? content.plans : [];
            
            if (plans.length > 0) {
              await this.pool.query(
                `INSERT INTO shot_plans_history (bot_id, shot_slug, plans, deleted_at, created_at)
                 VALUES ($1, $2, $3, NOW(), NOW())`,
                [bot_id, config.slug, JSON.stringify(plans)]
              );
              
              console.log('[BROADCAST][WAVE][SHOT_PLANS_SAVED]', {
                shotId,
                shotSlug: config.slug,
                bot: bot_slug,
                plansCount: plans.length
              });
            }
          }
          
          // Agora deletar o shot
          await this.pool.query('DELETE FROM shots WHERE id = $1', [shotId]);
          console.log('[BROADCAST][WAVE][SHOT_DELETED]', {
            shotId,
            bot: bot_slug,
            waveIndex: wave_index,
            reason: 'envio_completo',
            sent: sentCount,
            failed: failedCount
          });
        } catch (deleteError) {
          console.error('[ERRO][BROADCAST][WAVE][SHOT_DELETE]', {
            bot: bot_slug,
            kind,
            shotId: parsedContext.shotId,
            error: deleteError.message
          });
        }
      }

      return { sent: sentCount, skipped: skippedCount, failed: failedCount };
    } catch (error) {
      console.error('[ERRO][BROADCAST][WAVE]', {
        bot: bot_slug,
        kind,
        waveIndex: wave_index,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Carregar configuração do downsell ou shot
   * Se shotConfig/downsellConfig estiver no contexto, usa diretamente (evita race condition)
   */
  async loadConfig(botId, kind, context) {
    try {
      if (kind === 'downsell') {
        // Se configuração já está no contexto, usar diretamente
        if (context.downsellConfig) {
          console.log('[BROADCAST][LOAD_CONFIG][FROM_CONTEXT]', { kind, downsellId: context.downsellId });
          return context.downsellConfig;
        }
        
        const result = await this.pool.query(
          'SELECT * FROM bot_downsells WHERE id = $1 AND bot_id = $2',
          [context.downsellId, botId]
        );
        return result.rows[0] || null;
      } else if (kind === 'shot') {
        // Se configuração já está no contexto, usar diretamente
        if (context.shotConfig) {
          console.log('[BROADCAST][LOAD_CONFIG][FROM_CONTEXT]', { kind, shotId: context.shotId });
          return context.shotConfig;
        }
        
        const result = await this.pool.query(
          'SELECT * FROM shots WHERE id = $1 AND bot_id = $2',
          [context.shotId, botId]
        );
        return result.rows[0] || null;
      }
      return null;
    } catch (error) {
      console.error('[ERRO][BROADCAST][LOAD_CONFIG]', {
        botId,
        kind,
        context,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Revalidar elegibilidade do chat antes de enviar
   * Verifica se continua ativo, não bloqueado, e atende regras específicas
   */
  async revalidateEligibility(botId, chatId, kind, context, config) {
    try {
      // 1. Verificar se chat ainda está ativo (não bloqueado)
      const userResult = await this.pool.query(
        'SELECT id, blocked FROM bot_users WHERE bot_id = $1 AND telegram_id = $2',
        [botId, chatId]
      );

      if (userResult.rows.length === 0) {
        return { eligible: false, reason: 'user_not_found' };
      }

      if (userResult.rows[0].blocked) {
        return { eligible: false, reason: 'user_blocked' };
      }

      const botUserId = userResult.rows[0].id;

      // 2. Validar regras específicas por tipo
      if (kind === 'downsell') {
        // Para trigger 'pix', verificar se ainda não pagou
        if (config.trigger_type === 'pix') {
          const paidResult = await this.pool.query(
            'SELECT id FROM payments WHERE bot_user_id = $1 AND status = $2 LIMIT 1',
            [botUserId, 'paid']
          );

          if (paidResult.rows.length > 0) {
            return { eligible: false, reason: 'already_paid' };
          }
        }

        // Verificar se já recebeu este downsell
        const alreadySentResult = await this.pool.query(
          'SELECT id FROM downsells_queue WHERE bot_id = $1 AND downsell_id = $2 AND telegram_id = $3 AND status = $4 LIMIT 1',
          [botId, context.downsellId, chatId, 'sent']
        );

        if (alreadySentResult.rows.length > 0) {
          return { eligible: false, reason: 'already_sent' };
        }
      } else if (kind === 'shot') {
        // Para trigger 'pix', verificar se ainda não pagou
        if (config.trigger_type === 'pix_created' || config.trigger_type === 'pix') {
          const paidResult = await this.pool.query(
            'SELECT id FROM payments WHERE bot_user_id = $1 AND status = $2 LIMIT 1',
            [botUserId, 'paid']
          );

          if (paidResult.rows.length > 0) {
            return { eligible: false, reason: 'already_paid' };
          }
        }

        // Verificar se já recebeu este shot
        const eventId = `shot:${context.shotId}:${chatId}`;
        const alreadySentResult = await this.pool.query(
          'SELECT id FROM funnel_events WHERE event_id = $1 LIMIT 1',
          [eventId]
        );

        if (alreadySentResult.rows.length > 0) {
          return { eligible: false, reason: 'already_sent' };
        }
      }

      return { eligible: true };
    } catch (error) {
      console.error('[ERRO][BROADCAST][REVALIDATE]', {
        botId,
        chatId,
        kind,
        error: error.message
      });
      return { eligible: false, reason: 'validation_error' };
    }
  }

  /**
   * Registrar evento no funil para tracking
   * NOTA: MessageService já registra eventos, então este método
   * serve apenas como backup/fallback
   */
  async recordEvent(botId, chatId, kind, context) {
    try {
      if (kind === 'downsell') {
        // Marcar como enviado na fila de downsells (apenas para tracking)
        // MessageService já registra o evento principal
        await this.pool.query(
          `INSERT INTO downsells_queue (
            bot_id, downsell_id, telegram_id, tg_id, 
            trigger, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'broadcast', 'sent', NOW(), NOW())
          ON CONFLICT (bot_id, downsell_id, telegram_id) DO NOTHING`,
          [botId, context.downsellId, chatId, chatId]
        );
      } else if (kind === 'shot') {
        // MessageService já registra o evento de shot_sent
        // Não precisamos duplicar aqui
        // Apenas log para tracking
        console.debug('[BROADCAST][EVENT_SKIP]', {
          reason: 'MessageService already registered',
          shotId: context.shotId,
          chatId
        });
      }
    } catch (error) {
      // Erro esperado se evento já existe - não é crítico
      if (!error.message.includes('unique') && !error.message.includes('constraint')) {
        console.error('[ERRO][BROADCAST][RECORD_EVENT]', {
          botId,
          chatId,
          kind,
          error: error.message
        });
      }
      // Não falhar o envio por erro de registro
    }
  }
}

module.exports = BroadcastWaveWorker;
