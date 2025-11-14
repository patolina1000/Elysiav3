/**
 * Rotas de webhooks de pagamento
 * POST /api/payments/webhook/:gateway
 */

const express = require('express');
const router = express.Router();

/**
 * Webhook genérico para gateways de pagamento
 * POST /api/payments/webhook/:gateway
 * 
 * Suporta múltiplos gateways:
 * - pushinpay
 * - syncpay
 * - (futuros)
 * 
 * SLO: ACK em ≤ 200ms
 */
router.post('/webhook/:gateway', async (req, res) => {
  const startTime = Date.now();
  const { gateway } = req.params;
  const payload = req.body;
  const headers = req.headers;

  try {
    console.log(`[PAYMENT][WEBHOOK] gateway=${gateway} payload_keys=${Object.keys(payload).join(',')}`);

    // ACK rápido (≤ 200ms)
    res.status(200).json({ ok: true });

    const ackTime = Date.now() - startTime;
    console.log(`[PAYMENT][WEBHOOK_ACK] gateway=${gateway} latency=${ackTime}ms`);

    // Processar webhook assincronamente
    setImmediate(async () => {
      try {
        // Usar instância global do PaymentGateway (registrada no servidor)
        const paymentGateway = req.app.get('paymentGateway');
        
        if (!paymentGateway) {
          throw new Error('PaymentGateway não inicializado');
        }

        const result = await paymentGateway.processPaymentWebhook(gateway, payload, headers);

        if (result.success && result.processed) {
          console.log(`[PAYMENT][WEBHOOK_PROCESSED] gateway=${gateway} payment_id=${result.paymentId}`);

          // Enviar mensagem de pagamento aprovado
          if (result.paymentId) {
            try {
              // Buscar dados do pagamento
              const paymentResult = await req.pool.query(
                `SELECT p.id, p.bot_id, p.value_cents, p.meta, bu.telegram_id
                 FROM payments p
                 JOIN bot_users bu ON p.bot_user_id = bu.id
                 WHERE p.id = $1`,
                [result.paymentId]
              );

              if (paymentResult.rows.length > 0) {
                const payment = paymentResult.rows[0];
                const telegramId = payment.telegram_id;
                const botId = payment.bot_id;
                const valueCents = payment.value_cents;
                const meta = payment.meta || {};

                // Buscar token do bot
                const botTokenCache = require('../modules/bot-token-cache');
                const botToken = botTokenCache.getToken(botId);

                if (botToken && telegramId) {
                  const MessageService = require('../modules/message-service');
                  const messageService = new MessageService(req.pool);

                  const valorReais = (valueCents / 100).toFixed(2).replace('.', ',');
                  const planName = meta.planName || 'Plano';

                  const successMessage = `✅ *Pagamento Aprovado\\!*\n\n` +
                    `🎉 Parabéns\\! Seu pagamento foi confirmado\\.\n\n` +
                    `📦 Plano: *${planName.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n` +
                    `💵 Valor: *R$ ${valorReais}*\n\n` +
                    `✨ Você agora tem acesso completo\\!\n` +
                    `_Obrigado pela sua compra\\._`;

                  await messageService.sendViaTelegramAPI(botToken, {
                    chat_id: telegramId,
                    text: successMessage,
                    parse_mode: 'MarkdownV2'
                  });

                  console.log(`[PAYMENT][SUCCESS_MESSAGE_SENT] payment_id=${result.paymentId} user=${telegramId}`);
                }
              }
            } catch (msgError) {
              console.error(`[ERRO][PAYMENT][SUCCESS_MESSAGE] payment_id=${result.paymentId} error=${msgError.message}`);
            }
          }
        } else if (!result.success) {
          console.error(`[ERRO][PAYMENT][WEBHOOK_PROCESS] gateway=${gateway} error=${result.error}`);
        }

      } catch (asyncError) {
        console.error(`[ERRO][PAYMENT][WEBHOOK_ASYNC] gateway=${gateway} error=${asyncError.message}`);
      }
    });

  } catch (error) {
    console.error(`[ERRO][PAYMENT_WEBHOOK] gateway=${gateway} error=${error.message}`);
    // Já enviou ACK, não fazer nada
  }
});

module.exports = router;
