/**
 * Message Service - Envio centralizado de mensagens
 * 
 * Responsabilidades:
 * - Buscar templates de mensagens (start, downsell, shot)
 * - Resolver mídias via MediaResolver
 * - Renderizar conteúdo com contexto dinâmico
 * - Preparar payloads para Telegram API
 * - Enviar via Telegram API
 * - Registrar eventos de funil
 * 
 * Tipos de mensagem suportados:
 * - start: Mensagem inicial do /start
 * - downsell: Downsell após delay
 * - shot: Disparo em massa
 * 
 * Tipos de mídia suportados:
 * - photo: Foto individual ou em álbum
 * - video: Vídeo individual ou em álbum
 * - audio: Áudio sempre individual
 * - document: Documento sempre individual
 * 
 * Fluxo completo:
 * 1. getMessageTemplate() - buscar template
 * 2. MediaResolver.resolveMedias() - resolver mídias
 * 3. renderContent() - renderizar com contexto
 * 4. prepareTelegramPayloads() - preparar payloads
 * 5. dispatchPayloads() - enviar via API
 * 6. Registrar em funnel_events
 */

// OTIMIZAÇÃO CRÍTICA: Agent global para reutilizar conexões TCP
// maxSockets aumentado para 50 (permite até 50 vídeos simultâneos)
// timeout aumentado para 15s (vídeos grandes podem demorar)
const https = require('https');
const GLOBAL_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 50,           // ↑ 20 → 50 (mais paralelismo)
  maxFreeSockets: 20,       // ↑ 10 → 20 (mais conexões idle)
  timeout: 15000,           // ↑ 5s → 15s (vídeos grandes)
  freeSocketTimeout: 60000, // ↑ 30s → 60s (manter conexões por mais tempo)
  scheduling: 'lifo'        // LIFO = reusar conexões recentes (mais quente)
});

const MediaResolver = require('./media-resolver');
const { getRateLimiter } = require('./rate-limiter');

const startConfigCache = new Map();

class MessageService {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
    this.mediaResolver = new MediaResolver(pool, config);
    this.rateLimiter = getRateLimiter();
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
   * specificId: ID específico do downsell ou shot (opcional)
   * 
   * Nota: Para 'downsell' e 'shot', buscar na tabela específica (bot_downsells, shots)
   * Para 'start', buscar em bot_messages
   */
  async getMessageTemplate(botId, messageType, specificId = null) {
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
        // Buscar em shots (por ID específico ou primeira disponível)
        if (specificId) {
          query = `SELECT id, bot_id, slug, content, active, created_at, updated_at 
                   FROM shots 
                   WHERE id = $1 AND bot_id = $2 AND active = TRUE 
                   LIMIT 1`;
          params = [specificId, botId];
        } else {
          query = `SELECT id, bot_id, slug, content, active, created_at, updated_at 
                   FROM shots 
                   WHERE bot_id = $1 AND active = TRUE 
                   ORDER BY created_at DESC
                   LIMIT 1`;
          params = [botId];
        }
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
   * - 'downsell': Downsell (após delay)
   * - 'shot': Disparo em massa
   * 
   * @param {number} specificId - ID específico do downsell ou shot (opcional)
   * @param {object} preloadedTemplate - Template pré-carregado (evita busca no banco)
   */
  async sendMessage(botId, telegramId, messageType, context = {}, botToken = null, specificId = null, preloadedTemplate = null) {
    const startTime = Date.now();
    const breakdown = {};

    try {
      // 1. Buscar template (ou usar pré-carregado)
      const t1 = Date.now();
      let template;
      
      if (preloadedTemplate) {
        // Usar template pré-carregado (broadcast já carregou)
        // Normalizar content para garantir estrutura consistente
        template = {
          ...preloadedTemplate,
          content: this.normalizeContent(preloadedTemplate.content)
        };
        console.log('[MESSAGE][TEMPLATE][PRELOADED]', { messageType, specificId });
      } else {
        // Buscar do banco (fluxo normal)
        template = await this.getMessageTemplate(botId, messageType, specificId);
        if (!template) {
          throw new Error(`Template não encontrado: type=${messageType}`);
        }
      }
      breakdown.templateLookup = Date.now() - t1;

      // 2. Resolver mídias via MediaResolver (em vez de getMessageMedia)
      // Primeiro, buscar bot_slug para resolver mídias
      const t2 = Date.now();
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
      breakdown.mediaResolve = Date.now() - t2;

      // 3. Renderizar conteúdo (retorna todas as mensagens)
      const t3 = Date.now();
      const renderedContent = this.renderContent(template, context);
      breakdown.contentRender = Date.now() - t3;

      // CP-1: Normalizar media_mode e attach_text_as_caption
      const t4 = Date.now();
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
      } else if (messageType === 'downsell') {
        console.info(`[DOWNSELL][BUILD_MESSAGE] { mediaMode:"${mediaMode}", attachTextAsCaption:${attachTextAsCaption}, planCount:${planCount}, mediasInConfig:${template.content.medias?.length || 0} }`);
      }

      // 4. Preparar payloads para Telegram (um por mensagem)
      // Preparar options com origem e slug específico
      const payloadOptions = { origin: messageType };
      
      // Para downsells e shots, passar o slug específico
      if (messageType === 'downsell' && template.slug) {
        payloadOptions.downsellSlug = template.slug;
      } else if (messageType === 'shot' && template.slug) {
        payloadOptions.shotSlug = template.slug;
      }
      
      const payloads = this.prepareTelegramPayloads(
        botId,
        telegramId,
        renderedContent,
        medias,
        mediaMode,
        attachTextAsCaption,
        payloadOptions
      );

      if (!payloads || payloads.length === 0) {
        throw new Error(`Nenhum payload para enviar`);
      }
      breakdown.payloadPreparation = Date.now() - t4;

      // 5. Enviar via Telegram API (se botToken fornecido)
      const t5 = Date.now();
      let responses = [];
      let dispatchDuration = 0;
      if (botToken) {
        const dispatchResult = await this.dispatchPayloads(botToken, payloads, {
          origin: messageType // ← Passar o tipo real (start, downsell, shot)
        });
        responses = dispatchResult.responses;
        dispatchDuration = dispatchResult.totalDispatchDuration || (Date.now() - t5);
      }
      breakdown.telegramDispatch = dispatchDuration;

      // 6. Registrar em funnel_events (OTIMIZAÇÃO: assíncrono para não bloquear)
      const t6 = Date.now();
      const eventName = this.mapMessageTypeToEventName(messageType);
      if (eventName) {
        // OTIMIZAÇÃO: Fazer insert assíncrono para não bloquear resposta
        setImmediate(async () => {
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
        });
      }
      breakdown.funnelEventLog = Date.now() - t6; // Será ~0ms agora

      const duration = Date.now() - startTime;
      
      // Log detalhado com breakdown para análise de performance
      if (messageType === 'start') {
        console.info('[START:COMPLETE]', JSON.stringify({
          botId,
          telegramId,
          messageType,
          payloadCount: payloads.length,
          mediaCount: medias.length,
          sentCount: responses.length,
          latencyMs: duration,
          success: responses.length > 0,
          breakdown: {
            templateLookup: breakdown.templateLookup,
            mediaResolve: breakdown.mediaResolve,
            contentRender: breakdown.contentRender,
            payloadPreparation: breakdown.payloadPreparation,
            telegramDispatch: breakdown.telegramDispatch,
            funnelEventLog: breakdown.funnelEventLog
          },
          timestamp: new Date().toISOString()
        }));

        // Log de alerta se alguma fase estiver lenta
        if (breakdown.templateLookup > 50) {
          console.warn(`START:SLOW_TEMPLATE_LOOKUP { latencyMs:${breakdown.templateLookup}, botId:${botId} }`);
        }
        if (breakdown.mediaResolve > 100) {
          console.warn(`START:SLOW_MEDIA_RESOLVE { latencyMs:${breakdown.mediaResolve}, mediaCount:${medias.length} }`);
        }
        if (breakdown.telegramDispatch > 300) {
          console.warn(`START:SLOW_TELEGRAM_DISPATCH { latencyMs:${breakdown.telegramDispatch}, payloadCount:${payloads.length} }`);
        }
      } else if (messageType === 'downsell') {
        console.info('[DOWNSELL][SEND][OK]', JSON.stringify({
          botId,
          telegramId,
          payloadCount: payloads.length,
          mediaCount: medias.length,
          planCount: plansFromConfig.length,
          sentCount: responses.length,
          latencyMs: duration,
          success: responses.length > 0,
          breakdown: {
            templateLookup: breakdown.templateLookup,
            mediaResolve: breakdown.mediaResolve,
            contentRender: breakdown.contentRender,
            payloadPreparation: breakdown.payloadPreparation,
            telegramDispatch: breakdown.telegramDispatch
          },
          timestamp: new Date().toISOString()
        }));
      } else {
        console.info('[MESSAGE:COMPLETE]', JSON.stringify({
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
      }

      return {
        success: responses.length > 0,
        duration,
        messageCount: payloads.length,
        messageType,
        mediaCount: medias.length,
        responses,
        breakdown
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      if (messageType === 'start') {
        console.warn('[START:FAILED]', JSON.stringify({
          botId,
          telegramId,
          reason: error.message,
          latencyMs: duration,
          breakdown,
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
        breakdown,
        timestamp: new Date().toISOString()
      }));
      return {
        success: false,
        error: error.message,
        duration,
        breakdown
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

  _normalizePlansForKeyboard(plans, botId, sourceKind = null, sourceSlug = null) {
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
      // Incluir origem no callback_data: plan:botId:planId:sourceKind:sourceSlug
      const callbackData = sourceKind && sourceSlug
        ? `plan:${botId}:${normalizedId}:${sourceKind}:${sourceSlug}`
        : `plan:${botId}:${normalizedId}`;

      // Log para debug
      if (sourceKind) {
        console.log(`[PLAN:BUTTON:CREATED] { planId:"${normalizedId}", name:"${safeName}", sourceKind:"${sourceKind}", sourceSlug:"${sourceSlug}", callbackData:"${callbackData}" }`);
      }

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

    // Log de mídias inválidas (sem tg_file_id)
    const invalidCount = originalMedias.length - validMedias.length;
    if (invalidCount > 0) {
      const invalidMedias = originalMedias.filter(media => !media || !media.tg_file_id);
      const invalidReasons = invalidMedias.map(media => {
        if (!media) return 'null_media';
        if (!media.tg_file_id) return 'missing_tg_file_id';
        return 'unknown';
      });
      console.warn(`START:MEDIA_INVALID { count:${invalidCount}, total:${originalMedias.length}, reasons:[${invalidReasons.join(',')}] }`);
    }

    console.info(`START:MEDIA_MODE { requested:"${modeDecision.requested}", eligiblePhotoVideo:${modeDecision.eligiblePhotoVideo}, decided:"${modeDecision.decided}" }`);

    const orderList = prioritizedMedias.map(media => media.kind).join(',');
    console.info(`START:MEDIA_ORDER { before:${originalMedias.length}, valid:${validMedias.length}, after_sorted:${prioritizedMedias.length}, order:[${orderList}] }`);

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

    // CORREÇÃO: Nunca aplicar caption em mídias quando há texto separado
    // Sempre enviar mídias primeiro, depois texto com botões
    let pendingCaption = null;
    let captionSourceForText = null;
    let captionApplied = false;

    // Só aplicar caption se attachTextAsCaption=true E não houver texto separado
    const hasTextMessages = textMessages.length > 0;
    const shouldUseCaption = attachTextAsCaption && prioritizedMedias.length > 0 && !hasTextMessages;

    console.info(`START:CAPTION_POLICY { attach:${attachTextAsCaption ? 'true' : 'false'}, hasTextMessages:${hasTextMessages}, shouldUseCaption:${shouldUseCaption} }`);

    if (shouldUseCaption && textMessages.length > 0) {
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

    const originKey = options.origin === 'preview' ? 'PREVIEW' : options.origin === 'downsell' ? 'DOWNSELL' : options.origin === 'shot' ? 'SHOT' : 'START';
    const allowPlans = options.origin === 'start' || options.origin === 'preview' || options.origin === 'downsell' || options.origin === 'shot';
    
    // Determinar sourceKind e sourceSlug baseado na origem
    let sourceKind = null;
    let sourceSlug = null;
    if (options.origin === 'start') {
      sourceKind = 'start';
      sourceSlug = 'start';
    } else if (options.origin === 'downsell' && options.downsellSlug) {
      sourceKind = 'downsell';
      sourceSlug = options.downsellSlug;
    } else if (options.origin === 'shot' && options.shotSlug) {
      sourceKind = 'shot';
      sourceSlug = options.shotSlug;
    }
    
    const planEntries = allowPlans ? this._normalizePlansForKeyboard(renderedContent?.plans, botId, sourceKind, sourceSlug) : [];
    let planKeyboardContext = null;

    if (planEntries.length > 0) {
      // Forçar layout 'list' para shots e downsells
      const forceListLayout = options.origin === 'shot' || options.origin === 'downsell';
      const planLayout = forceListLayout ? 'list' : this._resolvePlanLayout(renderedContent?.planLayout);
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
        }
      }

      payload.__meta = { type: 'media-single', index: singleIndex++, kind: media.kind };
      payloads.push(payload);
    };

    // CORREÇÃO: Enviar TODAS as mídias primeiro, SEM caption quando há texto separado
    if (modeDecision.decided === 'group') {
      const processed = new Set();

      // 1. Enviar áudios primeiro (sempre individual)
      prioritizedMedias.forEach(media => {
        if (media.kind === 'audio') {
          pushSingleMedia(media, false); // NUNCA caption em áudio quando há texto
          processed.add(media);
        }
      });

      // 2. Enviar fotos/vídeos em álbum
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

            // CORREÇÃO: Só aplicar caption se não houver texto separado
            if (index === 0 && !hasTextMessages) {
              const caption = applyCaption();
              if (caption) {
                item.caption = caption;
                // parse_mode removido - caption sem formatação não precisa
              }
            }

            return item;
          })
        };

        albumPayload.__meta = { type: 'group', count: albumMedias.length };
        payloads.push(albumPayload);
        albumMedias.forEach(media => processed.add(media));
      }

      // 3. Enviar outras mídias (documentos, etc)
      prioritizedMedias.forEach(media => {
        if (processed.has(media)) {
          return;
        }
        pushSingleMedia(media, false); // NUNCA caption quando há texto separado
        processed.add(media);
      });
    } else {
      // Modo single: enviar todas as mídias individualmente, SEM caption
      prioritizedMedias.forEach((media, index) => {
        // CORREÇÃO: Só aplicar caption na primeira mídia se não houver texto separado
        const allowCaption = index === 0 && !hasTextMessages;
        pushSingleMedia(media, allowCaption);
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
        text: trimmedText
        // parse_mode removido - texto sem formatação não precisa
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
          // parse_mode removido - texto sem formatação não precisa
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

    // CORREÇÃO: Adicionar textos APÓS todas as mídias
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
          reply_markup: buildFallbackReplyMarkup()
          // parse_mode removido - texto sem formatação não precisa
        };
        buttonsPayload.__meta = { type: 'text', index: textIndex, length: 1 };
        payloads.push(buttonsPayload);
      }
    }

    // Log da ordem final dos payloads
    const payloadOrder = payloads.map((p, i) => `${i+1}:${p.__meta?.type || 'unknown'}`).join(' → ');
    console.info(`START:PAYLOAD_ORDER { sequence:"${payloadOrder}", total:${payloads.length} }`);

    return payloads;
  }

  async dispatchPayloads(botToken, payloads = [], options = {}) {
    const responses = [];

    if (!botToken || !Array.isArray(payloads) || payloads.length === 0) {
      return { responses };
    }

    const originLabel = options.origin === 'preview' ? 'PREVIEW' : 'START';
    const dispatchStart = Date.now();

    // Rate limiting: máx 5 mensagens por segundo (conforme Telegram limits)
    const RATE_LIMIT = 5; // msg/s
    const CHUNK_DELAY = 1000; // 1s entre chunks

    // Dividir payloads em chunks de 5 para respeitar rate limit
    const chunks = [];
    for (let i = 0; i < payloads.length; i += RATE_LIMIT) {
      chunks.push(payloads.slice(i, i + RATE_LIMIT));
    }

    console.info(`${originLabel}:DISPATCH_START { payloads:${payloads.length}, chunks:${chunks.length}, rateLimitPerSec:${RATE_LIMIT} }`);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const chunkStart = Date.now();

      // CORREÇÃO: Separar mídias de texto para garantir ordem
      const mediaPayloads = chunk.filter(p => p.__meta?.type === 'media-single' || p.__meta?.type === 'group');
      const textPayloads = chunk.filter(p => p.__meta?.type === 'text');

      console.info(`${originLabel}:CHUNK_SPLIT { chunk:${chunkIndex + 1}, media:${mediaPayloads.length}, text:${textPayloads.length} }`);

      // 1. Enviar TODAS as mídias primeiro (OTIMIZAÇÃO: verdadeiro paralelo com Promise.allSettled)
      if (mediaPayloads.length > 0) {
        const mediaPromises = mediaPayloads.map(async (payload, indexInChunk) => {
          const globalIndex = chunkIndex * RATE_LIMIT + indexInChunk;
          const meta = payload.__meta || {};
          const { __meta, ...apiPayload } = payload;
          
          let response;
          const sendStart = Date.now();

          try {
            // OTIMIZAÇÃO: Não aguardar erros, continuar enviando
            response = await this.sendViaTelegramAPI(botToken, apiPayload);
          } catch (error) {
            response = { ok: false, error: error.message };
          }

          const sendDuration = Date.now() - sendStart;
          const safeError = response && response.error ? response.error.replace(/"/g, '\"') : null;
          const count = meta.count || (Array.isArray(apiPayload.media) ? apiPayload.media.length : 0);
          const singleIndex = meta.index ?? globalIndex;

          // Logs específicos por tipo de payload
          if (meta.type === 'group') {
            if (response.ok) {
              console.info(`${originLabel}:SEND:GROUP { count:${count}, sent:true, latencyMs:${sendDuration} }`);
            } else {
              console.warn(`${originLabel}:SEND:GROUP { count:${count}, sent:false, latencyMs:${sendDuration}${safeError ? `, error:"${safeError}"` : ''} }`);
            }
          } else if (meta.type === 'media-single') {
            const kind = meta.kind || 'unknown';
            if (response.ok) {
              console.info(`${originLabel}:SEND:SINGLE { index:${singleIndex}, kind:"${kind}", sent:true, latencyMs:${sendDuration} }`);
            } else {
              console.warn(`${originLabel}:SEND:SINGLE { index:${singleIndex}, kind:"${kind}", sent:false, latencyMs:${sendDuration}${safeError ? `, error:"${safeError}"` : ''} }`);
            }
          }

          return { ...response, meta, sendDuration, globalIndex };
        });

        // OTIMIZAÇÃO: Promise.allSettled ao invés de Promise.all
        // Se 1 vídeo falhar, os outros continuam sendo enviados
        const mediaResults = await Promise.allSettled(mediaPromises);
        const mediaResponses = mediaResults.map(result => 
          result.status === 'fulfilled' ? result.value : { ok: false, error: 'Promise rejected', meta: {} }
        );
        responses.push(...mediaResponses);
        
        const successCount = mediaResponses.filter(r => r.ok).length;
        const failCount = mediaResponses.length - successCount;
        console.info(`${originLabel}:MEDIA_BATCH_COMPLETE { count:${mediaPayloads.length}, success:${successCount}, failed:${failCount} }`);
      }

      // 2. Depois enviar textos (sequencial para manter ordem)
      if (textPayloads.length > 0) {
        for (let i = 0; i < textPayloads.length; i++) {
          const payload = textPayloads[i];
          const globalIndex = chunkIndex * RATE_LIMIT + mediaPayloads.length + i;
          const meta = payload.__meta || {};
          const { __meta, ...apiPayload } = payload;
          
          let response;
          const sendStart = Date.now();

          try {
            response = await this.sendViaTelegramAPI(botToken, apiPayload);
          } catch (error) {
            response = { ok: false, error: error.message };
          }

          const sendDuration = Date.now() - sendStart;
          const safeError = response && response.error ? response.error.replace(/"/g, '\"') : null;
          const singleIndex = meta.index ?? globalIndex;
          const textLength = meta.length ?? (apiPayload.text ? apiPayload.text.length : 0);

          if (response.ok) {
            console.info(`${originLabel}:TEXT_SEND { index:${singleIndex}, len:${textLength}, sent:true, latencyMs:${sendDuration} }`);
          } else {
            console.warn(`${originLabel}:TEXT_SEND { index:${singleIndex}, len:${textLength}, sent:false, latencyMs:${sendDuration}${safeError ? `, error:"${safeError}"` : ''} }`);
          }

          // Log de planos anexados
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

          responses.push({ ...response, meta, sendDuration, globalIndex });

          // Pequeno delay entre textos se houver múltiplos
          if (i < textPayloads.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        console.info(`${originLabel}:TEXT_BATCH_COMPLETE { count:${textPayloads.length} }`);
      }

      const chunkDuration = Date.now() - chunkStart;
      console.info(`${originLabel}:CHUNK_COMPLETE { chunk:${chunkIndex + 1}/${chunks.length}, payloads:${chunk.length}, latencyMs:${chunkDuration} }`);

      // Delay entre chunks (exceto no último)
      if (chunkIndex < chunks.length - 1) {
        console.info(`${originLabel}:RATE_LIMIT_WAIT { delayMs:${CHUNK_DELAY} }`);
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
      }
    }

    const totalDispatchDuration = Date.now() - dispatchStart;
    console.info(`${originLabel}:DISPATCH_COMPLETE { totalPayloads:${payloads.length}, totalLatencyMs:${totalDispatchDuration}, avgPerPayload:${Math.round(totalDispatchDuration / payloads.length)}ms }`);

    return { responses, totalDispatchDuration };
  }

  async getPlanMetadata(botId, planIdentifier, sourceKind = 'start', sourceSlug = null) {
    if (!botId || planIdentifier === undefined || planIdentifier === null) {
      return null;
    }

    const normalizedId = this._sanitizePlanIdentifier(planIdentifier);
    if (!normalizedId) {
      return null;
    }

    try {
      // Determinar de onde buscar o plano baseado na origem
      let template;
      let specificId = null;
      
      if (sourceKind === 'downsell' && sourceSlug) {
        // Buscar do downsell específico
        const downsellResult = await this.pool.query(
          'SELECT id FROM bot_downsells WHERE bot_id = $1 AND slug = $2 LIMIT 1',
          [botId, sourceSlug]
        );
        if (downsellResult.rows.length > 0) {
          specificId = downsellResult.rows[0].id;
          template = await this.getMessageTemplate(botId, 'downsell', specificId);
        }
      } else if (sourceKind === 'shot' && sourceSlug) {
        // Buscar do shot específico
        const shotResult = await this.pool.query(
          'SELECT id FROM shots WHERE bot_id = $1 AND slug = $2 LIMIT 1',
          [botId, sourceSlug]
        );
        if (shotResult.rows.length > 0) {
          specificId = shotResult.rows[0].id;
          template = await this.getMessageTemplate(botId, 'shot', specificId);
        } else {
          // Shot não encontrado (provavelmente foi deletado após envio)
          // Buscar planos do histórico
          console.log(`[PLAN:METADATA:SHOT_NOT_FOUND] Buscando em shot_plans_history { botId:${botId}, shotSlug:"${sourceSlug}" }`);
          
          const historyResult = await this.pool.query(
            `SELECT plans FROM shot_plans_history 
             WHERE bot_id = $1 AND shot_slug = $2 
             ORDER BY deleted_at DESC 
             LIMIT 1`,
            [botId, sourceSlug]
          );
          
          if (historyResult.rows.length > 0) {
            const plans = typeof historyResult.rows[0].plans === 'string'
              ? JSON.parse(historyResult.rows[0].plans)
              : historyResult.rows[0].plans;
            
            // Criar template fake apenas com os planos
            template = {
              id: null,
              bot_id: botId,
              slug: sourceSlug,
              content: {
                plans: Array.isArray(plans) ? plans : []
              }
            };
            
            console.log(`[PLAN:METADATA:FOUND_IN_HISTORY] { botId:${botId}, shotSlug:"${sourceSlug}", plansCount:${template.content.plans.length} }`);
          }
        }
      } else {
        // Buscar do /start (padrão)
        template = await this.getMessageTemplate(botId, 'start');
      }

      if (!template || !Array.isArray(template.content?.plans)) {
        console.warn(`[PLAN:METADATA:NOT_FOUND] { botId:${botId}, planId:"${normalizedId}", sourceKind:"${sourceKind}", sourceSlug:"${sourceSlug}" }`);
        return null;
      }

      const normalizedPlans = this._normalizePlansForKeyboard(template.content.plans, botId);
      const match = normalizedPlans.find(entry => entry.meta.normalizedId === normalizedId);

      if (match) {
        console.log(`[PLAN:METADATA:FOUND] { botId:${botId}, planId:"${normalizedId}", planName:"${match.meta.name}", sourceKind:"${sourceKind}", sourceSlug:"${sourceSlug}" }`);
      }

      return match ? match.meta : null;
    } catch (error) {
      console.error('[ERRO:PLAN:METADATA]', JSON.stringify({
        botId,
        planIdentifier,
        sourceKind,
        sourceSlug,
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
      // parse_mode removido - texto sem formatação não precisa
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
              caption: index === 0 && attachTextAsCaption && trimmedText ? trimmedText : undefined
              // parse_mode removido - caption sem formatação não precisa
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
   * Aplica rate limiting por chat (5 msg/s) e global (20 msg/s)
   */
  async sendViaTelegramAPI(botToken, payload) {
    if (!botToken) {
      throw new Error('Bot token não fornecido');
    }

    if (!payload) {
      throw new Error('Payload vazio - nenhum conteúdo para enviar');
    }

    const chatId = payload.chat_id;

    try {
      // Aplicar rate limiting antes de enviar
      const rateLimitResult = await this.rateLimiter.acquireToken(chatId);
      if (rateLimitResult.waitedMs > 0) {
        console.info('[RATE_LIMIT][WAIT]', {
          chatId,
          waitedMs: rateLimitResult.waitedMs,
          globalTokens: rateLimitResult.globalTokens,
          chatTokens: rateLimitResult.chatTokens
        });
      }

      const axios = require('axios');
      
      const apiUrl = `https://api.telegram.org/bot${botToken}`;
      const axiosConfig = {
        timeout: 10000,  // ↑ 3s → 10s (vídeos grandes precisam de mais tempo)
        validateStatus: () => true,
        httpsAgent: GLOBAL_HTTPS_AGENT,
        headers: {
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=60, max=200'  // ↑ timeout 30s→60s, max 100→200
        }
      };

      if (payload.media && Array.isArray(payload.media) && payload.media.length > 0) {
        const response = await axios.post(`${apiUrl}/sendMediaGroup`, {
          chat_id: payload.chat_id,
          media: payload.media
        }, axiosConfig);

        if (response.data?.ok) {
          return {
            ok: true,
            message_ids: response.data.result.map(item => item.message_id)
          };
        }

        const errorDesc = response.data?.description || 'Unknown error';
        
        // Tratar erro 429 (Too Many Requests)
        if (response.status === 429) {
          const retryAfter = response.data?.parameters?.retry_after || null;
          this.rateLimiter.register429(chatId, retryAfter);
          
          console.warn('[TELEGRAM][RATE_LIMIT][429]', {
            scope: 'global',
            chatId,
            retryAfter,
            method: 'sendMediaGroup'
          });
        }
        
        console.error('[TELEGRAM_API_ERROR:sendMediaGroup]', JSON.stringify({
          status: response.status,
          description: errorDesc,
          payload: { media_count: payload.media?.length, chat_id: payload.chat_id }
        }));
        return {
          ok: false,
          status: response.status,
          error: this._sanitizeTelegramError(errorDesc),
          raw_error: errorDesc
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
          // parse_mode removido - caption sem formatação não precisa
        }

        if (payload.reply_markup) {
          sendPayload.reply_markup = payload.reply_markup;
        }

        const response = await axios.post(`${apiUrl}/${method}`, sendPayload, axiosConfig);

        if (response.data?.ok) {
          return {
            ok: true,
            message_id: response.data.result.message_id
          };
        }

        const errorDesc = response.data?.description || 'Unknown error';
        
        // Tratar erro 429 (Too Many Requests)
        if (response.status === 429) {
          const retryAfter = response.data?.parameters?.retry_after || null;
          this.rateLimiter.register429(chatId, retryAfter);
          
          console.warn('[TELEGRAM][RATE_LIMIT][429]', {
            scope: 'chat',
            chatId,
            retryAfter,
            method
          });
        }
        
        console.error(`[TELEGRAM_API_ERROR:${method}]`, JSON.stringify({
          status: response.status,
          description: errorDesc,
          payload: { field, has_caption: Boolean(payload.caption), has_reply_markup: Boolean(payload.reply_markup), parse_mode: payload.parse_mode }
        }));
        return {
          ok: false,
          status: response.status,
          error: this._sanitizeTelegramError(errorDesc),
          raw_error: errorDesc
        };
      }

      if (!payload.text) {
        return { ok: false, error: 'Nenhum conteúdo para enviar (sem texto ou mídia)' };
      }

      const sendPayload = {
        chat_id: payload.chat_id,
        text: payload.text
      };

      // parse_mode removido - texto sem formatação não precisa

      if (payload.reply_markup) {
        sendPayload.reply_markup = payload.reply_markup;
      }

      const response = await axios.post(`${apiUrl}/sendMessage`, sendPayload, axiosConfig);

      if (response.data?.ok) {
        return {
          ok: true,
          message_id: response.data.result.message_id
        };
      }

      const errorDesc = response.data?.description || 'Unknown error';
      
      // Tratar erro 429 (Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.data?.parameters?.retry_after || null;
        this.rateLimiter.register429(chatId, retryAfter);
        
        console.warn('[TELEGRAM][RATE_LIMIT][429]', {
          scope: 'chat',
          chatId,
          retryAfter,
          method: 'sendMessage'
        });
      }
      
      console.error('[TELEGRAM_API_ERROR:sendMessage]', JSON.stringify({
        status: response.status,
        description: errorDesc,
        payload: { text_length: payload.text?.length, has_reply_markup: Boolean(payload.reply_markup), parse_mode: payload.parse_mode }
      }));
      return {
        ok: false,
        status: response.status,
        error: this._sanitizeTelegramError(errorDesc),
        raw_error: errorDesc
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = MessageService;
