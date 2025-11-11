/**
 * NgrokManager - Gerenciador de URLs dinâmicas do ngrok
 * 
 * Responsabilidades:
 * - Detectar URL pública do ngrok automaticamente
 * - Armazenar URL em memória para uso em toda a aplicação
 * - Registrar webhooks do Telegram com URL dinâmica
 * - Atualizar webhooks quando ngrok URL muda
 * 
 * Uso:
 * const ngrokManager = new NgrokManager();
 * await ngrokManager.initialize();
 * const publicUrl = ngrokManager.getPublicUrl();
 */

const axios = require('axios');

class NgrokManager {
  constructor() {
    this.publicUrl = null;
    // Usar 127.0.0.1 em vez de localhost para evitar problemas com IPv6
    this.ngrokApiUrl = 'http://127.0.0.1:4040/api'; // API local do ngrok
    this.isInitialized = false;
  }

  /**
   * Inicializar e detectar URL pública do ngrok
   */
  async initialize() {
    try {
      // Tentar detectar URL do ngrok via API local
      const publicUrl = await this.detectPublicUrl();
      
      if (publicUrl) {
        this.publicUrl = publicUrl;
        this.isInitialized = true;
        console.log(`[NGROK] URL pública detectada: ${this.publicUrl}`);
        return true;
      } else {
        console.warn('[NGROK] Não foi possível detectar URL pública do ngrok');
        return false;
      }
    } catch (error) {
      console.error('[NGROK] Erro ao inicializar:', error.message);
      return false;
    }
  }

  /**
   * Detectar URL pública do ngrok via API local
   * ngrok expõe API em http://127.0.0.1:4040/api
   */
  async detectPublicUrl() {
    try {
      const response = await axios.get(`${this.ngrokApiUrl}/tunnels`, {
        timeout: 5000
      });

      if (response.data && response.data.tunnels && response.data.tunnels.length > 0) {
        console.log(`[NGROK] ${response.data.tunnels.length} tunnel(s) encontrado(s)`);
        
        // Procurar por tunnel HTTP (não HTTPS)
        const httpTunnel = response.data.tunnels.find(t => t.proto === 'http');
        if (httpTunnel && httpTunnel.public_url) {
          // Converter para HTTPS se necessário (Telegram exige HTTPS)
          return httpTunnel.public_url.replace('http://', 'https://');
        }
        
        // Se não encontrou HTTP, procurar por HTTPS
        const httpsTunnel = response.data.tunnels.find(t => t.proto === 'https');
        if (httpsTunnel && httpsTunnel.public_url) {
          return httpsTunnel.public_url;
        }
        
        console.warn('[NGROK] Tunnels encontrados mas nenhum é HTTP/HTTPS');
        console.warn('[NGROK] Tunnels:', response.data.tunnels.map(t => `${t.proto}://${t.public_url}`));
      } else {
        console.warn('[NGROK] Nenhum tunnel ativo. Certifique-se de que ngrok está rodando com: ngrok http 3000');
      }

      return null;
    } catch (error) {
      console.error('[NGROK] Erro ao conectar à API do ngrok:', error.message);
      console.error('[NGROK] URL tentada:', this.ngrokApiUrl);
      console.error('[NGROK] Solução: Inicie ngrok em outro terminal com: ngrok http 3000');
      return null;
    }
  }

  /**
   * Obter URL pública atual
   */
  getPublicUrl() {
    if (!this.publicUrl) {
      console.warn('[NGROK] URL pública não foi inicializada');
      return null;
    }
    return this.publicUrl;
  }

  /**
   * Registrar webhook do Telegram com URL dinâmica
   * botToken: token do bot Telegram
   * slug: slug do bot (ex: 'vipshadriee_bot')
   */
  async registerTelegramWebhook(botToken, slug) {
    try {
      if (!this.publicUrl) {
        throw new Error('URL pública do ngrok não foi inicializada');
      }

      const webhookUrl = `${this.publicUrl}/tg/${slug}/webhook`;
      
      const response = await axios.post(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query']
        },
        { timeout: 10000 }
      );

      if (response.data.ok) {
        console.log(`[NGROK][TELEGRAM] Webhook registrado: bot=${slug} url=${webhookUrl}`);
        return {
          ok: true,
          webhookUrl,
          description: response.data.description
        };
      } else {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }
    } catch (error) {
      console.error(`[NGROK][TELEGRAM] Erro ao registrar webhook: bot=${slug} error=${error.message}`);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Obter informações do webhook do Telegram
   * botToken: token do bot Telegram
   */
  async getTelegramWebhookInfo(botToken) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
        { timeout: 10000 }
      );

      if (response.data.ok) {
        return {
          ok: true,
          info: response.data.result
        };
      } else {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }
    } catch (error) {
      console.error(`[NGROK][TELEGRAM] Erro ao obter webhook info: error=${error.message}`);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Remover webhook do Telegram
   * botToken: token do bot Telegram
   */
  async removeTelegramWebhook(botToken) {
    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        { url: '' },
        { timeout: 10000 }
      );

      if (response.data.ok) {
        console.log('[NGROK][TELEGRAM] Webhook removido');
        return { ok: true };
      } else {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }
    } catch (error) {
      console.error(`[NGROK][TELEGRAM] Erro ao remover webhook: error=${error.message}`);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Construir URL completa para um endpoint
   * endpoint: ex '/api/admin/bots'
   */
  buildFullUrl(endpoint) {
    if (!this.publicUrl) {
      return null;
    }
    return `${this.publicUrl}${endpoint}`;
  }
}

module.exports = NgrokManager;
