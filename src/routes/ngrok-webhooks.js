/**
 * Rotas de gerenciamento de webhooks do ngrok
 * GET /api/ngrok/status - Status do ngrok
 * POST /api/ngrok/register-webhook/:botId - Registrar webhook para um bot
 * GET /api/ngrok/webhook-info/:botId - Informações do webhook
 * DELETE /api/ngrok/webhook/:botId - Remover webhook
 */

const express = require('express');
const router = express.Router();
const { getCryptoService } = require('../modules/crypto-singleton');

/**
 * GET /api/ngrok/status
 * Obter status do ngrok e URL pública
 */
router.get('/status', async (req, res) => {
  try {
    if (!req.ngrokManager) {
      return res.status(503).json({
        success: false,
        error: 'NgrokManager não inicializado'
      });
    }

    const publicUrl = req.ngrokManager.getPublicUrl();
    if (!publicUrl) {
      return res.status(503).json({
        success: false,
        error: 'ngrok não está conectado'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        publicUrl,
        initialized: true
      }
    });
  } catch (error) {
    console.error('[NGROK_API] Erro ao obter status:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ngrok/register-webhook/:botId
 * Registrar webhook para um bot específico
 */
router.post('/register-webhook/:botId', async (req, res) => {
  try {
    if (!req.ngrokManager) {
      return res.status(503).json({
        success: false,
        error: 'NgrokManager não inicializado'
      });
    }

    const { botId } = req.params;

    // Buscar bot
    const botResult = await req.pool.query(
      `SELECT id, slug, token_encrypted FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];
    
    if (!bot.token_encrypted) {
      return res.status(400).json({
        success: false,
        error: 'Bot sem token configurado'
      });
    }

    // Descriptografar token
    const crypto = getCryptoService();
    const botToken = crypto.decrypt(bot.token_encrypted);
    
    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'Falha ao descriptografar token do bot'
      });
    }

    // Registrar webhook
    const webhookResult = await req.ngrokManager.registerTelegramWebhook(botToken, bot.slug);

    if (webhookResult.ok) {
      console.log(`[NGROK_API] Webhook registrado: bot=${bot.slug}`);
      res.status(200).json({
        success: true,
        data: {
          botId: bot.id,
          slug: bot.slug,
          webhookUrl: webhookResult.webhookUrl,
          description: webhookResult.description
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: webhookResult.error
      });
    }
  } catch (error) {
    console.error('[NGROK_API] Erro ao registrar webhook:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ngrok/webhook-info/:botId
 * Obter informações do webhook de um bot
 */
router.get('/webhook-info/:botId', async (req, res) => {
  try {
    if (!req.ngrokManager) {
      return res.status(503).json({
        success: false,
        error: 'NgrokManager não inicializado'
      });
    }

    const { botId } = req.params;

    // Buscar bot
    const botResult = await req.pool.query(
      `SELECT id, slug, token_encrypted FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];
    
    if (!bot.token_encrypted) {
      return res.status(400).json({
        success: false,
        error: 'Bot sem token configurado'
      });
    }

    // Descriptografar token
    const crypto = getCryptoService();
    const botToken = crypto.decrypt(bot.token_encrypted);
    
    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'Falha ao descriptografar token do bot'
      });
    }

    // Obter informações do webhook
    const webhookInfo = await req.ngrokManager.getTelegramWebhookInfo(botToken);

    if (webhookInfo.ok) {
      res.status(200).json({
        success: true,
        data: {
          botId: bot.id,
          slug: bot.slug,
          webhookInfo: webhookInfo.info
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: webhookInfo.error
      });
    }
  } catch (error) {
    console.error('[NGROK_API] Erro ao obter webhook info:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/ngrok/webhook/:botId
 * Remover webhook de um bot
 */
router.delete('/webhook/:botId', async (req, res) => {
  try {
    if (!req.ngrokManager) {
      return res.status(503).json({
        success: false,
        error: 'NgrokManager não inicializado'
      });
    }

    const { botId } = req.params;

    // Buscar bot
    const botResult = await req.pool.query(
      `SELECT id, slug, token_encrypted FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];
    
    if (!bot.token_encrypted) {
      return res.status(400).json({
        success: false,
        error: 'Bot sem token configurado'
      });
    }

    // Descriptografar token
    const crypto = getCryptoService();
    const botToken = crypto.decrypt(bot.token_encrypted);
    
    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'Falha ao descriptografar token do bot'
      });
    }

    // Remover webhook
    const removeResult = await req.ngrokManager.removeTelegramWebhook(botToken);

    if (removeResult.ok) {
      console.log(`[NGROK_API] Webhook removido: bot=${bot.slug}`);
      res.status(200).json({
        success: true,
        data: {
          botId: bot.id,
          slug: bot.slug,
          message: 'Webhook removido com sucesso'
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: removeResult.error
      });
    }
  } catch (error) {
    console.error('[NGROK_API] Erro ao remover webhook:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
