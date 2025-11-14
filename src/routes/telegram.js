/**
 * Rotas de webhook do Telegram
 * POST /tg/:slug/webhook
 */

const express = require('express');
const router = express.Router();
const MessageService = require('../modules/message-service');
const botTokenCache = require('../modules/bot-token-cache');

/**
 * Webhook do Telegram para um bot específico
 * POST /tg/:slug/webhook
 * 
 * Fluxo:
 * 1. Validar que o bot existe
 * 2. Normalizar update do Telegram
 * 3. Registrar usuário em bot_users se necessário
 * 4. Registrar evento de funil (bot_start se /start)
 * 5. Enfileirar processamento
 * 6. Responder rápido (≤ 200ms)
 * 
 * SLO: ≤ 200ms
 */
router.post('/:slug/webhook', async (req, res) => {
  const startTime = Date.now();
  const { slug } = req.params;
  const update = req.body;

  try {
    const updateType = update.message
      ? 'message'
      : update.callback_query
        ? 'callback_query'
        : 'unknown';
    const fromId = update.message?.from?.id || update.callback_query?.from?.id || null;
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id || null;

    console.info('[WEBHOOK:RECEIVED]', JSON.stringify({
      slug,
      updateType,
      fromId,
      chatId,
      hasSecret: Boolean(req.headers['x-telegram-bot-api-secret-token']),
      timestamp: new Date().toISOString()
    }));

    // 1. Validar que o bot existe
    const bot = await req.botEngine.getBotBySlug(slug);
    if (!bot) {
      console.warn('[WEBHOOK:BOT_NOT_FOUND]', JSON.stringify({
        slug,
        reason: 'bot_not_in_database',
        timestamp: new Date().toISOString()
      }));
      return res.status(200).json({ ok: true });
    }

    // 2. Validar secret_token (validação rápida de origem)
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    const expectedSecret = botTokenCache.getSecretToken(bot.id);
    
    if (expectedSecret && receivedSecret !== expectedSecret) {
      console.warn('[WEBHOOK:INVALID_SECRET]', JSON.stringify({
        slug,
        botId: bot.id,
        hasReceivedSecret: Boolean(receivedSecret),
        timestamp: new Date().toISOString()
      }));
      return res.status(200).json({ ok: true }); // ACK mesmo assim para evitar reentregas
    }

    console.info('[WEBHOOK:BOT_FOUND]', JSON.stringify({
      slug,
      botId: bot.id,
      botName: bot.name,
      active: bot.active,
      tokenStatus: bot.token_status,
      secretValidated: Boolean(expectedSecret),
      timestamp: new Date().toISOString()
    }));

    // 3. Detectar bloqueio/desbloqueio do bot (my_chat_member)
    if (update.my_chat_member) {
      const myChatMember = update.my_chat_member;
      const telegramId = myChatMember.from?.id;
      const newStatus = myChatMember.new_chat_member?.status;
      const oldStatus = myChatMember.old_chat_member?.status;

      if (telegramId && newStatus) {
        const isBlocked = newStatus === 'kicked' || newStatus === 'left';
        const wasBlocked = oldStatus === 'kicked' || oldStatus === 'left';

        // Só atualizar se houve mudança de status
        if (isBlocked !== wasBlocked) {
          try {
            // Garantir que usuário existe em bot_users
            const userCheck = await req.pool.query(
              'SELECT id FROM bot_users WHERE bot_id = $1 AND telegram_id = $2',
              [bot.id, telegramId]
            );

            if (userCheck.rows.length === 0) {
              // Criar usuário se não existir
              await req.pool.query(
                `INSERT INTO bot_users (bot_id, telegram_id, blocked, first_seen_at, last_seen_at, created_at, updated_at)
                 VALUES ($1, $2, $3, NOW(), NOW(), NOW(), NOW())`,
                [bot.id, telegramId, isBlocked]
              );
            } else {
              // Atualizar status de bloqueio
              await req.pool.query(
                'UPDATE bot_users SET blocked = $1, updated_at = NOW() WHERE bot_id = $2 AND telegram_id = $3',
                [isBlocked, bot.id, telegramId]
              );
            }

            console.info('[WEBHOOK:CHAT_MEMBER_UPDATE]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              oldStatus,
              newStatus,
              blocked: isBlocked,
              timestamp: new Date().toISOString()
            }));
          } catch (error) {
            console.error('[ERRO:CHAT_MEMBER_UPDATE]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              error: error.message
            }));
          }
        }
      }

      // ACK rápido para my_chat_member
      const ackTime = Date.now() - startTime;
      console.info('[WEBHOOK:ACK]', JSON.stringify({
        slug,
        updateType: 'my_chat_member',
        ackTimeMs: ackTime,
        timestamp: new Date().toISOString()
      }));
      return res.status(200).json({ ok: true });
    }

    // 4. Normalizar update do Telegram
    const normalizedEvent = req.botEngine.normalizeUpdate(update);
    if (!normalizedEvent || normalizedEvent.type === 'unknown') {
      console.log(`[WEBHOOK] Update desconhecido para bot=${slug}`);
      const ackTime = Date.now() - startTime;
      console.info('[WEBHOOK:ACK]', JSON.stringify({
        slug,
        fromId,
        chatId,
        updateType: 'unknown',
        ackTimeMs: ackTime,
        timestamp: new Date().toISOString()
      }));
      return res.status(200).json({ ok: true });
    }

    // OTIMIZAÇÃO: Para comando /start, responder DIRETAMENTE no webhook
    // Economiza 1 RTT completo (~150-300ms dependendo da localização)
    if (normalizedEvent.command === '/start') {
      console.info('[WEBHOOK:DIRECT_RESPONSE_START]', JSON.stringify({
        slug,
        fromId,
        chatId,
        timestamp: new Date().toISOString()
      }));

      // Processamento síncrono para /start (resposta direta)
      try {
        const messageService = new MessageService(req.pool);

        // Obter token do cache (já descriptografado no boot)
        const botToken = botTokenCache.getToken(bot.id);
        
        if (!botToken) {
          console.warn('[START:NO_TOKEN]', JSON.stringify({
            slug,
            botId: bot.id,
            reason: 'token_encrypted_is_null_or_decrypt_failed'
          }));
          return res.status(200).json({ ok: true });
        }

        // Registrar usuário em bot_users se necessário
        let botUser = await req.pool.query(
          'SELECT id FROM bot_users WHERE bot_id = $1 AND telegram_id = $2 LIMIT 1',
          [bot.id, normalizedEvent.telegramId]
        );

        let botUserId;
        if (botUser.rows.length === 0) {
          const createResult = await req.pool.query(
            `INSERT INTO bot_users (bot_id, telegram_id, blocked, first_seen_at, last_seen_at, created_at, updated_at)
             VALUES ($1, $2, FALSE, NOW(), NOW(), NOW(), NOW())
             RETURNING id`,
            [bot.id, normalizedEvent.telegramId]
          );
          botUserId = createResult.rows[0].id;
        } else {
          botUserId = botUser.rows[0].id;
          // Se usuário envia /start, ele não está bloqueado
          await req.pool.query(
            'UPDATE bot_users SET last_seen_at = NOW(), last_start_at = NOW(), blocked = FALSE, updated_at = NOW() WHERE id = $1',
            [botUserId]
          );
        }

        // Registrar evento de funil (assíncrono para não bloquear)
        setImmediate(async () => {
          try {
            await req.pool.query(
              `INSERT INTO funnel_events (event_name, bot_id, bot_user_id, telegram_id, occurred_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              ['bot_start', bot.id, botUserId, normalizedEvent.telegramId]
            );
          } catch (dbError) {
            console.error('[ERRO:START:EVENT_REGISTER_ASYNC]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId: normalizedEvent.telegramId,
              error: dbError.message
            }));
          }
        });

        // Agendar downsells após /start (assíncrono para não bloquear)
        setImmediate(async () => {
          try {
            const DownsellScheduler = require('../modules/downsell-scheduler');
            const downsellScheduler = new DownsellScheduler(req.pool);
            await downsellScheduler.scheduleAfterStart(bot.id, normalizedEvent.telegramId, botUserId);
          } catch (error) {
            console.error('[ERRO:DOWNSELL:SCHEDULE_AFTER_START]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId: normalizedEvent.telegramId,
              error: error.message
            }));
          }
        });

        const context = {
          userName: 'Usuário',
          botName: bot.name || 'Bot',
          userId: normalizedEvent.telegramId
        };

        // Buscar template e preparar resposta direta
        const template = await messageService.getMessageTemplate(bot.id, 'start');
        if (!template) {
          return res.status(200).json({ ok: true });
        }

        // CORREÇÃO: Usar fluxo completo para múltiplas mídias
        const botResult = await req.pool.query('SELECT slug FROM bots WHERE id = $1', [bot.id]);
        if (botResult.rows.length === 0) {
          return res.status(200).json({ ok: true });
        }

        const botSlug = botResult.rows[0].slug;
        const mediasInConfig = template.content.medias || [];
        
        // Se há múltiplas mídias, usar fluxo completo assíncrono
        if (mediasInConfig.length > 1) {
          console.info('[WEBHOOK:MULTIPLE_MEDIA_DETECTED]', JSON.stringify({
            slug,
            mediaCount: mediasInConfig.length,
            fallbackToAsync: true
          }));

          // Processar via fluxo completo assíncrono
          setImmediate(async () => {
            try {
              await messageService.sendMessage(bot.id, normalizedEvent.telegramId, 'start', context, botToken);
            } catch (error) {
              console.error('[ERRO:ASYNC_FULL_FLOW]', JSON.stringify({
                slug,
                error: error.message
              }));
            }
          });

          const ackTime = Date.now() - startTime;
          console.info('[WEBHOOK:ASYNC_DISPATCHED]', JSON.stringify({
            slug,
            fromId,
            chatId,
            mediaCount: mediasInConfig.length,
            ackTimeMs: ackTime,
            timestamp: new Date().toISOString()
          }));

          return res.status(200).json({ ok: true });
        }

        // Para mídia única, usar resposta direta otimizada
        let firstMedia = null;
        if (mediasInConfig.length === 1) {
          const resolvedMedias = await messageService.mediaResolver.resolveMedias(botSlug, [mediasInConfig[0]]);
          firstMedia = resolvedMedias[0];
        }

        const renderedContent = messageService.renderContent(template, context);
        const firstMessage = Array.isArray(renderedContent.messages) 
          ? renderedContent.messages[0] 
          : renderedContent.text || 'Bem-vindo!';

        // Preparar resposta direta no webhook
        const directResponse = {
          method: 'sendMessage',
          chat_id: normalizedEvent.chatId,
          text: firstMessage || 'Bem-vindo!',
          parse_mode: 'MarkdownV2'
        };

        // Se houver mídia, enviar como foto/vídeo
        if (firstMedia && firstMedia.tg_file_id) {
          if (firstMedia.kind === 'video') {
            directResponse.method = 'sendVideo';
            directResponse.video = firstMedia.tg_file_id;
            directResponse.caption = directResponse.text;
            delete directResponse.text;
          } else if (firstMedia.kind === 'photo') {
            directResponse.method = 'sendPhoto';
            directResponse.photo = firstMedia.tg_file_id;
            directResponse.caption = directResponse.text;
            delete directResponse.text;
          }
        }

        // Adicionar botões se houver planos
        const plans = Array.isArray(template.content?.plans) ? template.content.plans.slice(0, 3) : [];
        if (plans.length > 0) {
          const planEntries = messageService._normalizePlansForKeyboard(plans, bot.id);
          if (planEntries.length > 0) {
            directResponse.reply_markup = {
              inline_keyboard: planEntries.map(entry => [entry.button])
            };
          }
        }

        const ackTime = Date.now() - startTime;
        console.info('[WEBHOOK:DIRECT_RESPONSE_SENT]', JSON.stringify({
          slug,
          fromId,
          chatId,
          method: directResponse.method,
          hasMedia: Boolean(firstMedia),
          mediaCount: mediasInConfig.length,
          ackTimeMs: ackTime,
          timestamp: new Date().toISOString()
        }));

        return res.status(200).json(directResponse);

      } catch (error) {
        console.error('[ERRO:DIRECT_RESPONSE]', JSON.stringify({
          slug,
          error: error.message
        }));
        return res.status(200).json({ ok: true });
      }
    }

    // Para outros comandos, usar fluxo normal
    const ackTime = Date.now() - startTime;
    res.status(200).json({ ok: true });

    // Log de ACK com alerta se estiver lento (SLO: ≤200ms)
    console.info('[WEBHOOK:ACK]', JSON.stringify({
      slug,
      fromId,
      chatId,
      updateType,
      ackTimeMs: ackTime,
      timestamp: new Date().toISOString()
    }));

    if (ackTime > 200) {
      console.warn('[WEBHOOK:ACK_SLOW]', JSON.stringify({
        slug,
        fromId,
        chatId,
        ackTimeMs: ackTime,
        sloViolation: true,
        timestamp: new Date().toISOString()
      }));
    }

    // Processamento assíncrono (não bloqueia resposta)
    setImmediate(async () => {
      try {
        const messageService = new MessageService(req.pool);

        // Obter token do cache (já descriptografado no boot)
        const botToken = botTokenCache.getToken(bot.id);

        const { telegramId, chatId } = normalizedEvent;

        if (normalizedEvent.type === 'callback_query') {
          const data = normalizedEvent.data || '';

          if (data && data.startsWith('plan:')) {
            const parts = data.split(':');
            const dataBotId = parts.length > 1 ? parseInt(parts[1], 10) : bot.id;
            const planId = parts.length > 2 ? parts[2] : null;
            const sourceKind = parts.length > 3 ? parts[3] : null;
            const sourceSlug = parts.length > 4 ? parts.slice(4).join(':') : null;
            const resolvedBotId = Number.isNaN(dataBotId) ? bot.id : dataBotId;

            // Log para debug
            console.log(`[PLAN:CALLBACK:RECEIVED] { callbackData:"${data}", parts:${parts.length}, planId:"${planId}", sourceKind:"${sourceKind}", sourceSlug:"${sourceSlug}" }`);

            let planMeta = null;
            try {
              planMeta = await messageService.getPlanMetadata(bot.id, planId, sourceKind, sourceSlug);
            } catch (planMetaError) {
              console.error('[ERRO:PLAN:METADATA_LOOKUP]', JSON.stringify({
                botId: bot.id,
                telegramId,
                planId,
                sourceKind,
                sourceSlug,
                error: planMetaError.message
              }));
            }

            const planLogPayload = {
              botId: resolvedBotId,
              telegramId,
              plan_id: planMeta?.planId ?? (planId || null),
              plan_name: planMeta?.name ?? null,
              price_cents: planMeta?.priceCents ?? null
            };

            console.info('[PLANS][CLICK]', JSON.stringify(planLogPayload));

            if (!botToken) {
              console.warn('[PLAN:CLICK:NO_TOKEN]', JSON.stringify({
                slug,
                botId: bot.id,
                telegramId
              }));
              return;
            }

            const axios = require('axios');
            const apiUrl = `https://api.telegram.org/bot${botToken}`;

            // ACK do callback query
            try {
              await axios.post(
                `${apiUrl}/answerCallbackQuery`,
                {
                  callback_query_id: update.callback_query.id,
                  text: '⏳ Gerando seu PIX...',
                  show_alert: false
                },
                { timeout: 5000, validateStatus: () => true }
              );
            } catch (error) {
              console.error('[ERRO:PLAN:ACK]', JSON.stringify({
                botId: bot.id,
                error: error.message
              }));
            }

            // Validar se temos preço
            if (!planMeta || !planMeta.priceCents || planMeta.priceCents < 50) {
              try {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '❌ Erro: Plano inválido ou valor muito baixo. Entre em contato com o suporte.'
                });
              } catch (error) {
                console.error('[ERRO:PLAN:ERROR_MESSAGE]', JSON.stringify({
                  botId: bot.id,
                  error: error.message
                }));
              }
              return;
            }

            // Criar PIX via PaymentGateway
            try {
              // Usar instância global do PaymentGateway (registrada no servidor)
              const paymentGateway = req.app.get('paymentGateway');
              
              if (!paymentGateway) {
                throw new Error('PaymentGateway não inicializado');
              }

              const pixResult = await paymentGateway.createPixCharge(
                bot.id,
                telegramId,
                planMeta.priceCents,
                {
                  planName: planMeta.name,
                  planId: planMeta.planId,
                  sourceKind: sourceKind || 'start',
                  sourceSlug: sourceSlug || 'start'
                }
              );

              if (!pixResult.success) {
                console.error('[ERRO:PLAN:PIX_CREATE]', JSON.stringify({
                  botId: bot.id,
                  telegramId,
                  error: pixResult.error
                }));

                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: `❌ Erro ao gerar PIX: ${pixResult.error}\n\nTente novamente em alguns instantes.`
                });
                return;
              }

              console.info('[PLAN:PIX_CREATED]', JSON.stringify({
                botId: bot.id,
                telegramId,
                paymentId: pixResult.paymentId,
                valueCents: planMeta.priceCents,
                latencyMs: pixResult.duration
              }));

              // Enviar PIX para o usuário em 4 mensagens separadas
              console.log('[PLAN:SENDING_PIX_MESSAGES] Preparando 4 mensagens...');

              // Mensagem 1: Instrução inicial
              await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: 'Para efetuar o pagamento, utilize a opção "Pagar" > "PIX copia e Cola" no aplicativo do seu banco.'
              });

              // Mensagem 2: Instrução para copiar
              await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: 'Copie o código abaixo:'
              });

              // Mensagem 3: Código PIX em bloco copiável
              // Remover crases do código PIX se houver
              const pixCodeClean = pixResult.pixCopyPaste.replace(/`/g, '');
              await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: `\`\`\`copiar\n${pixCodeClean}\n\`\`\``,
                parse_mode: 'Markdown'
              });

              // Mensagem 4: Instrução final com botões
              const finalResponse = await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: 'Após efetuar o pagamento, clique no botão abaixo ⤵️',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'EFETUEI O PAGAMENTO', callback_data: `check_payment:${pixResult.paymentId}` }],
                    [{ text: 'Qr code', callback_data: `show_qr:${pixResult.paymentId}` }]
                  ]
                }
              });
              
              console.log('[PLAN:PIX_MESSAGES_SENT]', JSON.stringify({
                ok: finalResponse.ok,
                paymentId: pixResult.paymentId,
                messagesCount: 4
              }));

              console.log('[PLAN:PIX_MESSAGE_COMPLETE]');

            } catch (error) {
              console.error('[ERRO:PLAN:EXCEPTION]', JSON.stringify({
                botId: bot.id,
                telegramId,
                error: error.message,
                stack: error.stack
              }));

              try {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '❌ Erro inesperado ao processar seu pedido. Tente novamente.'
                });
              } catch (msgError) {
                console.error('[ERRO:PLAN:ERROR_MESSAGE_SEND]', JSON.stringify({
                  error: msgError.message
                }));
              }
            }
          }

          // Handler para "EFETUEI O PAGAMENTO"
          if (data && data.startsWith('check_payment:')) {
            const paymentId = data.split(':')[1];
            console.log('[PAYMENT:CHECK_REQUESTED]', JSON.stringify({
              botId: bot.id,
              telegramId,
              paymentId
            }));

            try {
              // ACK do callback
              await axios.post(
                `${apiUrl}/answerCallbackQuery`,
                {
                  callback_query_id: update.callback_query.id,
                  text: '🔍 Verificando pagamento...',
                  show_alert: false
                },
                { timeout: 5000, validateStatus: () => true }
              );

              // Buscar status do pagamento
              const paymentResult = await req.pool.query(
                `SELECT status, plan_name, value_cents FROM payments WHERE id = $1 AND telegram_id = $2`,
                [paymentId, telegramId]
              );

              if (paymentResult.rows.length === 0) {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '❌ Pagamento não encontrado.'
                });
                return;
              }

              const payment = paymentResult.rows[0];
              
              if (payment.status === 'approved') {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '✅ Pagamento confirmado! Obrigado pela sua compra.'
                });
              } else if (payment.status === 'pending') {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '⏳ Seu pagamento ainda está pendente. Aguarde a confirmação.'
                });
              } else {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: `ℹ️ Status do pagamento: ${payment.status}`
                });
              }

            } catch (error) {
              console.error('[ERRO:CHECK_PAYMENT]', JSON.stringify({
                botId: bot.id,
                telegramId,
                paymentId,
                error: error.message
              }));
              
              await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: '❌ Erro ao verificar pagamento. Tente novamente.'
              });
            }

            return;
          }

          // Handler para "Qr code"
          if (data && data.startsWith('show_qr:')) {
            const paymentId = data.split(':')[1];
            console.log('[QR_CODE:REQUESTED]', JSON.stringify({
              botId: bot.id,
              telegramId,
              paymentId
            }));

            try {
              // ACK do callback
              await axios.post(
                `${apiUrl}/answerCallbackQuery`,
                {
                  callback_query_id: update.callback_query.id,
                  text: '📱 Gerando QR Code...',
                  show_alert: false
                },
                { timeout: 5000, validateStatus: () => true }
              );

              // Buscar dados do pagamento
              const paymentResult = await req.pool.query(
                `SELECT pix_copy_paste, pix_qr_code_base64 FROM payments WHERE id = $1 AND telegram_id = $2`,
                [paymentId, telegramId]
              );

              if (paymentResult.rows.length === 0) {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '❌ Pagamento não encontrado.'
                });
                return;
              }

              const payment = paymentResult.rows[0];
              
              if (!payment.pix_qr_code_base64) {
                await messageService.sendViaTelegramAPI(botToken, {
                  chat_id: chatId,
                  text: '❌ QR Code não disponível para este pagamento.'
                });
                return;
              }

              // Enviar QR Code como foto
              const base64Data = payment.pix_qr_code_base64.replace(/^data:image\/\w+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');

              const FormData = require('form-data');
              const form = new FormData();
              form.append('chat_id', chatId);
              form.append('photo', buffer, {
                filename: 'qrcode.png',
                contentType: 'image/png'
              });
              form.append('caption', '📱 Escaneie o QR Code para pagar');

              const photoResponse = await axios.post(
                `${apiUrl}/sendPhoto`,
                form,
                { 
                  timeout: 10000,
                  validateStatus: () => true,
                  headers: form.getHeaders()
                }
              );

              console.log('[QR_CODE:SENT]', JSON.stringify({
                ok: photoResponse.data?.ok,
                paymentId
              }));

              if (!photoResponse.data?.ok) {
                throw new Error(photoResponse.data?.description || 'Falha ao enviar QR Code');
              }

            } catch (error) {
              console.error('[ERRO:SHOW_QR]', JSON.stringify({
                botId: bot.id,
                telegramId,
                paymentId,
                error: error.message
              }));
              
              await messageService.sendViaTelegramAPI(botToken, {
                chat_id: chatId,
                text: '❌ Erro ao enviar QR Code. Tente novamente.'
              });
            }

            return;
          }

          return;
        }

        const { command, text } = normalizedEvent;

        // 3. Registrar usuário em bot_users se necessário
        let botUser = await req.pool.query(
          'SELECT id FROM bot_users WHERE bot_id = $1 AND telegram_id = $2 LIMIT 1',
          [bot.id, telegramId]
        );

        let botUserId;
        if (botUser.rows.length === 0) {
          // Criar novo bot_user
          const createResult = await req.pool.query(
            `INSERT INTO bot_users (bot_id, telegram_id, first_seen_at, last_seen_at, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW(), NOW(), NOW())
             RETURNING id`,
            [bot.id, telegramId]
          );
          botUserId = createResult.rows[0].id;
          console.log(`[WEBHOOK][NEW_USER] bot=${slug} user=${telegramId} bot_user_id=${botUserId}`);
        } else {
          botUserId = botUser.rows[0].id;
          // Atualizar last_seen_at
          await req.pool.query(
            'UPDATE bot_users SET last_seen_at = NOW() WHERE id = $1',
            [botUserId]
          );
        }

        // 4. Registrar evento de funil e enviar resposta
        if (command === '/start') {
          console.info('[START:COMMAND_DETECTED]', JSON.stringify({
            slug,
            botId: bot.id,
            telegramId,
            botUserId,
            timestamp: new Date().toISOString()
          }));

          // Registrar bot_start
          try {
            await req.pool.query(
              `INSERT INTO funnel_events (event_name, bot_id, bot_user_id, telegram_id, occurred_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              ['bot_start', bot.id, botUserId, telegramId]
            );
            console.info('[START:EVENT_REGISTERED]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              eventName: 'bot_start'
            }));
          } catch (dbError) {
            console.error('[ERRO:START:EVENT_REGISTER]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              error: dbError.message,
              code: dbError.code
            }));
          }

          // Atualizar last_start_at
          await req.pool.query(
            'UPDATE bot_users SET last_start_at = NOW() WHERE id = $1',
            [botUserId]
          );

          // Agendar downsells após /start (assíncrono)
          setImmediate(async () => {
            try {
              const DownsellScheduler = require('../modules/downsell-scheduler');
              const downsellScheduler = new DownsellScheduler(req.pool);
              await downsellScheduler.scheduleAfterStart(bot.id, telegramId, botUserId);
            } catch (error) {
              console.error('[ERRO:DOWNSELL:SCHEDULE_AFTER_START_ASYNC]', JSON.stringify({
                slug,
                botId: bot.id,
                telegramId,
                error: error.message
              }));
            }
          });

          if (!botToken) {
            console.warn('[START:NO_TOKEN]', JSON.stringify({
              slug,
              botId: bot.id,
              reason: 'token_encrypted_is_null_or_decrypt_failed'
            }));
          }

          const context = {
            userName: 'Usuário',
            botName: bot.name || 'Bot',
            userId: telegramId
          };

          console.info('[START:SENDING]', JSON.stringify({
            slug,
            botId: bot.id,
            telegramId,
            botUserId,
            hasToken: Boolean(botToken),
            contextKeys: Object.keys(context),
            timestamp: new Date().toISOString()
          }));

          // Enviar mensagem via Telegram API
          const sendResult = await messageService.sendMessage(
            bot.id,
            telegramId,
            'start',
            context,
            botToken // Bot token descriptografado
          );

          if (sendResult.success) {
            console.info('[START:SUCCESS]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              latencyMs: sendResult.duration,
              messageCount: sendResult.messageCount,
              mediaCount: sendResult.mediaCount,
              timestamp: new Date().toISOString()
            }));
          } else {
            console.warn('[START:FAILED]', JSON.stringify({
              slug,
              botId: bot.id,
              telegramId,
              error: sendResult.error,
              latencyMs: sendResult.duration,
              timestamp: new Date().toISOString()
            }));
          }
        } else if (normalizedEvent.type === 'message') {
          // Registrar bot_interaction
          try {
            await req.pool.query(
              `INSERT INTO funnel_events (event_name, bot_id, bot_user_id, telegram_id, meta, occurred_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              ['bot_interaction', bot.id, botUserId, telegramId, JSON.stringify({ text })]
            );
          } catch (dbError) {
            console.error(`[ERRO][WEBHOOK][BOT_INTERACTION_EVENT] bot=${slug} user=${telegramId} error=${dbError.message}`);
          }
        }

        const duration = Date.now() - startTime;
        console.log(`[WEBHOOK][OK] slug=${slug} user=${telegramId} event=${command || 'message'} latency=${duration}ms`);

      } catch (error) {
        console.error(`[ERRO][WEBHOOK_ASYNC] slug=${slug} error=${error.message}`);
      }
    });

  } catch (error) {
    console.error(`[ERRO][WEBHOOK] slug=${slug} error=${error.message}`);
    res.status(200).json({ ok: true }); // Telegram não se importa com erro
  }
});

module.exports = router;
