/**
 * Rotas de webhook do Telegram
 * POST /tg/:slug/webhook
 */

const express = require('express');
const router = express.Router();
const MessageService = require('../modules/message-service');
const { getCryptoService } = require('../modules/crypto-singleton');

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

    console.info('[WEBHOOK:BOT_FOUND]', JSON.stringify({
      slug,
      botId: bot.id,
      botName: bot.name,
      active: bot.active,
      tokenStatus: bot.token_status,
      timestamp: new Date().toISOString()
    }));

    // 2. Normalizar update do Telegram
    const normalizedEvent = req.botEngine.normalizeUpdate(update);
    if (!normalizedEvent || normalizedEvent.type === 'unknown') {
      console.log(`[WEBHOOK] Update desconhecido para bot=${slug}`);
      return res.status(200).json({ ok: true });
    }

    // Responder rápido ao Telegram (não esperar processamento)
    res.status(200).json({ ok: true });

    // Processamento assíncrono (não bloqueia resposta)
    setImmediate(async () => {
      try {
        const { telegramId, chatId, command, text } = normalizedEvent;

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

          // Enviar mensagem de /start
          const messageService = new MessageService(req.pool);
          const crypto = getCryptoService();

          // Descriptografar token para envio
          const botToken = bot.token_encrypted ? crypto.decrypt(bot.token_encrypted) : null;

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
