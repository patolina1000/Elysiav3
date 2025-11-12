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

    // Buscar mensagem inicial (/start) - fonte única
    const startMsgResult = await req.pool.query(
      `SELECT id, content, active, updated_at FROM bot_messages 
       WHERE bot_id = $1 AND slug = 'start' AND active = TRUE 
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [botId]
    );
    
    // Normalizar dados da mensagem /start para estrutura nova
    let startConfig = null;
    if (startMsgResult.rows.length > 0) {
      const startMsg = startMsgResult.rows[0];
      let content;
      
      // Lidar com jsonb (já é objeto) ou string
      if (typeof startMsg.content === 'object' && startMsg.content !== null) {
        // PostgreSQL retornou jsonb como objeto JavaScript
        content = startMsg.content;
      } else if (typeof startMsg.content === 'string') {
        // Content é string (fallback)
        try {
          content = JSON.parse(startMsg.content);
        } catch (e) {
          console.warn('[CONFIG:GET:PARSE_FAILED]', JSON.stringify({
            row_id: startMsg.id,
            error: e.message
          }));
          content = { messages: [], medias: [], plans: [] };
        }
      } else {
        // Nulo ou inválido
        content = { messages: [], medias: [], plans: [] };
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
        plans: Array.isArray(content.plans) ? content.plans : [],
        media_mode: content.media_mode || 'group' // Retrocompatibilidade: padrão 'group'
      };
      
      console.log(`[GET_CONFIG] startConfig retornando:`, {
        messages: startConfig.messages.length,
        medias: startConfig.medias.length,
        plans: startConfig.plans.length,
        media_mode: startConfig.media_mode
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
 * Body: { messages: [string], medias: [object], plans: [object], media_mode: 'group'|'single' }
 */
router.put('/:id/config/start', async (req, res) => {
  try {
    const { id } = req.params;
    const { messages, medias, plans, media_mode } = req.body;
    const botId = parseInt(id, 10);

    console.log(`[ADMIN_BOT_CONFIG] Recebido PUT /config/start: messages=${Array.isArray(messages) ? messages.length : 0} medias=${Array.isArray(medias) ? medias.length : 0} plans=${Array.isArray(plans) ? plans.length : 0} media_mode=${media_mode}`);
    
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

    // Validar media_mode
    const validMediaMode = ['group', 'single'].includes(media_mode) ? media_mode : 'group';

    // Estruturar dados para salvar - shape canônico
    const contentJson = JSON.stringify({
      messages: normalizedMessages,
      medias: medias || [],
      plans: plans || [],
      media_mode: validMediaMode
    });

    // Buscar registro canônico (fonte única)
    const existingResult = await req.pool.query(
      `SELECT id FROM bot_messages 
       WHERE bot_id = $1 AND slug = 'start' AND active = TRUE
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [botId]
    );

    let messageId;
    if (existingResult.rows.length > 0) {
      // Atualizar registro existente
      messageId = existingResult.rows[0].id;
      await req.pool.query(
        `UPDATE bot_messages
         SET content = $1, active = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [contentJson, messageId]
      );
    } else {
      // Criar novo registro
      const createResult = await req.pool.query(
        `INSERT INTO bot_messages (bot_id, slug, content, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id`,
        [botId, 'start', contentJson, true]
      );
      messageId = createResult.rows[0].id;
    }

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
    const { id } = req.params;
    const { messages, medias, plans, media_mode, attach_text_as_caption } = req.body;
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

    // CP-7: Usar mesmo renderer do /start via MessageService
    const MessageService = require('../modules/message-service');
    const messageService = new MessageService(req.pool);

    const startTime = Date.now();
    const chatId = bot.warmup_chat_id;
    const messageIds = [];
    const mediaIds = [];

    // CP-7: Normalizar media_mode e attach_text_as_caption (mesmo que CP-1)
    let normalizedMediaMode = media_mode || 'group';
    if (normalizedMediaMode !== 'group' && normalizedMediaMode !== 'single') {
      normalizedMediaMode = 'group';
    }
    
    let normalizedAttachTextAsCaption = attach_text_as_caption;
    if (normalizedAttachTextAsCaption === undefined || normalizedAttachTextAsCaption === null) {
      normalizedAttachTextAsCaption = false;
    } else {
      normalizedAttachTextAsCaption = Boolean(normalizedAttachTextAsCaption);
    }

    // Preparar conteúdo renderizado (mesmo formato do /start)
    const renderedContent = {
      messages: messages,
      medias: medias || [],
      buttons: []
    };

    // Preparar payloads usando o mesmo renderer do /start
    const payloads = messageService.prepareTelegramPayloads(
      chatId,
      renderedContent,
      medias || [],
      normalizedMediaMode,
      normalizedAttachTextAsCaption
    );

    // Enviar todos os payloads
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      try {
        const response = await messageService.sendViaTelegramAPI(botToken, payload);
        if (response.ok) {
          if (response.message_ids) {
            mediaIds.push(...response.message_ids);
          } else if (response.message_id) {
            messageIds.push(response.message_id);
          }
        }
      } catch (error) {
        const errorStatus = error.response?.status;
        const errorBody = error.response?.data;
        console.error(`[PREVIEW:PAYLOAD_ERROR] Erro ao enviar payload ${i + 1}: status=${errorStatus} message=${error.message}`);
      }
    }

    // Enviar planos como mensagem formatada (se houver)
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

        const plansPayload = {
          chat_id: chatId,
          text: plansText,
          parse_mode: 'HTML'
        };

        const response = await messageService.sendViaTelegramAPI(botToken, plansPayload);
        if (response.ok && response.message_id) {
          plansMessageId = response.message_id;
        }
      } catch (error) {
        console.error('[PREVIEW:PLANS_ERROR] Erro ao enviar planos:', error.message);
      }
    }

    const latency = Date.now() - startTime;

    console.log(`[PREVIEW] ✓ Preview enviado: bot=${botId} messages=${messageIds.length} medias=${mediaIds.length} plans=${plansMessageId ? 1 : 0} media_mode=${normalizedMediaMode} latency=${latency}ms`);

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
        media_mode: normalizedMediaMode,
        attach_text_as_caption: normalizedAttachTextAsCaption,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[ERRO][PREVIEW] Falha ao fazer preview:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});
/**
 * Upload de mídia para warmup
 * POST /api/admin/bots/:id/media/upload
 * Body: FormData com { file, type, caption }
 * 
 * Fluxo:
 * 1. Receber arquivo (em memória ou buffer)
 * 2. Calcular SHA256 do arquivo
 * 3. Fazer warmup no warmup_chat_id
 * 4. Capturar tg_file_id da resposta
 * 5. Salvar em media_cache com status='ready'
 * 
 * Retorna: { success, data: { media_key, tg_file_id?, warmup_status } }
 */
router.post('/:id/media/upload', async (req, res) => {
  try {
    const axios = require('axios');
    const crypto = require('crypto');
    const { id } = req.params;
    const botId = parseInt(id, 10);
    const mediaType = req.body.type || 'document';
    const caption = req.body.caption || '';

    console.log(`[MEDIA_UPLOAD:START] bot=${botId}, type=${mediaType}, caption_len=${caption.length}`);

    // 1. Buscar bot com token e warmup_chat_id
    const botResult = await req.pool.query(
      `SELECT id, slug, token_encrypted, warmup_chat_id FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];

    // Validar warmup_chat_id
    if (!bot.warmup_chat_id) {
      console.warn(`[MEDIA_UPLOAD:NO_WARMUP] bot=${botId}`);
      return res.status(400).json({
        success: false,
        error: 'Grupo de aquecimento não configurado'
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

    // 2. Calcular SHA256 do arquivo (usar buffer do FormData)
    // Nota: req.body.file é um buffer quando enviado via FormData
    const fileBuffer = req.body.file;
    if (!fileBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo não fornecido'
      });
    }

    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    console.log(`[MEDIA_UPLOAD:SHA256] bot=${botId}, sha256=${sha256.substring(0, 16)}...`);

    // 3. Fazer warmup no warmup_chat_id
    const telegramApiUrl = 'https://api.telegram.org';
    const warmupChatId = bot.warmup_chat_id;
    const methodMap = {
      photo: 'sendPhoto',
      video: 'sendVideo',
      audio: 'sendAudio',
      document: 'sendDocument'
    };
    const method = methodMap[mediaType] || 'sendDocument';
    const fieldMap = {
      photo: 'photo',
      video: 'video',
      audio: 'audio',
      document: 'document'
    };
    const field = fieldMap[mediaType] || 'document';

    console.log(`[MEDIA_UPLOAD:WARMUP_START] bot=${botId}, method=${method}, chat_id=${warmupChatId}`);

    let tgFileId = null;
    let warmupStatus = 'error';

    try {
      // Usar FormData para enviar arquivo ao Telegram
      const FormData = require('form-data');
      const formData = new FormData();
      
      // Adicionar campos no FormData
      formData.append('chat_id', String(warmupChatId));
      formData.append(field, fileBuffer, { filename: 'media.jpg' });
      if (caption) {
        formData.append('caption', caption);
      }

      console.log(`[MEDIA_UPLOAD:FORM_DATA] Enviando para Telegram: method=${method}, field=${field}, fileSize=${fileBuffer.length}, chatId=${warmupChatId}`);

      const warmupResponse = await axios.post(
        `${telegramApiUrl}/bot${botToken}/${method}`,
        formData,
        {
          timeout: 15000,
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          validateStatus: () => true // Aceitar qualquer status para logar detalhes
        }
      );

      console.log(`[MEDIA_UPLOAD:WARMUP_RESPONSE] bot=${botId}, ok=${warmupResponse.data?.ok}, status=${warmupResponse.status}, hasResult=${!!warmupResponse.data?.result}`);
      console.log(`[MEDIA_UPLOAD:WARMUP_RESPONSE_FULL] result=${JSON.stringify(warmupResponse.data?.result)}`);

      if (warmupResponse.data && warmupResponse.data.ok && warmupResponse.data.result) {
        const result = warmupResponse.data.result;
        
        // Extrair file_id baseado no tipo de mídia
        // Para sendPhoto/sendVideo/sendAudio/sendDocument: result.photo/video/audio/document é um array
        // Para sendMediaGroup: result é um array de mensagens
        
        if (Array.isArray(result)) {
          // sendMediaGroup retorna array de mensagens
          tgFileId = result[0]?.photo?.[0]?.file_id || 
                     result[0]?.video?.file_id || 
                     result[0]?.audio?.file_id || 
                     result[0]?.document?.file_id;
        } else {
          // sendPhoto/sendVideo/sendAudio/sendDocument retorna uma mensagem
          // A mídia está em result.photo[], result.video, result.audio, result.document
          tgFileId = result.photo?.[result.photo.length - 1]?.file_id ||  // Usar a maior resolução
                     result.video?.file_id || 
                     result.audio?.file_id || 
                     result.document?.file_id;
        }
        
        if (tgFileId) {
          warmupStatus = 'ready';
          console.log(`[MEDIA_UPLOAD:WARMUP_OK] bot=${botId}, file_id=${tgFileId.substring(0, 20)}...`);
        } else {
          console.error(`[MEDIA_UPLOAD:WARMUP_NO_FILE_ID] bot=${botId}, result=${JSON.stringify(result).substring(0, 200)}`);
        }
      } else {
        const description = warmupResponse.data?.description || 'Resposta inválida do Telegram';
        console.error(`[MEDIA_UPLOAD:WARMUP_FAIL] bot=${botId}, description=${description}, response=${JSON.stringify(warmupResponse.data)}`);
      }
    } catch (warmupError) {
      const errorStatus = warmupError.response?.status;
      const errorBody = warmupError.response?.data;
      const errorMessage = warmupError.message;
      console.error(`[MEDIA_UPLOAD:WARMUP_CATCH_ERROR] bot=${botId}, status=${errorStatus}, error=${errorMessage}, body=${JSON.stringify(errorBody)}`);
      
      // Log adicional para debugging
      if (warmupError.response) {
        console.error(`[MEDIA_UPLOAD:WARMUP_ERROR_DETAILS] headers=${JSON.stringify(warmupError.response.headers)}`);
      }
    }

    // 4. Se warmup bem-sucedido, salvar em media_cache
    if (tgFileId) {
      try {
        await req.pool.query(
          `INSERT INTO media_cache (bot_slug, kind, sha256, tg_file_id, tg_file_unique_id, status, warmup_chat_id, warmup_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
           ON CONFLICT (bot_slug, kind, sha256) DO UPDATE SET
             tg_file_id = $4,
             status = $6,
             warmup_at = NOW(),
             updated_at = NOW()`,
          [bot.slug, mediaType, sha256, tgFileId, tgFileId, 'ready', warmupChatId]
        );
        console.log(`[MEDIA_UPLOAD:CACHE_SAVED] bot=${botId}, sha256=${sha256.substring(0, 16)}...`);
      } catch (cacheError) {
        console.error(`[MEDIA_UPLOAD:CACHE_ERROR] bot=${botId}, error=${cacheError.message}`);
        // Não falhar se cache falhar - warmup já foi bem-sucedido
      }
    }

    res.status(200).json({
      success: true,
      data: {
        media_key: sha256,
        tg_file_id: tgFileId,
        warmup_status: warmupStatus
      }
    });
  } catch (error) {
    console.error('[ERRO][MEDIA_UPLOAD]', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
