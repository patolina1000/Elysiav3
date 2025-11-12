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

class MessageService {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
    this.mediaResolver = new MediaResolver(pool, config);
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
    
    // Garantir que o resultado tem a estrutura esperada
    // Se tiver messages array, manter como está
    if (parsed.messages && Array.isArray(parsed.messages)) {
      return {
        messages: parsed.messages,
        medias: parsed.medias || [],
        plans: parsed.plans || [],
        text: undefined // Remover text se houver messages
      };
    }
    
    // Se tiver text, manter como está
    if (parsed.text) {
      return {
        text: String(parsed.text),
        media_ids: parsed.media_ids || [],
        buttons: parsed.buttons || [],
        medias: parsed.medias || []
      };
    }
    
    // Fallback: retornar estrutura vazia
    return {
      text: '',
      media_ids: [],
      buttons: [],
      medias: []
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
      row.content = this.normalizeContent(row.content);
      return row;
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
        medias: contentObj.medias || []
      };
    } else if (contentObj.text) {
      // Formato antigo: usar campo text direto
      const text = replaceText(String(contentObj.text));
      
      return {
        text,
        media_ids: contentObj.media_ids || [],
        buttons: contentObj.buttons || [],
        medias: contentObj.medias || []
      };
    } else {
      return {
        text: '',
        media_ids: [],
        buttons: [],
        medias: []
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
      // Se ausentes, usar defaults: media_mode='group', attach_text_as_caption=false
      let mediaMode = template.content?.media_mode || 'group';
      let attachTextAsCaption = template.content?.attach_text_as_caption;
      
      // Validar media_mode (aceitar apenas 'group' ou 'single')
      if (mediaMode !== 'group' && mediaMode !== 'single') {
        mediaMode = 'group';
      }
      
      // Normalizar attach_text_as_caption (default: false se ausente)
      if (attachTextAsCaption === undefined || attachTextAsCaption === null) {
        attachTextAsCaption = false;
      } else {
        attachTextAsCaption = Boolean(attachTextAsCaption);
      }
      
      if (messageType === 'start') {
        console.info('[START:CONFIG_NORMALIZED]', JSON.stringify({
          botId,
          mediaMode,
          attachTextAsCaption,
          timestamp: new Date().toISOString()
        }));
      }

      // 4. Preparar payloads para Telegram (um por mensagem)
      const payloads = this.prepareTelegramPayloads(telegramId, renderedContent, medias, mediaMode, attachTextAsCaption);

      if (!payloads || payloads.length === 0) {
        throw new Error(`Nenhum payload para enviar`);
      }

      // 5. Enviar via Telegram API (se botToken fornecido)
      let responses = [];
      if (botToken) {
        for (let i = 0; i < payloads.length; i++) {
          const payload = payloads[i];
          try {
            const response = await this.sendViaTelegramAPI(botToken, payload);
            responses.push(response);
            // Pequeno delay entre mensagens para não sobrecarregar Telegram
            if (i < payloads.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (sendError) {
            // Continuar tentando enviar as próximas mensagens
          }
        }
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
    const priorityMap = {
      'audio': 0,
      'video': 1,
      'photo': 2,
      'document': 3
    };

    const sorted = [...medias].sort((a, b) => {
      const priorityA = priorityMap[a.kind] !== undefined ? priorityMap[a.kind] : 99;
      const priorityB = priorityMap[b.kind] !== undefined ? priorityMap[b.kind] : 99;
      return priorityA - priorityB;
    });

    return sorted;
  }

  /**
   * CP-2: Decidir rigidamente entre group/single baseado em elegibilidade
   * group: apenas se media_mode==='group' E existem ≥2 mídias elegíveis (foto/vídeo com tg_file_id)
   * Caso contrário: single
   * 
   * @param {string} requestedMode - 'group' ou 'single' (do template)
   * @param {array} medias - array de mídias resolvidas
   * @returns {object} { decided: 'group'|'single', reason: string }
   */
  decideMediaMode(requestedMode, medias = []) {
    // Contar mídias elegíveis para group (foto/vídeo com tg_file_id)
    const elegibleForGroup = medias.filter(m => 
      ['photo', 'video'].includes(m.kind) && m.tg_file_id
    ).length;

    // Decidir rigidamente
    const decided = (requestedMode === 'group' && elegibleForGroup >= 2) ? 'group' : 'single';
    const reason = requestedMode === 'group' 
      ? (elegibleForGroup >= 2 ? `group_eligible_${elegibleForGroup}_medias` : `single_fallback_only_${elegibleForGroup}_elegible`)
      : 'single_requested';

    return { decided, reason };
  }

  /**
   * Preparar múltiplos payloads para Telegram API
   * Um payload por mensagem (suporta até 3 mensagens)
   * Mídias são anexadas apenas à primeira mensagem
   * renderedContent: { text, media_ids, buttons, medias, media_mode }
   * media_mode: 'group' (álbum) ou 'single' (individual)
   * attachTextAsCaption: se true, usar primeiro texto como caption do primeiro item
   */
  prepareTelegramPayloads(telegramId, renderedContent, medias = [], mediaMode = 'group', attachTextAsCaption = false) {
    const payloads = [];
    
    // Priorizar mídias: áudio > vídeo > foto
    const prioritizedMedias = this.prioritizeMedias(medias);
    
    // CP-2: Decidir rigidamente entre group/single baseado em elegibilidade
    const modeDecision = this.decideMediaMode(mediaMode, prioritizedMedias);
    const decidedMode = modeDecision.decided;
    
    console.info('[START:MEDIA_MODE]', JSON.stringify({
      requested: mediaMode,
      decided: decidedMode,
      reason: modeDecision.reason,
      mediaCount: prioritizedMedias.length,
      timestamp: new Date().toISOString()
    }));

    // Logar ordem de priorização
    if (prioritizedMedias.length > 0) {
      const order = prioritizedMedias.map(m => m.kind);
      console.info('[START:MEDIA_ORDER]', JSON.stringify({
        before: medias.length,
        after_sorted: prioritizedMedias.length,
        order: order,
        timestamp: new Date().toISOString()
      }));
    }
    
    // Se houver array de mensagens, criar um payload por mensagem
    if (renderedContent.messages && Array.isArray(renderedContent.messages)) {
      renderedContent.messages.forEach((msgItem, index) => {
        // Garantir que msgItem é string
        const text = typeof msgItem === 'string' ? msgItem : String(msgItem || '');
        const trimmedText = (text || '').trim();
        
        if (!trimmedText) {
          return;
        }
        
        const payload = {
          chat_id: telegramId,
          text: trimmedText,
          parse_mode: 'MarkdownV2'
        };
        
        // Anexar mídias apenas à primeira mensagem
        if (index === 0 && prioritizedMedias.length > 0) {
          // Filtrar mídias que têm tg_file_id (nunca enviar URL diretamente)
          const validMedias = prioritizedMedias.filter(media => media.tg_file_id);
          
          if (validMedias.length > 0) {
            if (decidedMode === 'group') {
              // Modo grupo: agrupar fotos e vídeos em álbum, enviar áudios isoladamente
              const groupableMedias = validMedias.filter(m => ['photo', 'video'].includes(m.kind));
              const isolatedMedias = validMedias.filter(m => !['photo', 'video'].includes(m.kind));
              
              if (groupableMedias.length > 0) {
                // Criar payload de álbum (máximo 10 itens)
                // CP-1: Respeitar attachTextAsCaption - só adicionar caption se true
                payload.media = groupableMedias.slice(0, 10).map((media, mediaIndex) => ({
                  type: this.mapMediaKindToTelegramType(media.kind),
                  media: media.tg_file_id,
                  caption: (mediaIndex === 0 && attachTextAsCaption) ? trimmedText : undefined,
                  parse_mode: 'MarkdownV2'
                }));
                
                console.info('[START:MEDIA_GROUP:SEND]', JSON.stringify({
                  items: groupableMedias.length,
                  sent: true,
                  reason: 'group_mode',
                  timestamp: new Date().toISOString()
                }));
              }
              
              // Mídias isoladas (áudio, documento) serão enviadas em payloads separados
              isolatedMedias.forEach((media, isolatedIndex) => {
                const isolatedPayload = {
                  chat_id: telegramId,
                  parse_mode: 'MarkdownV2'
                };
                
                const mediaType = this.mapMediaKindToTelegramType(media.kind);
                isolatedPayload[mediaType === 'audio' ? 'audio' : mediaType === 'document' ? 'document' : 'photo'] = media.tg_file_id;
                
                if (isolatedIndex === 0 && !payload.media) {
                  // Se não houver álbum, adicionar caption ao primeiro isolado
                  isolatedPayload.caption = trimmedText;
                }
                
                payloads.push(isolatedPayload);
                
                console.info('[START:MEDIA_SINGLE:SEND]', JSON.stringify({
                  index: isolatedIndex,
                  kind: media.kind,
                  sent: true,
                  timestamp: new Date().toISOString()
                }));
              });
            } else {
              // Modo single: enviar cada mídia individualmente
              validMedias.forEach((media, mediaIndex) => {
                const singlePayload = {
                  chat_id: telegramId,
                  parse_mode: 'MarkdownV2'
                };
                
                const mediaType = this.mapMediaKindToTelegramType(media.kind);
                singlePayload[mediaType === 'audio' ? 'audio' : mediaType === 'document' ? 'document' : mediaType === 'video' ? 'video' : 'photo'] = media.tg_file_id;
                
                // CP-1: Respeitar attachTextAsCaption - só adicionar caption ao primeiro se true
                if (mediaIndex === 0 && attachTextAsCaption) {
                  singlePayload.caption = trimmedText;
                }
                
                payloads.push(singlePayload);
                
                console.info('[START:MEDIA_SINGLE:SEND]', JSON.stringify({
                  index: mediaIndex,
                  kind: media.kind,
                  sent: true,
                  timestamp: new Date().toISOString()
                }));
              });
            }
          }
        }
        
        // Anexar botões apenas à primeira mensagem
        if (index === 0 && renderedContent.buttons && renderedContent.buttons.length > 0) {
          payload.reply_markup = {
            inline_keyboard: renderedContent.buttons.map(btn => [
              {
                text: btn.text,
                callback_data: btn.callback_data
              }
            ])
          };
        }
        
        // Sempre adicionar payload de texto (com ou sem mídias)
        payloads.push(payload);
      });
    } else {
      // Fallback: usar o método antigo de um único payload
      const payload = this.prepareTelegramPayload(telegramId, renderedContent, prioritizedMedias, mediaMode, attachTextAsCaption);
      if (payload) {
        payloads.push(payload);
      }
    }
    
    return payloads;
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

      // CP-4: Se houver mídias em array (sendMediaGroup)
      if (payload.media && Array.isArray(payload.media) && payload.media.length > 0) {
        const response = await axios.post(`${apiUrl}/sendMediaGroup`, {
          chat_id: payload.chat_id,
          media: payload.media
        }, { timeout: 5000, validateStatus: () => true });

        if (response.data.ok) {
          console.info('[START:SEND:GROUP]', JSON.stringify({
            count: payload.media.length,
            sent: true,
            timestamp: new Date().toISOString()
          }));
          return {
            ok: true,
            message_ids: response.data.result.map(m => m.message_id)
          };
        }
        // CP-8: Logar erro 400 com body sanitizado
        const errorDesc = response.data?.description || 'Unknown error';
        const sanitizedError = this._sanitizeTelegramError(errorDesc);
        console.error('[START:SEND:GROUP:ERROR]', JSON.stringify({
          count: payload.media.length,
          status: response.status,
          error: sanitizedError,
          timestamp: new Date().toISOString()
        }));
        // Não quebrar fluxo; degradar gracefully
        return {
          ok: false,
          error: sanitizedError
        };
      }

      // CP-5: Se houver mídia individual (photo/video/audio/document)
      const mediaFields = ['photo', 'video', 'audio', 'document'];
      for (const field of mediaFields) {
        if (payload[field]) {
          const method = `send${field.charAt(0).toUpperCase() + field.slice(1)}`;
          const sendPayload = {
            chat_id: payload.chat_id,
            [field]: payload[field],
            parse_mode: payload.parse_mode || 'HTML'
          };

          // Adicionar caption se existir
          if (payload.caption) {
            sendPayload.caption = payload.caption;
            sendPayload.parse_mode = payload.parse_mode || 'MarkdownV2';
          }

          // Adicionar botões se existirem
          if (payload.reply_markup) {
            sendPayload.reply_markup = payload.reply_markup;
          }

          const response = await axios.post(`${apiUrl}/${method}`, sendPayload, { 
            timeout: 5000,
            validateStatus: () => true 
          });

          if (response.data.ok) {
            console.info('[START:SEND:SINGLE]', JSON.stringify({
              kind: field,
              sent: true,
              timestamp: new Date().toISOString()
            }));
            return {
              ok: true,
              message_id: response.data.result.message_id
            };
          }
          // CP-8: Logar erro 400 com body sanitizado
          const errorDesc = response.data?.description || 'Unknown error';
          const sanitizedError = this._sanitizeTelegramError(errorDesc);
          console.error('[START:SEND:SINGLE:ERROR]', JSON.stringify({
            kind: field,
            status: response.status,
            error: sanitizedError,
            timestamp: new Date().toISOString()
          }));
          // Não quebrar fluxo; tentar próxima mídia ou degradar
          return {
            ok: false,
            error: sanitizedError
          };
        }
      }

      // CP-6: Caso contrário, enviar apenas texto
      if (!payload.text) {
        throw new Error('Nenhum conteúdo para enviar (sem texto ou mídia)');
      }

      const sendPayload = {
        chat_id: payload.chat_id,
        text: payload.text,
        parse_mode: payload.parse_mode || 'HTML'
      };

      // Adicionar botões se existirem
      if (payload.reply_markup) {
        sendPayload.reply_markup = payload.reply_markup;
      }

      const response = await axios.post(`${apiUrl}/sendMessage`, sendPayload, { 
        timeout: 5000,
        validateStatus: () => true 
      });

      if (response.data.ok) {
        console.info('[START:TEXT_SEND]', JSON.stringify({
          len: payload.text.length,
          timestamp: new Date().toISOString()
        }));
        return {
          ok: true,
          message_id: response.data.result.message_id
        };
      }

      // CP-8: Logar erro 400 com body sanitizado
      const errorDesc = response.data?.description || 'Unknown error';
      const sanitizedError = this._sanitizeTelegramError(errorDesc);
      console.error('[START:TEXT_SEND:ERROR]', JSON.stringify({
        status: response.status,
        error: sanitizedError,
        timestamp: new Date().toISOString()
      }));
      // Não quebrar fluxo; retornar erro mas não lançar exceção
      return {
        ok: false,
        error: sanitizedError
      };
    } catch (error) {
      console.error(`[ERRO][TELEGRAM_API] ${error.message}`);
      throw error;
    }
  }
}

module.exports = MessageService;
