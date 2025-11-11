/**
 * Rotas de configuração detalhada de bots
 * GET /api/admin/bots/:id/config - obter configuração completa
 * PUT /api/admin/bots/:id/config/start - atualizar mensagem inicial
 * PUT /api/admin/bots/:id/config/downsells - atualizar regras de downsell
 * PUT /api/admin/bots/:id/config/shots - atualizar disparos
 * PUT /api/admin/bots/:id/config/integrations - atualizar integrações (UTMify, Facebook)
 * 
 * Diferente de "Editar" (modal rápido), Config é uma tela completa de negócio
 */

const express = require('express');
const router = express.Router();

/**
 * Obter configuração completa do bot
 * GET /api/admin/bots/:id/config
 */
router.get('/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const botId = parseInt(id, 10);

    // Buscar dados do bot
    const botResult = await req.pool.query(
      'SELECT id, slug, name, active, provider FROM bots WHERE id = $1',
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];

    // Buscar mensagem inicial (/start)
    const startMsgResult = await req.pool.query(
      `SELECT id, content FROM bot_messages 
       WHERE bot_id = $1 AND slug = 'start' AND active = TRUE 
       LIMIT 1`,
      [botId]
    );
    
    console.log(`[GET_CONFIG] Busca por bot_id=${botId}, slug='start', active=TRUE`);
    console.log(`[GET_CONFIG] Encontradas ${startMsgResult.rows.length} linhas`);

    // Normalizar dados da mensagem /start para estrutura nova
    let startConfig = null;
    if (startMsgResult.rows.length > 0) {
      const startMsg = startMsgResult.rows[0];
      let content;
      
      // Garantir que content é string
      let contentStr = typeof startMsg.content === 'string' ? startMsg.content : String(startMsg.content || '');
      
      try {
        // Tentar parsear como JSON
        content = JSON.parse(contentStr);
        console.log(`[GET_CONFIG] Content parseado:`, JSON.stringify(content).substring(0, 200));
      } catch (e) {
        // Se não for JSON válido, tratar como string simples
        content = { text: contentStr };
        console.log(`[GET_CONFIG] Content não é JSON, tratando como string`);
        console.log(`[GET_CONFIG] Content raw (primeiros 300 chars):`, contentStr.substring(0, 300));
        console.log(`[GET_CONFIG] Erro ao parsear:`, e.message);
      }
      
      // Garantir que messages é sempre um array de strings
      let messages = [];
      if (content.messages && Array.isArray(content.messages)) {
        // Converter cada item para string (em caso de objetos)
        messages = content.messages
          .map(msg => {
            if (typeof msg === 'string') return msg;
            if (typeof msg === 'object' && msg.text) return msg.text;
            return String(msg || '');
          })
          .filter(msg => msg && msg.trim());
      } else if (content.text) {
        messages = [String(content.text)];
      } else if (startMsg.content && typeof startMsg.content === 'string') {
        messages = [startMsg.content];
      }
      
      // Estrutura padrão para compatibilidade
      startConfig = {
        id: startMsg.id,
        messages: messages.length > 0 ? messages : [''],
        medias: Array.isArray(content.medias) ? content.medias : [],
        plans: Array.isArray(content.plans) ? content.plans : []
      };
      
      console.log(`[GET_CONFIG] startConfig retornando:`, {
        messages: startConfig.messages.length,
        medias: startConfig.medias.length,
        plans: startConfig.plans.length
      });
    }

    // Buscar downsells
    const downsellsResult = await req.pool.query(
      `SELECT id, slug, content, delay_seconds, active FROM bot_downsells 
       WHERE bot_id = $1 
       ORDER BY delay_seconds ASC`,
      [botId]
    );

    // Buscar shots
    const shotsResult = await req.pool.query(
      `SELECT id, slug, content, filter_criteria, active FROM shots 
       WHERE bot_id = $1 
       ORDER BY created_at DESC`,
      [botId]
    );

    // Buscar integrações (se houver tabela)
    // TODO: Buscar configurações de UTMify e Facebook CAPI quando tabela for criada

    const config = {
      bot: {
        id: bot.id,
        slug: bot.slug,
        name: bot.name,
        active: bot.active,
        provider: bot.provider
      },
      startMessage: startConfig,
      downsells: downsellsResult.rows,
      shots: shotsResult.rows,
      integrations: {
        utmify: null,
        facebook: null
      }
    };

    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao buscar config:', error);
    res.status(500).json({
      success: false,
      error: 'Falha ao buscar configuração'
    });
  }
});

/**
 * Atualizar mensagem inicial (/start)
 * PUT /api/admin/bots/:id/config/start
 * Body: { messages: [string], medias: [object], plans: [object] }
 */
router.put('/:id/config/start', async (req, res) => {
  try {
    const { id } = req.params;
    const { messages, medias, plans } = req.body;
    const botId = parseInt(id, 10);

    console.log(`[ADMIN_BOT_CONFIG] Recebido PUT /config/start: messages=${Array.isArray(messages) ? messages.length : 0} medias=${Array.isArray(medias) ? medias.length : 0} plans=${Array.isArray(plans) ? plans.length : 0}`);
    
    // Garantir que messages é sempre um array de strings
    let normalizedMessages = [];
    if (Array.isArray(messages)) {
      normalizedMessages = messages
        .map(msg => {
          if (typeof msg === 'string') return msg;
          if (typeof msg === 'object' && msg.text) return msg.text;
          return String(msg || '');
        })
        .filter(msg => msg && msg.trim());
    }

    // Validações
    if (!normalizedMessages || normalizedMessages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Pelo menos uma mensagem é obrigatória'
      });
    }

    if (normalizedMessages.length > 3) {
      return res.status(400).json({
        success: false,
        error: 'Máximo 3 mensagens permitidas'
      });
    }

    if (medias && medias.length > 3) {
      return res.status(400).json({
        success: false,
        error: 'Máximo 3 mídias permitidas'
      });
    }

    if (plans && plans.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Máximo 10 planos permitidos'
      });
    }

    // Validar planos
    if (plans && Array.isArray(plans)) {
      for (const plan of plans) {
        if (!plan.name || !plan.time || !plan.value || plan.value <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Todos os planos devem ter nome, tempo e valor maior que zero'
          });
        }
      }
    }

    // Estruturar dados para salvar
    const contentJson = JSON.stringify({
      messages: normalizedMessages,
      medias: medias || [],
      plans: plans || []
    });
    
    console.log(`[PUT_CONFIG_START] Salvando JSON:`, contentJson.substring(0, 200));

    // Buscar ou criar mensagem de start
    const existingResult = await req.pool.query(
      `SELECT id FROM bot_messages 
       WHERE bot_id = $1 AND slug = 'start' 
       LIMIT 1`,
      [botId]
    );

    let messageId;
    if (existingResult.rows.length > 0) {
      // Atualizar
      messageId = existingResult.rows[0].id;
      await req.pool.query(
        `UPDATE bot_messages 
         SET content = $1, updated_at = NOW() 
         WHERE id = $2`,
        [contentJson, messageId]
      );
    } else {
      // Criar
      const createResult = await req.pool.query(
        `INSERT INTO bot_messages (bot_id, slug, content, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id`,
        [botId, 'start', contentJson, true]
      );
      messageId = createResult.rows[0].id;
    }

    // TODO: Associar mídias quando tabela message_media for criada
    // As mídias já estão salvas no JSON da configuração

    console.log(`[ADMIN_BOT_CONFIG] Mensagem de start atualizada: bot=${botId} message=${messageId}`);

    res.status(200).json({
      success: true,
      data: { 
        messageId, 
        config: JSON.parse(contentJson)
      }
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao atualizar start:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Atualizar regras de downsell
 * PUT /api/admin/bots/:id/config/downsells
 * Body: { downsells: [{ id?, slug, content (string ou JSON), delay_seconds, active }] }
 */
router.put('/:id/config/downsells', async (req, res) => {
  try {
    const { id } = req.params;
    const { downsells } = req.body;
    const botId = parseInt(id, 10);

    if (!Array.isArray(downsells)) {
      return res.status(400).json({
        success: false,
        error: 'Downsells deve ser um array'
      });
    }

    const results = [];

    for (const downsell of downsells) {
      const { id: downsellId, slug, content, delay_seconds, active } = downsell;

      // Normalizar content para JSON válido
      let contentJson;
      if (typeof content === 'string') {
        contentJson = JSON.stringify({ text: content });
      } else if (typeof content === 'object') {
        contentJson = JSON.stringify(content);
      } else {
        contentJson = JSON.stringify({ text: String(content) });
      }

      if (downsellId) {
        // Atualizar
        await req.pool.query(
          `UPDATE bot_downsells 
           SET slug = $1, content = $2, delay_seconds = $3, active = $4, updated_at = NOW()
           WHERE id = $5 AND bot_id = $6`,
          [slug, contentJson, delay_seconds, active, downsellId, botId]
        );
        results.push({ id: downsellId, action: 'updated' });
      } else {
        // Criar
        const createResult = await req.pool.query(
          `INSERT INTO bot_downsells (bot_id, slug, content, delay_seconds, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          [botId, slug, contentJson, delay_seconds, active !== false]
        );
        results.push({ id: createResult.rows[0].id, action: 'created' });
      }
    }

    console.log(`[ADMIN_BOT_CONFIG] Downsells atualizados: bot=${botId} count=${results.length}`);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao atualizar downsells:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Atualizar disparos (shots)
 * PUT /api/admin/bots/:id/config/shots
 * Body: { shots: [{ id?, slug, content (string ou JSON), filter_criteria?, active }] }
 */
router.put('/:id/config/shots', async (req, res) => {
  try {
    const { id } = req.params;
    const { shots } = req.body;
    const botId = parseInt(id, 10);

    if (!Array.isArray(shots)) {
      return res.status(400).json({
        success: false,
        error: 'Shots deve ser um array'
      });
    }

    const results = [];

    for (const shot of shots) {
      const { id: shotId, slug, content, filter_criteria, active } = shot;

      // Normalizar content para JSON válido
      let contentJson;
      if (typeof content === 'string') {
        contentJson = JSON.stringify({ text: content });
      } else if (typeof content === 'object') {
        contentJson = JSON.stringify(content);
      } else {
        contentJson = JSON.stringify({ text: String(content) });
      }

      if (shotId) {
        // Atualizar
        await req.pool.query(
          `UPDATE shots 
           SET slug = $1, content = $2, filter_criteria = $3, active = $4, updated_at = NOW()
           WHERE id = $5 AND bot_id = $6`,
          [slug, contentJson, filter_criteria || null, active, shotId, botId]
        );
        results.push({ id: shotId, action: 'updated' });
      } else {
        // Criar
        const createResult = await req.pool.query(
          `INSERT INTO shots (bot_id, slug, content, filter_criteria, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          [botId, slug, contentJson, filter_criteria || null, active !== false]
        );
        results.push({ id: createResult.rows[0].id, action: 'created' });
      }
    }

    console.log(`[ADMIN_BOT_CONFIG] Shots atualizados: bot=${botId} count=${results.length}`);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao atualizar shots:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Atualizar integrações (UTMify, Facebook CAPI)
 * PUT /api/admin/bots/:id/config/integrations
 * Body: { utmify: {...}, facebook: {...} }
 * 
 * TODO: Criar tabela bot_integrations para armazenar configurações
 */
router.put('/:id/config/integrations', async (req, res) => {
  try {
    const { id } = req.params;
    const { utmify, facebook } = req.body;
    const botId = parseInt(id, 10);

    // TODO: Implementar quando tabela bot_integrations for criada
    // Por enquanto, apenas logar

    console.log(`[ADMIN_BOT_CONFIG] Integrações atualizadas: bot=${botId}`);

    res.status(200).json({
      success: true,
      message: 'Integrações preparadas para atualização (tabela ainda não criada)',
      data: { utmify, facebook }
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao atualizar integrações:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Preview da mensagem /start
 * POST /api/admin/bots/:id/start/preview
 * Body: { messages: [string], medias: [object], plans: [object] }
 * 
 * Envia um preview completo para o grupo de aquecimento
 */
router.post('/:id/start/preview', async (req, res) => {
  try {
    const axios = require('axios');
    const { id } = req.params;
    const { messages, medias, plans } = req.body;
    const botId = parseInt(id, 10);

    // Validações básicas
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Pelo menos uma mensagem é obrigatória para preview'
      });
    }

    // Buscar bot com token e warmup_chat_id
    const botResult = await req.pool.query(
      `SELECT id, slug, token_encrypted, warmup_chat_id, token_status 
       FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];

    // Verificar se bot tem token validado e warmup_chat_id configurado
    if (bot.token_status !== 'validated') {
      return res.status(400).json({
        success: false,
        error: 'Bot precisa ter token validado para fazer preview'
      });
    }

    if (!bot.warmup_chat_id) {
      return res.status(400).json({
        success: false,
        error: 'Bot precisa ter grupo de aquecimento configurado para fazer preview'
      });
    }

    // Descriptografar token
    const CryptoService = require('../modules/crypto-service');
    const cryptoService = new CryptoService();
    let botToken;
    try {
      botToken = cryptoService.decrypt(bot.token_encrypted);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Erro ao descriptografar token do bot'
      });
    }

    const startTime = Date.now();
    const telegramApiUrl = 'https://api.telegram.org';
    const chatId = bot.warmup_chat_id;
    const messageIds = [];
    const mediaIds = [];

    // Enviar mensagens de texto
    for (let i = 0; i < messages.length; i++) {
      try {
        // Garantir que message é string
        const messageText = typeof messages[i] === 'string' ? messages[i] : String(messages[i] || '');
        
        if (!messageText.trim()) {
          console.warn(`[ADMIN_BOT_CONFIG] Pulando mensagem vazia no índice ${i}`);
          continue;
        }
        
        const response = await axios.post(
          `${telegramApiUrl}/bot${botToken}/sendMessage`,
          {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML'
          },
          { timeout: 10000 }
        );
        if (response.data.ok) {
          messageIds.push(response.data.result.message_id);
        }
      } catch (error) {
        console.error(`[ADMIN_BOT_CONFIG] Erro ao enviar mensagem ${i + 1}:`, error.message);
      }
    }

    // Enviar mídias
    if (medias && Array.isArray(medias)) {
      for (let i = 0; i < medias.length; i++) {
        const media = medias[i];
        try {
          // Determinar o tipo de mídia (usar 'kind' ou 'type')
          const mediaKind = media.kind || media.type || 'document';
          const method = `send${mediaKind.charAt(0).toUpperCase() + mediaKind.slice(1)}`;
          const fileField = {
            photo: 'photo',
            video: 'video',
            audio: 'audio',
            document: 'document'
          }[mediaKind] || 'document';

          let response;
          
          // Se tiver file_id, usar diretamente; senão, usar URL
          if (media.tg_file_id) {
            // Usar file_id já capturado
            response = await axios.post(
              `${telegramApiUrl}/bot${botToken}/${method}`,
              {
                chat_id: chatId,
                [fileField]: media.tg_file_id,
                caption: media.caption || ''
              },
              { timeout: 10000 }
            );
            console.log(`[ADMIN_BOT_CONFIG] Mídia ${i + 1} enviada com file_id: ${mediaKind}`);
          } else if (media.url) {
            // Usar URL
            response = await axios.post(
              `${telegramApiUrl}/bot${botToken}/${method}`,
              {
                chat_id: chatId,
                [fileField]: media.url,
                caption: media.caption || ''
              },
              { timeout: 10000 }
            );
            console.log(`[ADMIN_BOT_CONFIG] Mídia ${i + 1} enviada com URL: ${mediaKind}`);
          } else {
            console.warn(`[ADMIN_BOT_CONFIG] Mídia ${i + 1} sem file_id ou URL: ${JSON.stringify(media)}`);
            continue;
          }

          if (response?.data?.ok) {
            mediaIds.push(response.data.result.message_id);
          } else {
            console.error(`[ADMIN_BOT_CONFIG] Resposta não-ok para mídia ${i + 1}:`, response?.data?.description);
          }
        } catch (error) {
          console.error(`[ADMIN_BOT_CONFIG] Erro ao enviar mídia ${i + 1}:`, error.message);
        }
      }
    }

    // Enviar planos como mensagem formatada
    let plansMessageId = null;
    if (plans && Array.isArray(plans) && plans.length > 0) {
      try {
        let plansText = '<b>📋 Planos Disponíveis:</b>\n\n';
        plans.forEach((plan, idx) => {
          const valueFormatted = (plan.value / 100).toFixed(2).replace('.', ',');
          plansText += `${idx + 1}. <b>${plan.name}</b>\n`;
          plansText += `   ⏱️ ${plan.time}\n`;
          plansText += `   💰 R$ ${valueFormatted}\n\n`;
        });

        const response = await axios.post(
          `${telegramApiUrl}/bot${botToken}/sendMessage`,
          {
            chat_id: chatId,
            text: plansText,
            parse_mode: 'HTML'
          },
          { timeout: 10000 }
        );

        if (response.data.ok) {
          plansMessageId = response.data.result.message_id;
        }
      } catch (error) {
        console.error('[ADMIN_BOT_CONFIG] Erro ao enviar planos:', error.message);
      }
    }

    const latency = Date.now() - startTime;

    console.log(`[ADMIN_BOT_CONFIG] ✓ Preview enviado: bot=${botId} messages=${messageIds.length} medias=${mediaIds.length} plans=${plansMessageId ? 1 : 0} latency=${latency}ms`);

    res.status(200).json({
      success: true,
      data: {
        bot_id: botId,
        messages_sent: messageIds.length,
        message_ids: messageIds,
        medias_sent: mediaIds.length,
        media_ids: mediaIds,
        plans_sent: plansMessageId ? 1 : 0,
        plans_message_id: plansMessageId,
        latency_ms: latency,
        warmup_chat_id: bot.warmup_chat_id,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao fazer preview:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
