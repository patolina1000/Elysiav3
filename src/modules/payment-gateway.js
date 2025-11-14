/**
 * Payment Gateway Interface
 * 
 * Responsabilidades:
 * - Registry de gateways (PushinPay, SyncPay, etc.)
 * - Resolver gateway para um bot
 * - Criar cobranças PIX
 * - Processar webhooks de pagamento
 * 
 * Fluxo:
 * 1. Bot tem provider padrão (ex: 'pushinpay')
 * 2. PaymentGateway resolve qual implementação usar
 * 3. Chama createPixCharge() do gateway
 * 4. Registra em payments e funnel_events
 */

class PaymentGateway {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
    this.gateways = new Map();
  }

  /**
   * Registrar implementação de gateway
   */
  registerGateway(name, gatewayImpl) {
    this.gateways.set(name, gatewayImpl);
    console.log(`[PAYMENT] Gateway registrado: ${name}`);
  }

  /**
   * Buscar gateway para um bot
   */
  async getGatewayForBot(botId) {
    try {
      const result = await this.pool.query(
        'SELECT provider FROM bots WHERE id = $1 LIMIT 1',
        [botId]
      );

      if (result.rows.length === 0) {
        console.warn(`[PAYMENT] Bot ${botId} não encontrado`);
        return null;
      }

      const provider = result.rows[0].provider;
      const gateway = this.gateways.get(provider);

      if (!gateway) {
        console.warn(`[PAYMENT] Gateway não registrado: ${provider}`);
        return null;
      }

      return gateway;
    } catch (error) {
      console.error(`[ERRO][PAYMENT] Falha ao buscar gateway para bot ${botId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Criar cobrança PIX
   * Respeita SLO de ≤ 2s
   * 
   * Fluxo:
   * 1. Validar bot e gateway
   * 2. Chamar gateway.createCharge()
   * 3. Registrar em payments
   * 4. Registrar em funnel_events (pix_created)
   */
  async createPixCharge(botId, telegramId, valueCents, metadata = {}) {
    const startTime = Date.now();

    try {
      // 1. Buscar bot_user_id
      const botUserResult = await this.pool.query(
        'SELECT id FROM bot_users WHERE bot_id = $1 AND telegram_id = $2 LIMIT 1',
        [botId, telegramId]
      );

      if (botUserResult.rows.length === 0) {
        throw new Error('Usuário não encontrado');
      }

      const botUserId = botUserResult.rows[0].id;

      // 2. Buscar bot e gateway
      const botResult = await this.pool.query(
        'SELECT slug, provider FROM bots WHERE id = $1 LIMIT 1',
        [botId]
      );

      if (botResult.rows.length === 0) {
        throw new Error('Bot não encontrado');
      }

      const bot = botResult.rows[0];
      const gateway = await this.getGatewayForBot(botId);
      
      if (!gateway) {
        throw new Error('Gateway não encontrado para bot');
      }

      // 3. Chamar gateway.createCharge()
      const chargeParams = {
        valueCents,
        botSlug: bot.slug,
        telegramId: String(telegramId),
        planName: metadata.planName || 'Plano',
        metadata
      };

      const chargeResult = await gateway.createCharge(chargeParams);

      if (!chargeResult.success) {
        throw new Error(chargeResult.error || 'Falha ao criar cobrança no gateway');
      }

      // 4. Registrar em payments
      const paymentResult = await this.pool.query(
        `INSERT INTO payments (
          transaction_id, provider, bot_id, bot_user_id, value_cents, status, 
          gateway, gateway_charge_id, pix_qr_code, pix_copy_paste, expires_at, 
          source_kind, source_slug, meta, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        RETURNING id`,
        [
          chargeResult.chargeId, // transaction_id (NOT NULL)
          bot.provider,          // provider (NOT NULL)
          botId, 
          botUserId, 
          valueCents, 
          'created',            // status (NOT NULL)
          bot.provider,         // gateway
          chargeResult.chargeId, // gateway_charge_id
          chargeResult.qrCode,
          chargeResult.qrCode,  // copy_paste é o mesmo que qr_code
          chargeResult.expiresAt,
          metadata.sourceKind || null,  // source_kind (start, downsell, shot)
          metadata.sourceSlug || null,  // source_slug (identificador)
          JSON.stringify({
            planName: metadata.planName,
            planId: metadata.planId,
            qrCodeBase64: chargeResult.qrCodeBase64
          })
        ]
      );

      const paymentId = paymentResult.rows[0]?.id;

      // 5. Registrar em funnel_events (pix_created)
      try {
        await this.pool.query(
          `INSERT INTO funnel_events (
            event_name, bot_id, bot_user_id, telegram_id, payment_id, price_cents, meta, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            'pix_created', 
            botId, 
            botUserId, 
            telegramId, 
            paymentId,
            valueCents,
            JSON.stringify({
              planName: metadata.planName,
              planId: metadata.planId
            })
          ]
        );
      } catch (dbError) {
        console.error(`[ERRO][PAYMENT][PIX_CREATED_EVENT] bot=${botId} user=${telegramId} error=${dbError.message}`);
      }

      // 6. Agendar downsells após gerar PIX (assíncrono)
      setImmediate(async () => {
        try {
          const DownsellScheduler = require('./downsell-scheduler');
          const downsellScheduler = new DownsellScheduler(this.pool);
          await downsellScheduler.scheduleAfterPixCreated(botId, telegramId, botUserId, paymentId);
        } catch (error) {
          console.error(`[ERRO][DOWNSELL][SCHEDULE_AFTER_PIX] bot=${botId} user=${telegramId} payment=${paymentId} error=${error.message}`);
        }
      });

      const duration = Date.now() - startTime;
      console.log(`[PAYMENT][PIX_CREATED] bot=${botId} user=${telegramId} value=${valueCents} payment_id=${paymentId} latency=${duration}ms`);

      return {
        success: true,
        paymentId,
        chargeId: chargeResult.chargeId,
        pixQrCode: chargeResult.qrCode,
        pixQrCodeBase64: chargeResult.qrCodeBase64,
        pixCopyPaste: chargeResult.qrCode,
        expiresAt: chargeResult.expiresAt,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[ERRO][PIX_CREATE] bot=${botId} user=${telegramId} error=${error.message} latency=${duration}ms`);
      return {
        success: false,
        error: error.message,
        duration
      };
    }
  }

  /**
   * Processar webhook de pagamento
   * Chamado quando gateway notifica que PIX foi pago
   */
  async processPaymentWebhook(gatewayName, webhookData, headers = {}) {
    try {
      const gateway = this.gateways.get(gatewayName);
      if (!gateway) {
        throw new Error(`Gateway não registrado: ${gatewayName}`);
      }

      // Validar assinatura do webhook (se implementado no gateway)
      if (gateway.validateWebhookSignature) {
        const isValid = gateway.validateWebhookSignature(webhookData, headers);
        if (!isValid) {
          throw new Error('Assinatura do webhook inválida');
        }
      }

      // Processar webhook via adapter
      const webhookResult = gateway.handleWebhook(webhookData);
      
      if (!webhookResult.valid) {
        console.warn(`[PAYMENT][WEBHOOK] Webhook inválido: ${webhookResult.error}`);
        return { success: true, processed: false };
      }

      const { chargeId, status } = webhookResult;

      // Registrar em gateway_events
      try {
        await this.pool.query(
          `INSERT INTO gateway_events (provider, provider_event_id, purpose, payload, received_at, created_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [gatewayName, chargeId || 'unknown', 'webhook', JSON.stringify(webhookData)]
        );
      } catch (dbError) {
        // Ignorar erro de duplicação (webhook enviado múltiplas vezes)
        if (dbError.message.includes('duplicate key') || dbError.message.includes('ux_gateway_events_dedupe')) {
          console.log(`[PAYMENT][WEBHOOK] Evento duplicado ignorado: ${chargeId}`);
        } else {
          console.error(`[ERRO][GATEWAY_EVENT] gateway=${gatewayName} error=${dbError.message}`);
        }
      }

      // Extrair dados do pagador do webhook
      const payerName = webhookResult.payerName || null;
      let customerFirstName = null;
      let customerLastName = null;
      
      if (payerName) {
        // Separar nome em primeiro nome e sobrenome
        const nameParts = payerName.trim().split(/\s+/);
        customerFirstName = nameParts[0] || null;
        customerLastName = nameParts.slice(1).join(' ') || null;
      }

      // Buscar pagamento pelo gateway_charge_id (case-insensitive)
      const paymentResult = await this.pool.query(
        'SELECT id, bot_id, bot_user_id, value_cents, meta, status as current_status FROM payments WHERE LOWER(gateway_charge_id) = LOWER($1) LIMIT 1',
        [chargeId]
      );

      if (paymentResult.rows.length === 0) {
        console.warn(`[PAYMENT][WEBHOOK] Pagamento não encontrado: charge_id=${chargeId}`);
        return { success: true, processed: false };
      }

      const payment = paymentResult.rows[0];

      // Processar status 'paid'
      if (status === 'paid') {
        if (payment.current_status === 'paid') {
          console.log(`[PAYMENT][WEBHOOK] Pagamento já estava pago: payment_id=${payment.id}`);
          return { success: true, processed: false };
        }

        // Atualizar status do pagamento para 'paid' e salvar nome do cliente
        await this.pool.query(
          'UPDATE payments SET status = $1, paid_at = NOW(), customer_first_name = $2, customer_last_name = $3, updated_at = NOW() WHERE id = $4',
          ['paid', customerFirstName, customerLastName, payment.id]
        );

        // Marcar usuário como cliente (has_purchase = TRUE)
        await this.pool.query(
          'UPDATE bot_users SET has_purchase = TRUE WHERE id = $1',
          [payment.bot_user_id]
        );

        console.log(`[PAYMENT][WEBHOOK] PIX pago: payment_id=${payment.id} bot=${payment.bot_id} user=${payment.bot_user_id}`);

        // Registrar em funnel_events (pix_paid)
        try {
          await this.pool.query(
            `INSERT INTO funnel_events (bot_id, telegram_id, event_name, price_cents, occurred_at, created_at)
             SELECT $1, telegram_id, 'pix_paid', $2, NOW(), NOW()
             FROM bot_users WHERE id = $3`,
            [payment.bot_id, payment.value_cents, payment.bot_user_id]
          );
        } catch (funnelError) {
          console.error(`[ERRO][FUNNEL_EVENT] payment_id=${payment.id} error=${funnelError.message}`);
        }

        return {
          success: true,
          processed: true,
          paymentId: payment.id
        };
      }

      // Processar status 'canceled' (reembolso)
      if (status === 'canceled') {
        if (payment.current_status === 'refunded') {
          console.log(`[PAYMENT][WEBHOOK] Pagamento já estava reembolsado: payment_id=${payment.id}`);
          return { success: true, processed: false };
        }

        // Atualizar status do pagamento para 'refunded'
        await this.pool.query(
          'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
          ['refunded', payment.id]
        );

        console.log(`[PAYMENT][WEBHOOK] PIX reembolsado: payment_id=${payment.id} bot=${payment.bot_id} value=${payment.value_cents}`);

        // Registrar em funnel_events (pix_refunded)
        try {
          await this.pool.query(
            `INSERT INTO funnel_events (bot_id, telegram_id, event_name, price_cents, occurred_at, created_at)
             SELECT $1, telegram_id, 'pix_refunded', $2, NOW(), NOW()
             FROM bot_users WHERE id = $3`,
            [payment.bot_id, payment.value_cents, payment.bot_user_id]
          );
        } catch (funnelError) {
          console.error(`[ERRO][FUNNEL_EVENT] payment_id=${payment.id} error=${funnelError.message}`);
        }

        return {
          success: true,
          processed: true,
          paymentId: payment.id,
          refunded: true
        };
      }

      // Status desconhecido
      console.log(`[PAYMENT][WEBHOOK] Status não processado: ${status}`);
      return { success: true, processed: false };
    } catch (error) {
      console.error(`[ERRO][PAYMENT_WEBHOOK] gateway=${gatewayName} error=${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = PaymentGateway;
