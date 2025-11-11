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
  async createPixCharge(botId, botUserId, valueCents, metadata = {}) {
    const startTime = Date.now();

    try {
      // 1. Validar bot e gateway
      const gateway = await this.getGatewayForBot(botId);
      if (!gateway) {
        throw new Error('Gateway não encontrado para bot');
      }

      // 2. Chamar gateway.createCharge()
      // TODO: Implementar chamada real ao gateway
      // const chargeResult = await gateway.createCharge({
      //   amount_cents: valueCents,
      //   description: metadata.description || 'Cobrança PIX',
      //   customer_id: botUserId,
      //   metadata: metadata
      // });

      // Por enquanto, simular resposta
      const chargeResult = {
        success: true,
        charge_id: `charge_${Date.now()}`,
        pix_qr_code: 'pix_qr_code_placeholder',
        pix_copy_paste: 'pix_copy_paste_placeholder',
        expires_at: new Date(Date.now() + 30 * 60 * 1000) // 30 minutos
      };

      if (!chargeResult.success) {
        throw new Error(`Falha ao criar cobrança no gateway: ${chargeResult.error}`);
      }

      // 3. Registrar em payments
      const paymentResult = await this.pool.query(
        `INSERT INTO payments (
          bot_id, bot_user_id, value_cents, status, gateway_charge_id, 
          pix_qr_code, pix_copy_paste, expires_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING id`,
        [
          botId, botUserId, valueCents, 'pending',
          chargeResult.charge_id,
          chargeResult.pix_qr_code,
          chargeResult.pix_copy_paste,
          chargeResult.expires_at
        ]
      );

      const paymentId = paymentResult.rows[0]?.id;

      // 4. Registrar em funnel_events (pix_created)
      // Buscar telegram_id do bot_user para registrar evento
      const botUserResult = await this.pool.query(
        'SELECT telegram_id FROM bot_users WHERE id = $1 LIMIT 1',
        [botUserId]
      );
      const telegramId = botUserResult.rows[0]?.telegram_id;

      if (telegramId) {
        try {
          await this.pool.query(
            `INSERT INTO funnel_events (
              event_name, bot_id, bot_user_id, telegram_id, payment_id, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            ['pix_created', botId, botUserId, telegramId, paymentId]
          );
        } catch (dbError) {
          console.error(`[ERRO][PAYMENT][PIX_CREATED_EVENT] bot=${botId} user=${botUserId} error=${dbError.message}`);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[PAYMENT][PIX_CREATED] bot=${botId} user=${botUserId} value=${valueCents} payment_id=${paymentId} latency=${duration}ms`);

      return {
        success: true,
        paymentId,
        chargeId: chargeResult.charge_id,
        pixQrCode: chargeResult.pix_qr_code,
        pixCopyPaste: chargeResult.pix_copy_paste,
        expiresAt: chargeResult.expires_at,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[ERRO][PIX_CREATE] bot=${botId} user=${botUserId} error=${error.message} latency=${duration}ms`);
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
  async processPaymentWebhook(gatewayName, webhookData) {
    try {
      const gateway = this.gateways.get(gatewayName);
      if (!gateway) {
        throw new Error(`Gateway não registrado: ${gatewayName}`);
      }

      // Validar assinatura do webhook (se implementado no gateway)
      if (gateway.validateWebhookSignature) {
        const isValid = await gateway.validateWebhookSignature(webhookData);
        if (!isValid) {
          throw new Error('Assinatura do webhook inválida');
        }
      }

      // Extrair dados do webhook
      const { charge_id, status } = webhookData;

      if (status !== 'paid') {
        console.log(`[PAYMENT][WEBHOOK] Status não é 'paid': ${status}`);
        return { success: true, processed: false };
      }

      // Buscar pagamento pelo gateway_charge_id
      const paymentResult = await this.pool.query(
        'SELECT id, bot_id, bot_user_id FROM payments WHERE gateway_charge_id = $1 LIMIT 1',
        [charge_id]
      );

      if (paymentResult.rows.length === 0) {
        console.warn(`[PAYMENT][WEBHOOK] Pagamento não encontrado: charge_id=${charge_id}`);
        return { success: true, processed: false };
      }

      const payment = paymentResult.rows[0];

      // Atualizar status do pagamento
      await this.pool.query(
        'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
        ['paid', payment.id]
      );

      // Registrar evento de funil (pix_paid)
      // Buscar telegram_id do bot_user para registrar evento
      const botUserResult = await this.pool.query(
        'SELECT telegram_id FROM bot_users WHERE id = $1 LIMIT 1',
        [payment.bot_user_id]
      );
      const telegramId = botUserResult.rows[0]?.telegram_id;

      if (telegramId) {
        try {
          await this.pool.query(
            `INSERT INTO funnel_events (
              event_name, bot_id, bot_user_id, telegram_id, payment_id, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            ['pix_paid', payment.bot_id, payment.bot_user_id, telegramId, payment.id]
          );
        } catch (dbError) {
          console.error(`[ERRO][PAYMENT][PIX_PAID_EVENT] bot=${payment.bot_id} user=${payment.bot_user_id} error=${dbError.message}`);
        }
      }

      console.log(`[PAYMENT][WEBHOOK] PIX pago: payment_id=${payment.id} bot=${payment.bot_id} user=${payment.bot_user_id}`);

      return {
        success: true,
        processed: true,
        paymentId: payment.id
      };
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
