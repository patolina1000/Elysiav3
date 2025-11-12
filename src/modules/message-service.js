/**
 * Message Service - Sistema Unificado de Envio de Mensagens
 * 
 * Responsabilidades:
 * - Buscar templates de mensagens (start, downsell, shot)
 * - Buscar mídias associadas (até 3 por mensagem)
 * - Renderizar mensagens com contexto
 * - Preparar envio via Telegram API
 * - Enviar mensagens via Telegram
 * - Registrar eventos de envio
 * 
 * Tipos de mensagem:
 * - 'start': Mensagem inicial do /start
 * - 'downsell': Mensagens de downsell (após X minutos ou após PIX não pago)
 * - 'shot': Mensagens de disparo em massa
 * 
 * Tipos de mídia suportados:
 * - 'photo': Foto/imagem
 * - 'video': Vídeo
 * - 'audio': Áudio
 * 
 * Estrutura de content (JSON):
 * {
 *   "text": "Conteúdo da mensagem",
 *   "media_ids": [1, 2, 3],  // até 3 mídias
 *   "buttons": [{ "text": "...", "callback_data": "..." }]  // opcional
 * }
 */

const MediaResolver = require('./media-resolver');

const startConfigCache = new Map();

class MessageService {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
    this.mediaResolver = new MediaResolver(pool, config);
  }

  static invalidateStartConfigCache(botId) {
    if (!botId) return;
    const cacheKey = `${botId}:start`;
    startConfigCache.delete(cacheKey);
  }

  /**
   * Normalizar content para JSON válido
   * Se for string simples, converte para { text: string }
   * Se já for JSON, retorna como está
   * Garante que o resultado é sempre um objeto com estrutura esperada
   */
  normalizeContent(content) {
    let parsed = {};

    if (typeof content === 'string') {
      // Se for string simples, tentar parsear como JSON
      try {
        parsed = JSON.parse(content);
      } catch {
        // Se não for JSON válido, criar estrutura padrão
        parsed = { text: content };
      }
    } else if (typeof content === 'object' && content !== null) {
      parsed = content;
    } else {
      parsed = { text: '' };
    }

    const ensureArray = (value) => (Array.isArray(value) ? value : []);
    const base = { ...parsed };

    // Garantir que o resultado tem a estrutura esperada
    if (Array.isArray(base.messages)) {
      const normalized = {
        ...base,
        messages: ensureArray(base.messages),
        medias: ensureArray(base.medias),
        plans: ensureArray(base.plans),
        buttons: ensureArray(base.buttons)
      };
      delete normalized.text;
      return normalized;
    }

    if (base.text !== undefined) {
      return {
        ...base,
        text: String(base.text || ''),
        media_ids: ensureArray(base.media_ids),
        buttons: ensureArray(base.buttons),
        medias: ensureArray(base.medias),
        plans: ensureArray(base.plans)
      };
    }

    // Fallback: retornar estrutura vazia mantendo campos adicionais
    return {
      ...base,
      text: '',
      media_ids: [],
      buttons: [],
      medias: [],
      plans: []
    };
  }

  /**
   * Buscar template de mensagem
   * messageType: 'start', 'downsell', 'shot'
   * 
   * Nota: Para 'downsell' e 'shot', buscar na tabela específica (bot_downsells, shots)
   * Para 'start', buscar em bot_messages
   */
  async getMessageTemplate(botId, messageType) {
    try {
      let result;
      let query;
      let params;
      let cacheKey = null;

      if (messageType === 'start') {
        cacheKey = `${botId}:start`;
        if (startConfigCache.has(cacheKey)) {
          const cachedTemplate = startConfigCache.get(cacheKey);
          return JSON.parse(JSON.stringify(cachedTemplate));
        }
      }

      if (messageType === 'start') {
        // Buscar em bot_messages com slug='start' - fonte única
        query = `SELECT id, bot_id, slug, content, active, created_at, updated_at
                 FROM bot_messages
                 WHERE bot_id = $1 AND slug = $2 AND active = TRUE 
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1`;
        params = [botId, 'start'];
        result = await this.pool.query(query, params);
      } else if (messageType === 'downsell') {
        // Buscar em bot_downsells (primeira disponível)
        query = `SELECT id, bot_id, slug, content, active, created_at, updated_at 
                 FROM bot_downsells 
                 WHERE bot_id = $1 AND active = TRUE 
                 ORDER BY delay_seconds ASC
                 LIMIT 1`;
        params = [botId];
        result = await this.pool.query(query, params);
      } else if (messageType === 'shot') {
        // Buscar em shots (primeira disponível)
        query = `SELECT id, bot_id, slug, content, active, created_at, updated_at 
                 FROM shots 
                 WHERE bot_id = $1 AND active = TRUE 
                 ORDER BY created_at DESC
                 LIMIT 1`;
        params = [botId];
        result = await this.pool.query(query, params);
      } else {
        console.warn(`[MESSAGE] Tipo de mensagem desconhecido: type=${messageType}`);
        return null;
      }

      if (result.rows.length === 0) {
        if (messageType === 'start') {
          console.warn('[START:TEMPLATE:NOT_FOUND]', JSON.stringify({ botId }));
        } else {
          console.warn(`[MESSAGE] Template não encontrado: bot=${botId} type=${messageType}`);
        }
        return null;
      }

      const row = result.rows[0];
      // Normalizar content para JSON
      const normalizedRow = {
        ...row,
        content: this.normalizeContent(row.content)
      };

      if (cacheKey) {
        startConfigCache.set(cacheKey, normalizedRow);
      }

      return JSON.parse(JSON.stringify(normalizedRow));
    } catch (error) {
      if (messageType === 'start') {
        console.error('[ERRO:START:TEMPLATE_QUERY]', JSON.stringify({
          botId,
          type: messageType,
          found: false,
          reason: 'exception',
          error: error.message,
          code: error.code,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.error(`[ERRO][MESSAGE] Falha ao buscar template: bot=${botId} type=${messageType} error=${error.message}`);
      }
      return null;
    }
  }

  /**
   * Buscar mídias associadas a uma mensagem
   * Máximo 3 mídias por mensagem
   * 
   * Retorna array com até 3 objetos:
   * {
   *   id: number,
   *   kind: 'photo' | 'video' | 'audio',
   *   tg_file_id: string (Telegram file_id se em cache),
   *   url: string (URL da mídia se não em cache),
   *   media_store_id: number,
   *   caption: string (opcional)
   * }
   */
  async getMessageMedia(messageId, limit = 3) {
    try {
      // Buscar referências de mídia para esta mensagem
      // Assumindo que existe uma tabela de relacionamento (ex: message_media)
      // Por enquanto, retornar array vazio até que a tabela seja criada
      
      // TODO: Implementar quando tabela message_media for criada
      // SELECT mc.id, mc.kind, mc.tg_file_id, ms.url, ms.id as media_store_id
      // FROM message_media mm
      // JOIN media_cache mc ON mm.media_cache_id = mc.id
      // LEFT JOIN media_store ms ON mc.media_store_id = ms.id
      // WHERE mm.message_id = $1
      // LIMIT $2

      return [];
    } catch (error) {
      console.error(`[ERRO][MESSAGE] Falha ao buscar mídias: message=${messageId} error=${error.message}`);
      return [];
    }
  }

  /**
   * Renderizar conteúdo de mensagem com contexto
   * Substitui placeholders como {{user_name}}, {{bot_name}}, etc.
   * Trabalha com estrutura JSON { text, media_ids, buttons } ou { messages, medias, plans }
   */
  renderContent(template, context = {}) {
    const contentObj = this.normalizeContent(template.content);

    const planLayoutRaw = contentObj.plan_layout ?? contentObj.planLayout;
    const planColumnsRaw = contentObj.plan_columns ?? contentObj.planColumns;
    const planLayout = this._resolvePlanLayout(planLayoutRaw);
    const planColumns = this._resolvePlanColumns(planColumnsRaw, planLayout);
    
    // Substituições simples (aplicar a todas as mensagens)
    const placeholders = {
      '{{user_name}}': context.userName || 'Usuário',
      '{{bot_name}}': context.botName || 'Bot',
      '{{user_id}}': context.userId || '',
      '{{timestamp}}': new Date().toLocaleString('pt-BR')
    };

    const replaceText = (text) => {
      // Garantir que text é sempre string
      if (typeof text !== 'string') {
        text = String(text);
      }
      
      let result = text;
      Object.entries(placeholders).forEach(([key, value]) => {
        result = result.replace(new RegExp(key, 'g'), value);
      });
      return result;
    };

    // Suportar ambos os formatos: antigo (text) e novo (messages array)
    if (contentObj.messages && Array.isArray(contentObj.messages) && contentObj.messages.length > 0) {
      // Novo formato: retornar array de mensagens com placeholders substituídos
      // Garantir que cada item é string antes de processar
      const messages = contentObj.messages
        .map(msg => {
          // Se msg for objeto, extrair o campo text
          if (typeof msg === 'object' && msg !== null && msg.text) {
            return replaceText(msg.text);
          }
          // Caso contrário, converter para string e processar
          return replaceText(String(msg || ''));
        })
        .filter(msg => msg && msg.trim()); // Remover mensagens vazias
      
      return {
        messages,
        media_ids: contentObj.media_ids || [],
        buttons: contentObj.buttons || [],
        medias: contentObj.medias || [],
        plans: Array.isArray(contentObj.plans) ? contentObj.plans : [],
        planLayout,
        planColumns
      };
    } else if (contentObj.text) {
      // Formato antigo: usar campo text direto
      const text = replaceText(String(contentObj.text));

      return {
        text,
        media_ids: contentObj.media_ids || [],
        buttons: contentObj.buttons || [],
        medias: contentObj.medias || [],
        plans: Array.isArray(contentObj.plans) ? contentObj.plans : [],
        planLayout,
        planColumns
      };
    } else {
      return {
        text: '',
        media_ids: [],
        buttons: [],
        medias: [],
        plans: [],
        planLayout,
        planColumns
      };
    }
  }

  /**
   * Enviar mensagem para usuário
   * Respeita SLO de ≤ 500ms para /start
   * 
   * Fluxo:
   * 1. Buscar template
   * 2. Resolver mídias via MediaResolver
   * 3. Renderizar conteúdo (suporta múltiplas mensagens)
   * 4. Preparar payloads para Telegram
   * 5. Enviar via Telegram API (todas as mensagens)
   * 6. Registrar em funnel_events
   * 
   * Tipos de mensagem suportados:
   * - 'start': Mensagem inicial do /start (pode ter múltiplas mensagens)
   * - 'downsell': Downsell (após delay)
   * - 'shot': Disparo em massa
   */
  async sendMessage(botId, telegramId, messageType, context = {}, botToken = null) {
    const startTime = Date.now();

    try {
      // 1. Buscar template
      const template = await this.getMessageTemplate(botId, messageType);
      if (!template) {
        throw new Error(`Template não encontrado: type=${messageType}`);
      }

      // 2. Resolver mídias via MediaResolver (em vez de getMessageMedia)
      // Primeiro, buscar bot_slug para resolver mídias
      const botResult = await this.pool.query(
        'SELECT slug FROM bots WHERE id = $1',
        [botId]
      );
      
      let medias = [];
      if (botResult.rows.length > 0) {
        const botSlug = botResult.rows[0].slug;
        const mediasInConfig = template.content.medias || [];
        medias = await this.mediaResolver.resolveMedias(botSlug, mediasInConfig);
      }

      // 3. Renderizar conteúdo (retorna todas as mensagens)
      const renderedContent = this.renderContent(template, context);

      // CP-1: Normalizar media_mode e attach_text_as_caption
      let mediaMode = template.content?.media_mode;
      let attachTextAsCaption = template.content?.attach_text_as_caption;
      const plansFromConfig = Array.isArray(template.content?.plans)
        ? template.content.plans.slice(0, 10)
        : [];
      template.content.plans = plansFromConfig;

      if (mediaMode === undefined || mediaMode === null) {
        mediaMode = 'group';
      } else if (mediaMode !== 'group' && mediaMode !== 'single') {
        mediaMode = 'group';
      }

      if (attachTextAsCaption === undefined || attachTextAsCaption === null) {
        attachTextAsCaption = false;
      } else {
        attachTextAsCaption = Boolean(attachTextAsCaption);
      }

      const planCount = plansFromConfig.length;

      if (messageType === 'start') {
        console.info(`START:CONFIG_NORMALIZED { mediaMode:"${mediaMode}", attachTextAsCaption:${attachTextAsCaption}, planCount:${planCount} }`);
      }

      // 4. Preparar payloads para Telegram (um por mensagem)
      const payloads = this.prepareTelegramPayloads(
        botId,
        telegramId,
        renderedContent,
        medias,
        mediaMode,
        attachTextAsCaption,
        { origin: messageType === 'start' ? 'start' : 'generic' }
      );

      if (!payloads || payloads.length === 0) {
        throw new Error(`Nenhum payload para enviar`);
      }

      // 5. Enviar via Telegram API (se botToken fornecido)
      let responses = [];
      if (botToken) {
        const dispatchResult = await this.dispatchPayloads(botToken, payloads, {
          origin: messageType === 'start' ? 'start' : 'generic'
        });
        responses = dispatchResult.responses;
      }

      // 6. Registrar em funnel_events
      const eventName = this.mapMessageTypeToEventName(messageType);
      if (eventName) {
        try {
          await this.pool.query(
            `INSERT INTO funnel_events (event_name, bot_id, telegram_id, meta, occurred_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [eventName, botId, telegramId, JSON.stringify({ type: messageType, messages: payloads.length, medias: medias.length })]
          );
          console.info('[START:FUNNEL_EVENT_REGISTERED]', JSON.stringify({
            botId,
            telegramId,
            eventName,
            timestamp: new Date().toISOString()
          }));
        } catch (dbError) {
          console.error('[ERRO:START:FUNNEL_EVENT]', JSON.stringify({
            botId,
            telegramId,
            eventName,
            error: dbError.message,
            code: dbError.code,
            timestamp: new Date().toISOString()
          }));
        }
      }

      const duration = Date.now() - startTime;
      console.info('[START:COMPLETE]', JSON.stringify({
        botId,
        telegramId,
        messageType,
        payloadCount: payloads.length,
        mediaCount: medias.length,
        sentCount: responses.length,
        latencyMs: duration,
        success: responses.length > 0,
        timestamp: new Date().toISOString()
      }));

      return {
        success: responses.length > 0,
        duration,
        messageCount: payloads.length,
        messageType,
        mediaCount: medias.length,
        responses
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      if (messageType === 'start') {
        console.warn('[START:FAILED]', JSON.stringify({
          botId,
          telegramId,
          reason: error.message,
          latencyMs: duration,
          stack: error.stack?.split('\n')[0],
          timestamp: new Date().toISOString()
        }));
      }
      console.error('[ERRO:MESSAGE_SERVICE]', JSON.stringify({
        type: messageType,
        botId,
        telegramId,
        error: error.message,
        latencyMs: duration,
        timestamp: new Date().toISOString()
      }));
      return {
        success: false,
        error: error.message,
        duration
      };
    }
  }

  /**
   * Mapear tipo de mensagem para event_name do funil
   */
  mapMessageTypeToEventName(messageType) {
    const mapping = {
      'start': 'bot_start',
      'downsell': 'bot_downsell',
      'shot': 'bot_shot'
    };
    return mapping[messageType] || null;
  }

  /**
   * Ordenar mídias por prioridade: áudio > vídeo > foto
   * Mantém ordem original dentro de cada tipo
   */
  prioritizeMedias(medias = []) {
    if (!Array.isArray(medias) || medias.length === 0) {
      return [];
    }

    const buckets = {
      audio: [],
      video: [],
      photo: [],
      other: []
    };

    medias.forEach(media => {
      if (!media) {
        return;
      }

      if (media.kind === 'audio') {
        buckets.audio.push(media);
      } else if (media.kind === 'video') {
        buckets.video.push(media);
      } else if (media.kind === 'photo') {
        buckets.photo.push(media);
      } else {
        buckets.other.push(media);
      }
    });

    return [...buckets.audio, ...buckets.video, ...buckets.photo, ...buckets.other];
  }

  /**
   * CP-2: Decidir rigidamente entre group/single baseado em elegibilidade
   * group: apenas se media_mode==='group' E existem ≥2 mídias elegíveis (foto/vídeo com tg_file_id)
   * Caso contrário: single
   * 
   * @param {string} requestedMode - 'group' ou 'single' (do template)
   * @param {array} medias - array de mídias resolvidas
   * @returns {object} { requested: string, decided: string, eligiblePhotoVideo: number }
   */
  decideMediaMode(requestedMode, medias = []) {
    const normalizedRequested = requestedMode === 'single' ? 'single' : 'group';
    const eligiblePhotoVideo = medias.filter(media =>
      ['photo', 'video'].includes(media.kind) && media.tg_file_id
    ).length;

    let decided = 'single';
    if (normalizedRequested === 'single') {
      decided = 'single';
    } else if (eligiblePhotoVideo >= 2) {
      decided = 'group';
    }

    return { requested: normalizedRequested, decided, eligiblePhotoVideo };
  }

  _parsePriceToCents(value) {
    if (value === undefined || value === null) {
      return null;
    }

    let cents = null;

    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        cents = value;
      } else if (Number.isFinite(value)) {
        cents = Math.round(value * 100);
      }
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        const normalizedDecimal = trimmed.replace(',', '.');
        const decimalCandidate = Number(normalizedDecimal);

        if (!Number.isNaN(decimalCandidate) && /[.,]/.test(trimmed)) {
          cents = Math.round(decimalCandidate * 100);
        } else {
          const digits = trimmed.replace(/[^0-9]/g, '');
          if (digits) {
            cents = Number(digits);
          }
        }
      }
    }

    if (cents === null) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        cents = Number.isInteger(numeric) ? numeric : Math.round(numeric * 100);
      }
    }

    if (!Number.isFinite(cents)) {
      return null;
    }

    const normalizedCents = Math.round(cents);
    if (normalizedCents <= 0) {
      return null;
    }

    return normalizedCents;
  }

  _formatPriceFromCents(cents) {
    if (!Number.isFinite(cents) || cents <= 0) {
      return null;
    }

    return (cents / 100).toFixed(2).replace('.', ',');
  }

  _formatPriceCents(value) {
    const cents = this._parsePriceToCents(value);
    if (cents === null) {
      return null;
    }

    return this._formatPriceFromCents(cents);
  }

  _sanitizePlanIdentifier(value, fallback) {
    let normalized = '';

    if (value !== undefined && value !== null) {
      normalized = String(value).replace(/[^a-zA-Z0-9_-]/g, '');
    }

    if (!normalized && fallback !== undefined && fallback !== null) {
      normalized = String(fallback).replace(/[^a-zA-Z0-9_-]/g, '');
    }

    if (!normalized) {
      normalized = '';
    }

    if (normalized.length > 32) {
      normalized = normalized.slice(0, 32);
    }

    return normalized;
  }

  _resolvePlanLayout(layout) {
    return layout === 'list' ? 'list' : 'adjacent';
  }

  _resolvePlanColumns(columns, layout = 'adjacent') {
    if (layout === 'list') {
      return 1;
    }

    const parsed = parseInt(columns ?? 2, 10);
    return parsed === 3 ? 3 : 2;
  }

  _extractDurationDays(plan) {
    let duration = plan?.duration_days ?? plan?.durationDays ?? plan?.days ?? plan?.duration;

    if (duration !== undefined && duration !== null) {
      const parsed = parseInt(duration, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    const durationSources = [plan?.time, plan?.duration_label, plan?.durationLabel];

    for (const source of durationSources) {
      if (typeof source !== 'string') {
        continue;
      }
      const match = source.match(/\d+/);
      if (match) {
        const parsed = parseInt(match[0], 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }

    return null;
  }

  _normalizePlansForKeyboard(plans, botId) {
    if (!Array.isArray(plans) || plans.length === 0 || !botId) {
      return [];
    }

    const normalized = [];
    const limitedPlans = plans.slice(0, 10);

    limitedPlans.forEach((plan, index) => {
      if (!plan) {
        return;
      }

      const priceSource = plan.price_cents ?? plan.priceCents ?? plan.value ?? plan.amount_cents ?? plan.amountCents ?? plan.price;
      const priceCents = this._parsePriceToCents(priceSource);
      if (priceCents === null) {
        return;
      }

      const priceFormatted = this._formatPriceFromCents(priceCents) || '0,00';

      const nameCandidate = (plan.name || plan.title || `Plano ${index + 1}`).toString();
      const safeName = nameCandidate.replace(/\s+/g, ' ').trim() || `Plano ${index + 1}`;

      const planIdRaw =
        plan.id
        ?? plan.plan_id
        ?? plan.planId
        ?? plan.external_id
        ?? plan.externalId
        ?? plan.key
        ?? plan.slug
        ?? plan.gateway_id
        ?? plan.gatewayId;

      let normalizedId = this._sanitizePlanIdentifier(planIdRaw, index + 1);
      if (!normalizedId) {
        normalizedId = this._sanitizePlanIdentifier(index + 1);
      }

      if (!normalizedId) {
        return;
      }

      const suffix = ` — R$ ${priceFormatted}`;
      const maxLabelLength = 48;
      const maxNameLength = Math.max(1, maxLabelLength - suffix.length);

      let displayName = safeName;
      if (displayName.length > maxNameLength) {
        const sliceLength = Math.max(1, maxNameLength - 1);
        displayName = `${displayName.slice(0, sliceLength).trim()}…`;
      }

      const label = `${displayName}${suffix}`.slice(0, maxLabelLength);
      const callbackData = `plan:${botId}:${normalizedId}`;

      normalized.push({
        button: {
          text: label,
          callback_data: callbackData
        },
        meta: {
          normalizedId,
          planId: planIdRaw !== undefined && planIdRaw !== null ? String(planIdRaw) : normalizedId,
          name: safeName,
          priceCents,
          priceFormatted,
          label
        }
      });
    });

    return normalized;
  }

  /**
   * Preparar múltiplos payloads para Telegram API
   * - Ordena mídias: áudio > vídeo > foto (mantendo ordem original dentro do tipo)
   * - Modo group: áudios/documentos enviados individualmente, fotos/vídeos em álbum (máx. 10)
   * - Modo single: todas as mídias enviadas individualmente na ordem priorizada
   * - Textos sempre enviados após as mídias, um por mensagem
   * - attachTextAsCaption: quando true, aplica primeiro texto como caption conforme modo decidido
   */
  prepareTelegramPayloads(botId, telegramId, renderedContent, medias = [], mediaMode = 'group', attachTextAsCaption = false, options = {}) {
    const payloads = [];
    const originalMedias = Array.isArray(medias) ? medias : [];
    const validMedias = originalMedias.filter(media => media && media.tg_file_id);
    const prioritizedMedias = this.prioritizeMedias(validMedias);
    const modeDecision = this.decideMediaMode(mediaMode, prioritizedMedias);

    console.info(`START:MEDIA_MODE { requested:"${modeDecision.requested}", eligiblePhotoVideo:${modeDecision.eligiblePhotoVideo}, decided:"${modeDecision.decided}" }`);

    const orderList = prioritizedMedias.map(media => media.kind).join(',');
    console.info(`START:MEDIA_ORDER { before:${originalMedias.length}, after_sorted:${prioritizedMedias.length}, order:[${orderList}] }`);

    console.info(`START:CAPTION_POLICY { attach:${attachTextAsCaption ? 'true' : 'false'} }`);

    const textMessages = [];
    if (Array.isArray(renderedContent.messages)) {
      renderedContent.messages.forEach(msg => {
        if (typeof msg === 'string') {
          textMessages.push(msg);
        } else if (msg && typeof msg === 'object' && msg.text) {
          textMessages.push(String(msg.text));
        } else if (msg !== undefined && msg !== null) {
          textMessages.push(String(msg));
        }
      });
    } else if (renderedContent.text) {
      textMessages.push(String(renderedContent.text));
    }

    let pendingCaption = null;
    let captionSourceForText = null;
    let captionApplied = false;

    if (attachTextAsCaption && prioritizedMedias.length > 0 && textMessages.length > 0) {
      captionSourceForText = textMessages.shift();
      const captionCandidate = String(captionSourceForText || '').trim();
      pendingCaption = captionCandidate.slice(0, 1024);
    }

    const applyCaption = () => {
      if (pendingCaption === null) {
        return null;
      }
      const captionToUse = pendingCaption;
      pendingCaption = null;
      captionApplied = true;
      console.info(`START:CAPTION_APPLIED { on:"${modeDecision.decided}", length:${captionToUse.length} }`);
      return captionToUse;
    };

    const fallbackButtons = Array.isArray(renderedContent.buttons) ? renderedContent.buttons : [];
    const buildFallbackReplyMarkup = () => ({
      inline_keyboard: fallbackButtons.map(btn => ([{
        text: btn.text,
        callback_data: btn.callback_data
      }]))
    });

    const originKey = options.origin === 'preview' ? 'PREVIEW' : 'START';
    const allowPlans = options.origin === 'start' || options.origin === 'preview';
    const planEntries = allowPlans ? this._normalizePlansForKeyboard(renderedContent?.plans, botId) : [];
    let planKeyboardContext = null;

    if (planEntries.length > 0) {
      const planLayout = this._resolvePlanLayout(renderedContent?.planLayout);
      const planColumns = this._resolvePlanColumns(renderedContent?.planColumns, planLayout);
      const planButtons = planEntries.map(entry => entry.button);
      const rows = [];

      for (let i = 0; i < planButtons.length; i += planColumns) {
        rows.push(planButtons.slice(i, i + planColumns));
      }

      const telemetry = {
        layout: planLayout,
        columns: planLayout === 'list' ? 1 : planColumns,
        rows: rows.length,
        buttons: planButtons.length
      };

      console.info(`[${originKey}:PLANS]`, JSON.stringify({
        count: telemetry.buttons,
        layout: telemetry.layout,
        columns: telemetry.columns
      }));

      planKeyboardContext = {
        markup: { inline_keyboard: rows },
        planCount: planButtons.length,
        rows: rows.length,
        layout: planLayout,
        columns: planColumns,
        telemetry,
        plansMeta: planEntries.map(entry => entry.meta)
      };
    }

    let singleIndex = 0;

    const pushSingleMedia = (media, allowCaption) => {
      const payload = { chat_id: telegramId };
      const telegramType = this.mapMediaKindToTelegramType(media.kind);
      const field = telegramType === 'audio'
        ? 'audio'
        : telegramType === 'video'
          ? 'video'
          : telegramType === 'document'
            ? 'document'
            : 'photo';

      payload[field] = media.tg_file_id;

      if (allowCaption) {
        const caption = applyCaption();
        if (caption) {
          payload.caption = caption;
          payload.parse_mode = 'MarkdownV2';
        }
      }

      payload.__meta = { type: 'media-single', index: singleIndex++, kind: media.kind };
      payloads.push(payload);
    };

    if (modeDecision.decided === 'group') {
      const processed = new Set();

      prioritizedMedias.forEach(media => {
        if (media.kind === 'audio') {
          pushSingleMedia(media, false);
          processed.add(media);
        }
      });

      const groupableMedias = prioritizedMedias.filter(media => ['photo', 'video'].includes(media.kind));
      const albumMedias = groupableMedias.slice(0, 10);

      if (albumMedias.length > 0) {
        const albumPayload = {
          chat_id: telegramId,
          media: albumMedias.map((media, index) => {
            const item = {
              type: this.mapMediaKindToTelegramType(media.kind),
              media: media.tg_file_id
            };

            if (index === 0) {
              const caption = applyCaption();
              if (caption) {
                item.caption = caption;
                item.parse_mode = 'MarkdownV2';
              }
            }

            return item;
          })
        };

        albumPayload.__meta = { type: 'group', count: albumMedias.length };
        payloads.push(albumPayload);
        albumMedias.forEach(media => processed.add(media));
      }

      prioritizedMedias.forEach(media => {
        if (processed.has(media)) {
          return;
        }
        pushSingleMedia(media, false);
        processed.add(media);
      });
    } else {
      prioritizedMedias.forEach((media, index) => {
        pushSingleMedia(media, index === 0);
      });
    }

    if (!captionApplied && captionSourceForText !== null) {
      textMessages.unshift(captionSourceForText);
      pendingCaption = null;
    }

    const textPayloads = [];
    let textIndex = 0;
    textMessages.forEach(msg => {
      const text = typeof msg === 'string' ? msg : String(msg || '');
      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      const textPayload = {
        chat_id: telegramId,
        text: trimmedText,
        parse_mode: 'MarkdownV2'
      };

      textPayload.__meta = { type: 'text', index: textIndex, length: trimmedText.length };
      textIndex += 1;

      textPayloads.push(textPayload);
    });

    let planAttached = false;
    let plansTelemetryLogged = false;

    if (planKeyboardContext) {
      if (textPayloads.length > 0) {
        const lastPayload = textPayloads[textPayloads.length - 1];
        lastPayload.reply_markup = planKeyboardContext.markup;
        lastPayload.__meta = {
          ...lastPayload.__meta,
          planCarrier: true,
          planCount: planKeyboardContext.planCount,
          planLogOnDispatch: true,
          planCarrierCreatedFinal: false,
          planLayout: planKeyboardContext.layout,
          planColumns: planKeyboardContext.columns
        };
        planAttached = true;

        if (!plansTelemetryLogged) {
          console.info(`[${originKey}:PLANS:SENT]`, JSON.stringify({
            rows: planKeyboardContext.telemetry.rows,
            buttons: planKeyboardContext.telemetry.buttons
          }));
          plansTelemetryLogged = true;
        }
      } else {
        const finalText = 'Escolha um plano';
        const finalPayload = {
          chat_id: telegramId,
          text: finalText,
          parse_mode: 'MarkdownV2',
          reply_markup: planKeyboardContext.markup
        };
        finalPayload.__meta = {
          type: 'text',
          index: textIndex,
          length: finalText.length,
          planCarrier: true,
          planCount: planKeyboardContext.planCount,
          planLogOnDispatch: false,
          planCarrierCreatedFinal: true,
          planLayout: planKeyboardContext.layout,
          planColumns: planKeyboardContext.columns
        };
        textPayloads.push(finalPayload);
        textIndex += 1;

        console.info(`${originKey}:PLANS_ATTACHED`, JSON.stringify({
          method: 'fallback_text',
          planCount: planKeyboardContext.planCount,
          textLength: finalText.length
        }));

        if (!plansTelemetryLogged) {
          console.info(`[${originKey}:PLANS:SENT]`, JSON.stringify({
            rows: planKeyboardContext.telemetry.rows,
            buttons: planKeyboardContext.telemetry.buttons
          }));
          plansTelemetryLogged = true;
        }

        planAttached = true;
      }
    }

    let buttonsAttached = false;

    if (!planAttached && fallbackButtons.length > 0 && textPayloads.length > 0) {
      textPayloads[0].reply_markup = buildFallbackReplyMarkup();
      buttonsAttached = true;
    }

    textPayloads.forEach(payload => {
      payloads.push(payload);
    });

    if (!planAttached && !buttonsAttached && fallbackButtons.length > 0) {
      const firstPayloadWithMarkup = payloads.find(payload => payload.__meta && payload.__meta.type !== 'group');
      if (firstPayloadWithMarkup) {
        firstPayloadWithMarkup.reply_markup = buildFallbackReplyMarkup();
        buttonsAttached = true;
      } else if (payloads.length === 0) {
        const buttonsPayload = {
          chat_id: telegramId,
          text: ' ',
          reply_markup: buildFallbackReplyMarkup(),
          parse_mode: 'MarkdownV2'
        };
        buttonsPayload.__meta = { type: 'text', index: textIndex, length: 1 };
        payloads.push(buttonsPayload);
      }
    }

    return payloads;
  }

  async dispatchPayloads(botToken, payloads = [], options = {}) {
    const responses = [];

    if (!botToken || !Array.isArray(payloads) || payloads.length === 0) {
      return { responses };
    }

    const originLabel = options.origin === 'preview' ? 'PREVIEW' : 'START';

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      const meta = payload.__meta || {};
      const { __meta, ...apiPayload } = payload;
      let response;

      try {
        response = await this.sendViaTelegramAPI(botToken, apiPayload);
      } catch (error) {
        response = { ok: false, error: error.message };
      }

      const safeError = response && response.error ? response.error.replace(/"/g, '\"') : null;
      const count = meta.count || (Array.isArray(apiPayload.media) ? apiPayload.media.length : 0);
      const singleIndex = meta.index ?? i;
      const textLength = meta.length ?? (apiPayload.text ? apiPayload.text.length : 0);

      if (meta.type === 'group') {
        if (response.ok) {
          console.info(`START:SEND:GROUP { count:${count}, sent:true }`);
        } else {
          console.warn(`START:SEND:GROUP { count:${count}, sent:false${safeError ? `, error:"${safeError}"` : ''} }`);
        }
      } else if (meta.type === 'media-single') {
        const kind = meta.kind || 'unknown';
        if (response.ok) {
          console.info(`START:SEND:SINGLE { index:${singleIndex}, kind:"${kind}", sent:true }`);
        } else {
          console.warn(`START:SEND:SINGLE { index:${singleIndex}, kind:"${kind}", sent:false${safeError ? `, error:"${safeError}"` : ''} }`);
        }
      } else if (meta.type === 'text') {
        if (response.ok) {
          console.info(`START:TEXT_SEND { index:${singleIndex}, len:${textLength} }`);
        } else {
          console.warn(`START:TEXT_SEND { index:${singleIndex}, len:${textLength}, sent:false${safeError ? `, error:"${safeError}"` : ''} }`);
        }
      }

      if (meta.planCarrier && meta.planCount && response.ok) {
        if (meta.planLogOnDispatch !== false) {
          const messageId = response.message_id
            || (Array.isArray(response.message_ids) && response.message_ids.length > 0
              ? response.message_ids[0]
              : null);
          const toMessage = messageId !== null ? messageId : 'unknown';
          console.info(`${originLabel}:PLANS_ATTACHED`, JSON.stringify({
            toMessage,
            planCount: meta.planCount
          }));
        }
      }

      responses.push({ ...response, meta });

      if (i < payloads.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { responses };
  }

  async getPlanMetadata(botId, planIdentifier) {
    if (!botId || planIdentifier === undefined || planIdentifier === null) {
      return null;
    }

    const normalizedId = this._sanitizePlanIdentifier(planIdentifier);
    if (!normalizedId) {
      return null;
    }

    try {
      const template = await this.getMessageTemplate(botId, 'start');
      if (!template || !Array.isArray(template.content?.plans)) {
        return null;
      }

      const normalizedPlans = this._normalizePlansForKeyboard(template.content.plans, botId);
      const match = normalizedPlans.find(entry => entry.meta.normalizedId === normalizedId);

      return match ? match.meta : null;
    } catch (error) {
      console.error('[ERRO:PLAN:METADATA]', JSON.stringify({
        botId,
        error: error.message
      }));
      return null;
    }
  }

  /**
   * Preparar payload para Telegram API
   * Suporta texto + até 3 mídias
   * renderedContent: { text, media_ids, buttons, medias }
   * mediaMode: 'group' (álbum) ou 'single' (individual)
   * attachTextAsCaption: se true, usar texto como caption do primeiro item
   * 
   * IMPORTANTE: Nunca enviar URL diretamente. Só usar tg_file_id.
   */
  prepareTelegramPayload(telegramId, renderedContent, medias = [], mediaMode = 'group', attachTextAsCaption = false) {
    // Garantir que text é string
    const textValue = renderedContent.text || '';
    const text = typeof textValue === 'string' ? textValue : String(textValue);
    const trimmedText = text.trim();
    
    // Validar que há conteúdo
    if (!trimmedText && medias.length === 0) {
      console.warn(`[MESSAGE] Nenhum conteúdo para enviar: chat_id=${telegramId}`);
      return null;
    }

    const payload = {
      chat_id: telegramId
    };

    // Adicionar texto se houver
    if (trimmedText) {
      payload.text = trimmedText;
      payload.parse_mode = 'MarkdownV2'; // Usar MarkdownV2 que é mais seguro
    }

    // Se houver mídia, preparar para envio
    if (medias.length > 0) {
      // Filtrar mídias que têm tg_file_id (nunca enviar URL)
      const validMedias = medias.filter(media => media.tg_file_id);
      
      if (validMedias.length > 0) {
        if (mediaMode === 'group') {
          // Modo grupo: agrupar fotos e vídeos
          const groupableMedias = validMedias.filter(m => ['photo', 'video'].includes(m.kind));
          
          if (groupableMedias.length > 0) {
            // Telegram permite enviar múltiplas mídias via media_group
            // CP-1: Respeitar attachTextAsCaption
            payload.media = groupableMedias.slice(0, 10).map((media, index) => ({
              type: this.mapMediaKindToTelegramType(media.kind),
              media: media.tg_file_id,
              caption: index === 0 && attachTextAsCaption && trimmedText ? trimmedText : undefined,
              parse_mode: (index === 0 && attachTextAsCaption && trimmedText) ? 'MarkdownV2' : undefined
            }));
          }
        } else {
          // Modo single: enviar primeira mídia apenas
          const firstMedia = validMedias[0];
          const mediaType = this.mapMediaKindToTelegramType(firstMedia.kind);
          payload[mediaType === 'audio' ? 'audio' : mediaType === 'document' ? 'document' : mediaType === 'video' ? 'video' : 'photo'] = firstMedia.tg_file_id;
          
          // CP-1: Respeitar attachTextAsCaption
          if (attachTextAsCaption && trimmedText) {
            payload.caption = trimmedText;
          }
        }
      }
    }

    // Se houver botões, adicionar ao payload
    if (renderedContent.buttons && renderedContent.buttons.length > 0) {
      payload.reply_markup = {
        inline_keyboard: renderedContent.buttons.map(btn => [
          {
            text: btn.text,
            callback_data: btn.callback_data
          }
        ])
      };
    }

    return payload;
  }

  /**
   * Mapear tipo de mídia local para tipo Telegram
   */
  mapMediaKindToTelegramType(kind) {
    const mapping = {
      'photo': 'photo',
      'video': 'video',
      'audio': 'audio',
      'document': 'document'
    };

    return mapping[kind] || 'photo';
  }

  /**
   * CP-8: Sanitizar mensagens de erro do Telegram
   * Identifica erros comuns e retorna descrição legível
   */
  _sanitizeTelegramError(errorDesc) {
    if (!errorDesc) return 'Unknown error';

    // Mapeamento de erros comuns do Telegram
    const errorMap = {
      'chat not found': 'Chat não encontrado (warmup_chat_id incorreto)',
      'not enough rights': 'Bot sem permissão no grupo',
      'wrong file_id': 'File ID inválido ou expirado',
      'failed to get HTTP URL content': 'URL inacessível ou inválida',
      'Bad Request': 'Requisição inválida ao Telegram',
      'Unauthorized': 'Token do bot inválido',
      'Forbidden': 'Bot bloqueado ou sem permissão',
      'Not Found': 'Recurso não encontrado',
      'Conflict': 'Conflito na operação',
      'Internal Server Error': 'Erro interno do Telegram'
    };

    // Procurar por padrões conhecidos
    for (const [pattern, friendlyMsg] of Object.entries(errorMap)) {
      if (errorDesc.toLowerCase().includes(pattern.toLowerCase())) {
        return friendlyMsg;
      }
    }

    // Se não encontrar padrão, retornar os primeiros 100 caracteres
    return errorDesc.substring(0, 100);
  }

  /**
   * Enviar via Telegram API
   * Suporta:
   * - sendMediaGroup (payload.media array)
   * - sendPhoto/sendVideo/sendAudio/sendDocument (payload.photo/video/audio/document)
   * - sendMessage (payload.text)
   * 
   * CP-4/5: Respeita modo group/single
   */
  async sendViaTelegramAPI(botToken, payload) {
    if (!botToken) {
      throw new Error('Bot token não fornecido');
    }

    if (!payload) {
      throw new Error('Payload vazio - nenhum conteúdo para enviar');
    }

    try {
      const axios = require('axios');
      const apiUrl = `https://api.telegram.org/bot${botToken}`;

      if (payload.media && Array.isArray(payload.media) && payload.media.length > 0) {
        const response = await axios.post(`${apiUrl}/sendMediaGroup`, {
          chat_id: payload.chat_id,
          media: payload.media
        }, { timeout: 5000, validateStatus: () => true });

        if (response.data?.ok) {
          return {
            ok: true,
            message_ids: response.data.result.map(item => item.message_id)
          };
        }

        const errorDesc = response.data?.description || 'Unknown error';
        return {
          ok: false,
          status: response.status,
          error: this._sanitizeTelegramError(errorDesc)
        };
      }

      const mediaFields = ['photo', 'video', 'audio', 'document'];
      for (const field of mediaFields) {
        if (!payload[field]) {
          continue;
        }

        const method = `send${field.charAt(0).toUpperCase() + field.slice(1)}`;
        const sendPayload = {
          chat_id: payload.chat_id,
          [field]: payload[field]
        };

        if (payload.caption) {
          sendPayload.caption = payload.caption;
          sendPayload.parse_mode = payload.parse_mode || 'MarkdownV2';
        } else if (payload.parse_mode) {
          sendPayload.parse_mode = payload.parse_mode;
        }

        if (payload.reply_markup) {
          sendPayload.reply_markup = payload.reply_markup;
        }

        const response = await axios.post(`${apiUrl}/${method}`, sendPayload, {
          timeout: 5000,
          validateStatus: () => true
        });

        if (response.data?.ok) {
          return {
            ok: true,
            message_id: response.data.result.message_id
          };
        }

        const errorDesc = response.data?.description || 'Unknown error';
        return {
          ok: false,
          status: response.status,
          error: this._sanitizeTelegramError(errorDesc)
        };
      }

      if (!payload.text) {
        return { ok: false, error: 'Nenhum conteúdo para enviar (sem texto ou mídia)' };
      }

      const sendPayload = {
        chat_id: payload.chat_id,
        text: payload.text
      };

      if (payload.parse_mode) {
        sendPayload.parse_mode = payload.parse_mode;
      }

      if (payload.reply_markup) {
        sendPayload.reply_markup = payload.reply_markup;
      }

      const response = await axios.post(`${apiUrl}/sendMessage`, sendPayload, {
        timeout: 5000,
        validateStatus: () => true
      });

      if (response.data?.ok) {
        return {
          ok: true,
          message_id: response.data.result.message_id
        };
      }

      const errorDesc = response.data?.description || 'Unknown error';
      return {
        ok: false,
        status: response.status,
        error: this._sanitizeTelegramError(errorDesc)
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = MessageService;
