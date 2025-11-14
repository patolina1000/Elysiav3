/**
 * PushinPay Gateway Adapter
 * 
 * Implementa interface de gateway de pagamento para PushinPay
 * 
 * Endpoints:
 * - POST /pix/cashIn - Criar cobrança PIX
 * 
 * Webhook:
 * - Recebe notificações de status de pagamento
 * 
 * Documentação: pushinpay.md
 */

const axios = require('axios');
const publicUrlManager = require('../public-url-manager');

class PushinPayAdapter {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.PUSHINPAY_TOKEN;
    this.baseUrl = config.baseUrl || process.env.PUSHINPAY_BASE_URL || 'https://api.pushinpay.com.br/api';
    
    // Validar configuração
    if (!this.apiKey) {
      console.warn('[PUSHINPAY] Token não configurado. Defina PUSHINPAY_TOKEN no .env');
    }
  }

  /**
   * Obter webhook_url dinâmica
   * - Em desenvolvimento: usa ngrok
   * - Em produção: usa PUBLIC_BASE_URL
   */
  getWebhookUrl() {
    const webhookUrl = publicUrlManager.buildWebhookUrl('/api/payments/webhook/pushinpay');
    
    if (!webhookUrl) {
      console.warn('[PUSHINPAY] URL pública não disponível. Webhook não será configurado.');
    }
    
    return webhookUrl;
  }

  /**
   * Criar cobrança PIX
   * 
   * @param {Object} params
   * @param {number} params.valueCents - Valor em centavos (mínimo 50)
   * @param {string} params.botSlug - Slug do bot
   * @param {string} params.telegramId - ID do usuário no Telegram
   * @param {string} params.planName - Nome do plano
   * @param {Object} params.metadata - Metadados adicionais
   * @returns {Promise<Object>} Resultado da criação
   */
  async createCharge(params) {
    const startTime = Date.now();
    const { valueCents, botSlug, telegramId, planName, metadata = {} } = params;

    try {
      // Validar valor mínimo (50 centavos)
      if (valueCents < 50) {
        throw new Error(`Valor mínimo é 50 centavos. Recebido: ${valueCents}`);
      }

      // Obter webhook_url dinâmica
      const webhookUrl = this.getWebhookUrl();

      // Preparar payload
      const payload = {
        value: valueCents,
        split_rules: [] // Vazio por enquanto, pode ser configurado depois
      };

      // Adicionar webhook_url apenas se disponível
      if (webhookUrl) {
        payload.webhook_url = webhookUrl;
      } else {
        console.warn(`[PUSHINPAY][CREATE_CHARGE] Webhook URL não disponível. PIX será criado sem webhook.`);
      }

      // Headers obrigatórios
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      console.log(`[PUSHINPAY][CREATE_CHARGE] bot=${botSlug} user=${telegramId} value=${valueCents} plan=${planName}`);

      // Fazer requisição
      const response = await axios.post(
        `${this.baseUrl}/pix/cashIn`,
        payload,
        { 
          headers,
          timeout: 10000, // 10s timeout
          validateStatus: (status) => status < 500 // Não lançar erro em 4xx
        }
      );

      const duration = Date.now() - startTime;

      // Tratar resposta de sucesso (200)
      if (response.status === 200 && response.data) {
        const data = response.data;
        
        console.log(`[PUSHINPAY][CREATE_CHARGE_SUCCESS] bot=${botSlug} user=${telegramId} charge_id=${data.id} latency=${duration}ms`);

        return {
          success: true,
          chargeId: data.id,
          qrCode: data.qr_code,
          qrCodeBase64: data.qr_code_base64,
          status: data.status, // 'created', 'paid', 'expired'
          valueCents: data.value,
          expiresAt: null, // PushinPay não retorna expires_at explicitamente
          duration
        };
      }

      // Tratar erros 4xx
      if (response.status >= 400 && response.status < 500) {
        const errorMsg = this._parseErrorMessage(response);
        console.error(`[PUSHINPAY][CREATE_CHARGE_ERROR] bot=${botSlug} user=${telegramId} status=${response.status} error=${errorMsg} latency=${duration}ms`);
        
        return {
          success: false,
          error: errorMsg,
          errorCode: response.status,
          duration
        };
      }

      // Erro inesperado
      throw new Error(`Status inesperado: ${response.status}`);

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Erro de rede ou timeout
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        console.error(`[PUSHINPAY][CREATE_CHARGE_TIMEOUT] bot=${botSlug} user=${telegramId} latency=${duration}ms`);
        return {
          success: false,
          error: 'Timeout ao criar cobrança PIX. Tente novamente.',
          errorCode: 'TIMEOUT',
          duration
        };
      }

      // Erro de conexão
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error(`[PUSHINPAY][CREATE_CHARGE_CONNECTION_ERROR] bot=${botSlug} user=${telegramId} error=${error.code} latency=${duration}ms`);
        return {
          success: false,
          error: 'Erro de conexão com gateway de pagamento.',
          errorCode: 'CONNECTION_ERROR',
          duration
        };
      }

      // Outros erros
      console.error(`[PUSHINPAY][CREATE_CHARGE_EXCEPTION] bot=${botSlug} user=${telegramId} error=${error.message} latency=${duration}ms`);
      return {
        success: false,
        error: error.message,
        errorCode: 'EXCEPTION',
        duration
      };
    }
  }

  /**
   * Processar webhook de pagamento
   * 
   * @param {Object} payload - Payload do webhook
   * @returns {Object} Dados normalizados do webhook
   */
  handleWebhook(payload) {
    try {
      // Estrutura esperada do webhook PushinPay:
      // {
      //   id: "9c29870c-9f69-4bb6-90d3-2dce9453bb45",
      //   status: "paid" | "created" | "expired" | "canceled",
      //   value: 35,
      //   end_to_end_id: "...",
      //   payer_name: "...",
      //   payer_national_registration: "..."
      // }

      const chargeId = payload.id;
      const status = payload.status;
      const valueCents = payload.value;

      if (!chargeId || !status) {
        console.warn('[PUSHINPAY][WEBHOOK] Payload inválido: faltam campos obrigatórios');
        return {
          valid: false,
          error: 'Payload inválido'
        };
      }

      console.log(`[PUSHINPAY][WEBHOOK] charge_id=${chargeId} status=${status} value=${valueCents}`);

      return {
        valid: true,
        chargeId,
        status,
        valueCents,
        payerName: payload.payer_name || null,
        payerDocument: payload.payer_national_registration || null,
        endToEndId: payload.end_to_end_id || null
      };

    } catch (error) {
      console.error(`[PUSHINPAY][WEBHOOK_PARSE_ERROR] error=${error.message}`);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Validar assinatura do webhook (opcional)
   * PushinPay suporta header customizado configurado no painel
   * 
   * @param {Object} payload - Payload do webhook
   * @param {Object} headers - Headers da requisição
   * @returns {boolean} True se válido
   */
  validateWebhookSignature(payload, headers) {
    // TODO: Implementar validação de assinatura se configurado
    // Por enquanto, retornar true (aceitar todos)
    return true;
  }

  /**
   * Parsear mensagem de erro da API
   * 
   * @param {Object} response - Resposta do axios
   * @returns {string} Mensagem de erro em PT-BR
   */
  _parseErrorMessage(response) {
    const status = response.status;
    const data = response.data;

    // Erros conhecidos
    const errorMessages = {
      400: 'Requisição inválida. Verifique os dados enviados.',
      401: 'Token de autenticação inválido.',
      403: 'Acesso negado. Verifique permissões.',
      404: 'Recurso não encontrado.',
      422: 'Dados inválidos. Verifique valor mínimo (50 centavos).',
      429: 'Muitas requisições. Aguarde alguns segundos.',
      500: 'Erro interno do gateway. Tente novamente mais tarde.',
      503: 'Gateway temporariamente indisponível.'
    };

    // Tentar extrair mensagem específica do payload
    if (data && data.message) {
      return data.message;
    }

    // Tentar extrair erros de validação
    if (data && data.errors) {
      const firstError = Object.values(data.errors)[0];
      if (Array.isArray(firstError) && firstError.length > 0) {
        return firstError[0];
      }
    }

    // Mensagem padrão por status
    return errorMessages[status] || `Erro desconhecido (${status})`;
  }
}

module.exports = PushinPayAdapter;
