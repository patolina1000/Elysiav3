/**
 * PublicUrlManager - Gerenciador centralizado de URL pública
 * 
 * Responsabilidades:
 * - Fornecer URL base pública para webhooks (Telegram, PushinPay, etc.)
 * - Em desenvolvimento: usa ngrok (dinâmico)
 * - Em produção: usa domínio fixo do .env
 * 
 * Uso:
 * const publicUrlManager = require('./public-url-manager');
 * publicUrlManager.setNgrokManager(ngrokManager); // Injetar ngrok manager
 * const webhookUrl = publicUrlManager.buildWebhookUrl('/api/payments/webhook/pushinpay');
 */

class PublicUrlManager {
  constructor() {
    this.ngrokManager = null;
    this.productionBaseUrl = process.env.PUBLIC_BASE_URL || null;
    this.nodeEnv = process.env.NODE_ENV || 'development';
  }

  /**
   * Injetar NgrokManager (usado em desenvolvimento)
   */
  setNgrokManager(ngrokManager) {
    this.ngrokManager = ngrokManager;
  }

  /**
   * Obter URL base pública
   * - Em desenvolvimento: usa ngrok
   * - Em produção: usa PUBLIC_BASE_URL do .env
   */
  getBaseUrl() {
    // Produção: usar URL fixa do .env
    if (this.nodeEnv === 'production' && this.productionBaseUrl) {
      return this.productionBaseUrl;
    }

    // Desenvolvimento: usar ngrok
    if (this.ngrokManager) {
      const ngrokUrl = this.ngrokManager.getPublicUrl();
      if (ngrokUrl) {
        return ngrokUrl;
      }
    }

    // Fallback: tentar usar PUBLIC_BASE_URL mesmo em dev
    if (this.productionBaseUrl) {
      console.warn('[PUBLIC_URL] Usando PUBLIC_BASE_URL como fallback');
      return this.productionBaseUrl;
    }

    console.warn('[PUBLIC_URL] Nenhuma URL pública disponível');
    return null;
  }

  /**
   * Construir URL completa para webhook
   * @param {string} endpoint - Ex: '/api/payments/webhook/pushinpay'
   * @returns {string|null} URL completa ou null se não disponível
   */
  buildWebhookUrl(endpoint) {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return null;
    }

    // Garantir que endpoint começa com /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    return `${baseUrl}${normalizedEndpoint}`;
  }

  /**
   * Verificar se URL pública está disponível
   */
  isAvailable() {
    return this.getBaseUrl() !== null;
  }

  /**
   * Obter informações sobre fonte da URL
   */
  getInfo() {
    const baseUrl = this.getBaseUrl();
    const source = this.nodeEnv === 'production' 
      ? 'production_env' 
      : (this.ngrokManager?.getPublicUrl() ? 'ngrok' : 'fallback');

    return {
      available: baseUrl !== null,
      baseUrl,
      source,
      environment: this.nodeEnv
    };
  }
}

// Singleton
const publicUrlManager = new PublicUrlManager();

module.exports = publicUrlManager;
