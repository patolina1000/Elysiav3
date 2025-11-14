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
const MessageService = require('../modules/message-service');
const ShotScheduler = require('../modules/shot-scheduler');

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
      
      let mediaMode = content.media_mode;
      if (mediaMode === undefined || mediaMode === null) {
        mediaMode = 'group';
      } else if (!['group', 'single'].includes(mediaMode)) {
        mediaMode = 'group';
      }

      const attachTextAsCaption = Boolean(content.attach_text_as_caption);

      // Estrutura padrão para compatibilidade
      startConfig = {
        id: startMsg.id,
        messages: messages.length > 0 ? messages : [''],
        medias: Array.isArray(content.medias) ? content.medias : [],
        plans: Array.isArray(content.plans) ? content.plans : [],
        media_mode: mediaMode,
        attach_text_as_caption: attachTextAsCaption,
        plan_layout: content.plan_layout === 'list' ? 'list' : 'adjacent',
        plan_columns: (() => {
          const columns = parseInt(content.plan_columns ?? content.planColumns ?? 2, 10);
          return columns === 3 ? 3 : 2;
        })()
      };

      console.log(`[GET_CONFIG] startConfig retornando:`, {
        messages: startConfig.messages.length,
        medias: startConfig.medias.length,
        plans: startConfig.plans.length,
        media_mode: startConfig.media_mode,
        attach_text_as_caption: startConfig.attach_text_as_caption
      });
    }

    // Buscar downsells
    const downsellsResult = await req.pool.query(
      `SELECT id, slug, content, delay_seconds, active, trigger_type FROM bot_downsells 
       WHERE bot_id = $1 
       ORDER BY delay_seconds ASC`,
      [botId]
    );

    // Buscar shots
    // Nota: Todos os shots (imediatos e agendados) são deletados após execução
    // Apenas shots pendentes de disparo ficam visíveis na UI
    const shotsResult = await req.pool.query(
      `SELECT id, slug, content, filter_criteria, active, trigger_type, schedule_type, scheduled_at 
       FROM shots 
       WHERE bot_id = $1 
       ORDER BY created_at DESC`,
      [botId]
    );

    // Parsear content dos shots (JSONB vem como string em alguns drivers)
    const shots = shotsResult.rows.map(shot => ({
      ...shot,
      content: typeof shot.content === 'string' ? JSON.parse(shot.content) : shot.content
    }));

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
      shots,
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
    const {
      messages,
      medias,
      plans,
      media_mode,
      attach_text_as_caption,
      plan_layout,
      plan_columns
    } = req.body;
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
    let normalizedMediaMode = media_mode;
    if (normalizedMediaMode === undefined || normalizedMediaMode === null) {
      normalizedMediaMode = 'group';
    } else if (!['group', 'single'].includes(normalizedMediaMode)) {
      normalizedMediaMode = 'group';
    }

    let normalizedAttachTextAsCaption = attach_text_as_caption;
    if (normalizedAttachTextAsCaption === undefined || normalizedAttachTextAsCaption === null) {
      normalizedAttachTextAsCaption = false;
    } else {
      normalizedAttachTextAsCaption = normalizedAttachTextAsCaption === true || normalizedAttachTextAsCaption === 'true';
    }

    const normalizedPlanLayout = plan_layout === 'list' ? 'list' : 'adjacent';
    let normalizedPlanColumns = parseInt(plan_columns ?? 2, 10);
    if (normalizedPlanColumns !== 3) {
      normalizedPlanColumns = 2;
    }

    // Estruturar dados para salvar - shape canônico
    const contentJson = JSON.stringify({
      messages: normalizedMessages,
      medias: medias || [],
      plans: plans || [],
      media_mode: normalizedMediaMode,
      attach_text_as_caption: normalizedAttachTextAsCaption,
      plan_layout: normalizedPlanLayout,
      plan_columns: normalizedPlanColumns
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

    MessageService.invalidateStartConfigCache(botId);
    console.info(`START_CONFIG:CACHE_INVALIDATED { botId:${botId} }`);

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
 * Body: { downsells: [{ id?, slug, name?, content (string ou JSON), delay_seconds, active, trigger_type }] }
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

    // Se array vazio, deletar todos os downsells do bot
    if (downsells.length === 0) {
      await req.pool.query(
        'DELETE FROM bot_downsells WHERE bot_id = $1',
        [botId]
      );
      console.log(`[ADMIN_BOT_CONFIG] Todos downsells deletados: bot=${botId}`);
      return res.status(200).json({
        success: true,
        data: [],
        deleted: true
      });
    }

    // Buscar IDs existentes no banco
    const existingResult = await req.pool.query(
      'SELECT id FROM bot_downsells WHERE bot_id = $1',
      [botId]
    );
    const existingIds = new Set(existingResult.rows.map(r => r.id));
    const receivedIds = new Set(downsells.filter(d => d.id).map(d => d.id));

    // Deletar downsells que não estão mais no array recebido
    const idsToDelete = [...existingIds].filter(id => !receivedIds.has(id));
    if (idsToDelete.length > 0) {
      await req.pool.query(
        'DELETE FROM bot_downsells WHERE id = ANY($1) AND bot_id = $2',
        [idsToDelete, botId]
      );
      console.log(`[ADMIN_BOT_CONFIG] Downsells deletados: bot=${botId} ids=${idsToDelete.join(',')}`);
    }

    const results = [];

    for (const downsell of downsells) {
      const { id: downsellId, slug, name, content, delay_seconds, active, trigger_type } = downsell;
      
      // Validar e normalizar trigger_type
      const normalizedTriggerType = (trigger_type === 'pix') ? 'pix' : 'start';

      // Gerar name se não fornecido (usar slug como fallback)
      const downsellName = name || slug || `Downsell ${Date.now()}`;

      // LOG: Ver o que está chegando do frontend
      console.log('[ADMIN_BOT_CONFIG][DOWNSELL][RECEIVED]', JSON.stringify({
        slug,
        contentType: typeof content,
        hasText: content?.text ? 'YES' : 'NO',
        hasMedias: content?.medias ? 'YES' : 'NO',
        mediasCount: content?.medias?.length || 0,
        hasPlans: content?.plans ? 'YES' : 'NO',
        plansCount: content?.plans?.length || 0
      }));

      // Normalizar content para JSON válido
      let contentJson;
      if (typeof content === 'string') {
        contentJson = JSON.stringify({ text: content });
      } else if (typeof content === 'object') {
        contentJson = JSON.stringify(content);
      } else {
        contentJson = JSON.stringify({ text: String(content) });
      }

      // LOG: Ver o que será salvo no banco
      const contentParsed = JSON.parse(contentJson);
      console.log('[ADMIN_BOT_CONFIG][DOWNSELL][SAVING]', JSON.stringify({
        slug,
        hasText: contentParsed.text ? 'YES' : 'NO',
        hasMedias: contentParsed.medias ? 'YES' : 'NO',
        mediasCount: contentParsed.medias?.length || 0,
        hasPlans: contentParsed.plans ? 'YES' : 'NO',
        plansCount: contentParsed.plans?.length || 0
      }));

      if (downsellId) {
        // Atualizar
        await req.pool.query(
          `UPDATE bot_downsells 
           SET slug = $1, name = $2, content = $3, delay_seconds = $4, active = $5, trigger_type = $6, updated_at = NOW()
           WHERE id = $7 AND bot_id = $8`,
          [slug, downsellName, contentJson, delay_seconds, active, normalizedTriggerType, downsellId, botId]
        );
        results.push({ id: downsellId, slug, name: downsellName, trigger_type: normalizedTriggerType, updated: true });
      } else {
        // Criar
        const createResult = await req.pool.query(
          `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           RETURNING id`,
          [botId, slug, downsellName, contentJson, delay_seconds, active !== false, normalizedTriggerType]
        );
        results.push({ id: createResult.rows[0].id, slug, name: downsellName, trigger_type: normalizedTriggerType, created: true });
      }
    }

    console.log(`[ADMIN_BOT_CONFIG] Downsells atualizados: bot=${botId} count=${results.length} deleted=${idsToDelete.length}`);

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
 * Body: { shots: [{ id?, slug, content (string ou JSON), filter_criteria?, active, trigger_type?, schedule_type?, scheduled_at? }] }
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
      const { 
        id: shotId, 
        slug, 
        content, 
        filter_criteria, 
        active,
        trigger_type,
        schedule_type,
        scheduled_at
      } = shot;

      // Normalizar content para JSON válido
      let contentJson;
      if (typeof content === 'string') {
        contentJson = JSON.stringify({ text: content });
      } else if (typeof content === 'object') {
        contentJson = JSON.stringify(content);
      } else {
        contentJson = JSON.stringify({ text: String(content) });
      }

      // Normalizar trigger_type e schedule_type
      const normalizedTriggerType = trigger_type || 'start';
      const normalizedScheduleType = schedule_type || 'immediate';
      const normalizedScheduledAt = scheduled_at || null;

      // Normalizar filter_criteria para JSONB (pode ser string ou objeto)
      let filterCriteriaJson = null;
      if (filter_criteria) {
        if (typeof filter_criteria === 'string') {
          try {
            filterCriteriaJson = JSON.parse(filter_criteria);
          } catch (e) {
            // Se não for JSON válido, ignorar (deixar null)
            filterCriteriaJson = null;
          }
        } else if (typeof filter_criteria === 'object') {
          filterCriteriaJson = filter_criteria;
        }
      }

      let finalShotId;

      if (shotId) {
        // Atualizar
        await req.pool.query(
          `UPDATE shots 
           SET slug = $1, content = $2, filter_criteria = $3, active = $4, 
               trigger_type = $5, schedule_type = $6, scheduled_at = $7, updated_at = NOW()
           WHERE id = $8 AND bot_id = $9`,
          [slug, contentJson, filterCriteriaJson, active, 
           normalizedTriggerType, normalizedScheduleType, normalizedScheduledAt,
           shotId, botId]
        );
        finalShotId = shotId;
        results.push({ id: shotId, action: 'updated' });
      } else {
        // Criar
        const createResult = await req.pool.query(
          `INSERT INTO shots (bot_id, slug, title, content, filter_criteria, active, 
                              trigger_type, schedule_type, scheduled_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
           RETURNING id`,
          [botId, slug, slug, contentJson, filterCriteriaJson, active !== false,
           normalizedTriggerType, normalizedScheduleType, normalizedScheduledAt]
        );
        finalShotId = createResult.rows[0].id;
        results.push({ id: finalShotId, action: 'created' });
      }

      // Se shot é imediato e ativo, criar jobs na fila
      // NOTA: Shot será deletado pelo broadcast após envio completo
      if (normalizedScheduleType === 'immediate' && active) {
        console.log('[SHOT][SAVE] Criando jobs para shot imediato', { shotId: finalShotId, botId });
        const scheduler = new ShotScheduler(req.pool);
        const queueResult = await scheduler.createImmediateJobs(finalShotId, botId);
        console.log('[SHOT][SAVE][QUEUE_RESULT]', { 
          shotId: finalShotId, 
          queued: queueResult.queued, 
          skipped: queueResult.skipped 
        });
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
 * Deletar um shot específico
 * DELETE /api/admin/bots/:id/config/shots/:shotId
 */
router.delete('/:id/config/shots/:shotId', async (req, res) => {
  try {
    const { id, shotId } = req.params;
    const botId = parseInt(id, 10);
    const shotIdNum = parseInt(shotId, 10);

    // Deletar o shot do banco de dados
    const result = await req.pool.query(
      'DELETE FROM shots WHERE id = $1 AND bot_id = $2 RETURNING id',
      [shotIdNum, botId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shot não encontrado'
      });
    }

    console.log(`[ADMIN_BOT_CONFIG] Shot deletado: bot=${botId} shotId=${shotIdNum}`);

    res.status(200).json({
      success: true,
      data: { id: shotIdNum, deleted: true }
    });
  } catch (error) {
    console.error('[ERRO][ADMIN_BOT_CONFIG] Falha ao deletar shot:', error);
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
    const {
      messages,
      medias,
      plans,
      media_mode,
      attach_text_as_caption,
      plan_layout,
      plan_columns
    } = req.body;
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

    const messageService = new MessageService(req.pool);

    const startTime = Date.now();
    const chatId = bot.warmup_chat_id;
    const messageIds = [];
    const mediaIds = [];

    let normalizedMediaMode = media_mode;
    if (normalizedMediaMode === undefined || normalizedMediaMode === null) {
      normalizedMediaMode = 'group';
    } else if (!['group', 'single'].includes(normalizedMediaMode)) {
      normalizedMediaMode = 'group';
    }

    let normalizedAttachTextAsCaption = attach_text_as_caption;
    if (normalizedAttachTextAsCaption === undefined || normalizedAttachTextAsCaption === null) {
      normalizedAttachTextAsCaption = false;
    } else {
      normalizedAttachTextAsCaption = normalizedAttachTextAsCaption === true || normalizedAttachTextAsCaption === 'true';
    }

    const resolvedMedias = await messageService.mediaResolver.resolveMedias(
      bot.slug,
      Array.isArray(medias) ? medias : []
    );

    // Renderizar conteúdo igual ao /start para 100% fidelidade
    const templateForRender = {
      content: {
        messages: Array.isArray(messages) ? messages : [],
        medias: resolvedMedias,
        buttons: [],
        plans: Array.isArray(plans) ? plans : [],
        planLayout: plan_layout,
        planColumns: plan_columns
      }
    };

    const previewContext = {
      userName: 'Preview User',
      botName: bot.name || 'Bot Preview',
      userId: 'preview'
    };

    const renderedContent = messageService.renderContent(templateForRender, previewContext);

    const payloads = messageService.prepareTelegramPayloads(
      botId,
      chatId,
      renderedContent,
      resolvedMedias,
      normalizedMediaMode,
      normalizedAttachTextAsCaption,
      { origin: 'preview' }
    );

    const dispatchResult = await messageService.dispatchPayloads(botToken, payloads, { origin: 'preview' });

    let plansMessageId = null;

    dispatchResult.responses.forEach(response => {
      if (!response || !response.ok) {
        return;
      }

      if (response.message_ids && Array.isArray(response.message_ids)) {
        mediaIds.push(...response.message_ids);
      } else if (response.message_id) {
        messageIds.push(response.message_id);
      }

      if (!plansMessageId && response.meta && response.meta.planCarrier && response.message_id) {
        plansMessageId = response.message_id;
      } else if (!plansMessageId && response.meta && response.meta.planCarrier && Array.isArray(response.message_ids) && response.message_ids.length > 0) {
        plansMessageId = response.message_ids[0];
      }
    });

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

/**
 * Listar usuários pagantes de um bot
 * GET /api/admin/bots/:id/users
 */
router.get('/:id/users', async (req, res) => {
  try {
    const { id } = req.params;
    const botId = parseInt(id, 10);

    if (isNaN(botId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do bot inválido'
      });
    }

    // Buscar pagamentos com status paid ou refunded, ordenados do mais recente para o mais antigo
    const result = await req.pool.query(
      `SELECT 
        p.id,
        p.customer_first_name,
        p.customer_last_name,
        p.value_cents,
        p.source_kind,
        p.source_slug,
        p.status,
        p.paid_at,
        p.created_at,
        bu.telegram_id
       FROM payments p
       LEFT JOIN bot_users bu ON p.bot_user_id = bu.id
       WHERE p.bot_id = $1 
         AND p.status IN ('paid', 'refunded')
       ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
       LIMIT 1000`,
      [botId]
    );

    // Formatar dados para o frontend
    const users = result.rows.map(row => {
      const firstName = row.customer_first_name || '';
      const lastName = row.customer_last_name || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'Nome não disponível';
      
      // Formatar origem
      let origin = 'Desconhecido';
      if (row.source_kind === 'start') {
        origin = '/start';
      } else if (row.source_kind === 'downsell') {
        origin = `Downsell: ${row.source_slug || 'N/A'}`;
      } else if (row.source_kind === 'shot') {
        origin = `Shot: ${row.source_slug || 'N/A'}`;
      }

      return {
        id: row.id,
        fullName,
        firstName,
        lastName,
        valueCents: row.value_cents,
        valueFormatted: `R$ ${(row.value_cents / 100).toFixed(2).replace('.', ',')}`,
        origin,
        sourceKind: row.source_kind,
        sourceSlug: row.source_slug,
        status: row.status,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        telegramId: row.telegram_id
      };
    });

    res.json({
      success: true,
      data: {
        users,
        count: users.length
      }
    });

  } catch (error) {
    console.error('[ERRO][USERS_LIST]', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar usuários'
    });
  }
});

module.exports = router;
