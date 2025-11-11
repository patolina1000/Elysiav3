/**
 * Tracking Service
 * 
 * Responsabilidades:
 * - Registrar eventos de funil em funnel_events
 * - Preparar pontos de integração com Facebook CAPI
 * - Preparar pontos de integração com UTMify
 * 
 * Glossário de event_name (do blueprint):
 * - presell_view: Usuário viu presell (landing page)
 * - to_bot_click: Usuário clicou no link para entrar no bot
 * - bot_start: Usuário disparou /start no bot
 * - pix_created: PIX foi gerado para o usuário
 * - pix_paid: PIX foi pago com sucesso
 * - bot_interaction: Usuário interagiu com o bot (clique em botão, etc.)
 * - bot_session_end: (Futuro) Sessão do usuário no bot terminou
 */

class TrackingService {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
  }

  /**
   * Registrar evento de funil
   * 
   * Campos obrigatórios: eventName, telegramId
   * Campos opcionais: botId, botUserId, sessionId, paymentId, UTMs, fbp, fbc, meta
   */
  async trackEvent(eventData) {
    const {
      eventName,
      botId,
      botUserId,
      telegramId,
      sessionId,
      paymentId,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      fbp,
      fbc,
      meta
    } = eventData;

    // Validações básicas
    if (!eventName) {
      console.error('[ERRO][TRACKING] event_name é obrigatório');
      return false;
    }

    if (!telegramId) {
      console.error('[ERRO][TRACKING] telegram_id é obrigatório');
      return false;
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO funnel_events (
          event_name, bot_id, bot_user_id, telegram_id, session_id, payment_id,
          source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          fbp, fbc, meta, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        RETURNING id`,
        [
          eventName, botId, botUserId, telegramId, sessionId, paymentId,
          source, utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
          fbp, fbc, meta ? JSON.stringify(meta) : null
        ]
      );

      const eventId = result.rows[0]?.id;
      console.log(`[TRACKING][EVENT] event=${eventName} bot=${botId} user=${telegramId} event_id=${eventId}`);

      // Trigger integrações externas se necessário
      if (eventName === 'pix_paid' && paymentId) {
        await this.triggerPixPaidIntegrations(eventData);
      }

      return true;
    } catch (error) {
      console.error(`[ERRO][TRACKING] event=${eventName} user=${telegramId} error=${error.message}`);
      return false;
    }
  }

  /**
   * Trigger integrações quando PIX é pago
   * Prepara chamadas para UTMify e Facebook CAPI
   */
  async triggerPixPaidIntegrations(eventData) {
    const { paymentId, telegramId, botId } = eventData;

    try {
      // Buscar dados do pagamento para enviar para integrações
      const paymentResult = await this.pool.query(
        'SELECT * FROM payments WHERE id = $1 LIMIT 1',
        [paymentId]
      );

      if (paymentResult.rows.length === 0) {
        console.warn(`[TRACKING][PIX_PAID] Pagamento ${paymentId} não encontrado`);
        return;
      }

      const payment = paymentResult.rows[0];

      // Ponto de integração 1: UTMify (envio de pedido)
      await this.sendToUTMify(payment, eventData);

      // Ponto de integração 2: Facebook CAPI (evento de Purchase)
      await this.sendToFacebookCAPI(payment, eventData);

    } catch (error) {
      console.error(`[ERRO][TRACKING][PIX_PAID_INTEGRATIONS] error=${error.message}`);
    }
  }

  /**
   * Enviar evento para Facebook CAPI
   * 
   * Integração preparada para:
   * - Event: Purchase
   * - Dedupe: event_id
   * - Parâmetros: value, currency, content_name, content_type
   * 
   * Requer: FACEBOOK_CAPI_ACCESS_TOKEN e FACEBOOK_PIXEL_ID em .env
   */
  async sendToFacebookCAPI(payment, eventData) {
    // TODO: Implementar integração com Facebook CAPI
    // 1. Validar que FACEBOOK_CAPI_ACCESS_TOKEN e FACEBOOK_PIXEL_ID estão em config
    // 2. Preparar payload:
    //    {
    //      data: [{
    //        event_name: 'Purchase',
    //        event_time: Math.floor(Date.now() / 1000),
    //        event_id: `pix_paid_${payment.id}`,
    //        user_data: { phone: mascarado, email: mascarado },
    //        custom_data: {
    //          value: payment.amount_cents / 100,
    //          currency: 'BRL',
    //          content_name: payment.description,
    //          content_type: 'product'
    //        }
    //      }]
    //    }
    // 3. POST para https://graph.facebook.com/v18.0/{PIXEL_ID}/events
    // 4. Logar sucesso/erro

    console.log(`[TRACKING][FACEBOOK_CAPI] Ponto de integração preparado para payment_id=${payment.id}`);
  }

  /**
   * Enviar pedido para UTMify (em pix_paid)
   * 
   * Integração preparada para:
   * - Endpoint: /orders (POST)
   * - Parâmetros: order_id, amount, utm_source, utm_medium, utm_campaign, utm_content, utm_term
   * 
   * Requer: UTMIFY_API_KEY e UTMIFY_API_URL em .env
   */
  async sendToUTMify(payment, eventData) {
    // TODO: Implementar integração com UTMify
    // 1. Validar que UTMIFY_API_KEY e UTMIFY_API_URL estão em config
    // 2. Preparar payload:
    //    {
    //      order_id: payment.id,
    //      amount: payment.amount_cents / 100,
    //      utm_source: eventData.utmSource,
    //      utm_medium: eventData.utmMedium,
    //      utm_campaign: eventData.utmCampaign,
    //      utm_content: eventData.utmContent,
    //      utm_term: eventData.utmTerm
    //    }
    // 3. POST para {UTMIFY_API_URL}/orders com header Authorization: Bearer {UTMIFY_API_KEY}
    // 4. Logar sucesso/erro

    console.log(`[TRACKING][UTMIFY] Ponto de integração preparado para payment_id=${payment.id}`);
  }

  /**
   * Buscar eventos de funil para um usuário
   */
  async getUserFunnelEvents(telegramId, limit = 100) {
    try {
      const result = await this.pool.query(
        `SELECT event_name, bot_id, occurred_at, meta 
         FROM funnel_events 
         WHERE telegram_id = $1 
         ORDER BY occurred_at DESC 
         LIMIT $2`,
        [telegramId, limit]
      );

      return result.rows;
    } catch (error) {
      console.error(`[ERRO][TRACKING] Falha ao buscar eventos do usuário ${telegramId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Buscar eventos de funil para um bot
   */
  async getBotFunnelEvents(botId, eventName = null, limit = 1000) {
    try {
      let query = 'SELECT * FROM funnel_events WHERE bot_id = $1';
      const params = [botId];

      if (eventName) {
        query += ' AND event_name = $2';
        params.push(eventName);
      }

      query += ' ORDER BY occurred_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error(`[ERRO][TRACKING] Falha ao buscar eventos do bot ${botId}: ${error.message}`);
      return [];
    }
  }
}

module.exports = TrackingService;
