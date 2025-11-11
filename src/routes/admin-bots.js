/**
 * Rotas administrativas de bots
 * GET /api/admin/bots - listar
 * POST /api/admin/bots - criar
 * GET /api/admin/bots/:id - detalhes
 * PUT /api/admin/bots/:id - atualizar (slug, active, gateway_default, token)
 * DELETE /api/admin/bots/:id - deletar (soft delete)
 * POST /api/admin/bots/:id/activate - ativar
 * POST /api/admin/bots/:id/validate-token - validar token Telegram
 */

const express = require('express');
const router = express.Router();

/**
 * Listar todos os bots
 * GET /api/admin/bots?includeInactive=true
 */
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const bots = await req.botService.listBots(includeInactive);

    res.status(200).json({
      success: true,
      data: bots,
      count: bots.length
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao listar bots:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao listar bots'
    });
  }
});

/**
 * Criar novo bot
 * POST /api/admin/bots
 * Body: { slug, name, active?, provider? }
 */
router.post('/', async (req, res) => {
  try {
    const { slug, name, active, provider } = req.body;

    if (!slug && !name) {
      return res.status(400).json({
        success: false,
        error: 'Slug ou name é obrigatório'
      });
    }

    const bot = await req.botService.createBot({
      slug: slug || name,
      active,
      provider
    });

    res.status(201).json({
      success: true,
      data: bot
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao criar bot:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Buscar bot por ID
 * GET /api/admin/bots/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await req.botService.getBotById(parseInt(id, 10));

    if (!bot) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    res.status(200).json({
      success: true,
      data: bot
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao buscar bot:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao buscar bot'
    });
  }
});

/**
 * Atualizar bot
 * PUT /api/admin/bots/:id
 * Body: { name?, slug?, active?, gateway_default?, token?, warmup_chat_id? }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, active, gateway_default, token, warmup_chat_id } = req.body;
    const botId = parseInt(id, 10);

    // Atualizar warmup_chat_id se fornecido
    if (warmup_chat_id !== undefined) {
      await req.pool.query(
        'UPDATE bots SET warmup_chat_id = $1, updated_at = NOW() WHERE id = $2',
        [warmup_chat_id || null, botId]
      );
    }

    // Atualizar slug/name/active via updateBot
    if (name || slug) {
      await req.botService.updateBot(botId, {
        name,
        slug,
        active
      });
    } else if (active !== undefined) {
      // Se apenas active está sendo atualizado
      await req.botService.updateBot(botId, { active });
    }

    // Atualizar gateway_default e/ou token via updateBotTokenAndGateway
    if (gateway_default || token) {
      const bot = await req.botService.updateBotTokenAndGateway(botId, {
        gateway_default,
        token_encrypted: token, // Enviar como token_encrypted para criptografia
        active
      });

      return res.status(200).json({
        success: true,
        data: bot
      });
    }

    // Se apenas slug/name/active foram atualizados
    const bot = await req.botService.getBotById(botId);
    res.status(200).json({
      success: true,
      data: bot
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao atualizar bot:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Deletar bot (soft delete)
 * DELETE /api/admin/bots/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await req.botService.deleteBot(parseInt(id, 10));

    res.status(200).json({
      success: true,
      data: bot,
      message: 'Bot desativado com sucesso'
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao deletar bot:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Ativar bot
 * POST /api/admin/bots/:id/activate
 */
router.post('/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await req.botService.activateBot(parseInt(id, 10));

    res.status(200).json({
      success: true,
      data: bot,
      message: 'Bot ativado com sucesso'
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao ativar bot:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Validar token Telegram
 * POST /api/admin/bots/:id/validate-token
 * Body: { token: string }
 * 
 * Retorna:
 * - Sucesso: { ok: true, username, name, checked_at }
 * - Falha: { ok: false, code, message }
 */
router.post('/:id/validate-token', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.body;
    const botId = parseInt(id, 10);

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Token é obrigatório e deve ser uma string'
      });
    }

    // Validar token via Telegram
    const result = await req.botService.validateToken(botId, token);

    res.status(200).json({
      success: result.ok,
      data: result
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOTS] Falha ao validar token:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
