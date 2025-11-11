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

class MessageService {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
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

      if (messageType === 'start') {
        // Buscar em bot_messages com slug='start'
        result = await this.pool.query(
          `SELECT id, bot_id, slug, content, active, created_at, updated_at 
           FROM bot_messages 
           WHERE bot_id = $1 AND slug = $2 AND active = TRUE 
           LIMIT 1`,
          [botId, 'start']
        );
      } else if (messageType === 'downsell') {
        // Buscar em bot_downsells (primeira disponível)
        result = await this.pool.query(
          `SELECT id, bot_id, slug, content, active, created_at, updated_at 
           FROM bot_downsells 
           WHERE bot_id = $1 AND active = TRUE 
           ORDER BY delay_seconds ASC
           LIMIT 1`,
          [botId]
        );
      } else if (messageType === 'shot') {
        // Buscar em shots (primeira disponível)
        result = await this.pool.query(
          `SELECT id, bot_id, slug, content, active, created_at, updated_at 
           FROM shots 
           WHERE bot_id = $1 AND active = TRUE 
           ORDER BY created_at DESC
           LIMIT 1`,
          [botId]
        );
      } else {
        console.warn(`[MESSAGE] Tipo de mensagem desconhecido: type=${messageType}`);
        return null;
      }

      if (result.rows.length === 0) {
        console.warn(`[MESSAGE] Template não encontrado: bot=${botId} type=${messageType}`);
        return null;
      }

      const row = result.rows[0];
      // Normalizar content para JSON
      row.content = this.normalizeContent(row.content);
      return row;
    } catch (error) {
      console.error(`[ERRO][MESSAGE] Falha ao buscar template: bot=${botId} type=${messageType} error=${error.message}`);
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
   *   file_id: string (Telegram file_id se em cache),
   *   url: string (URL da mídia se não em cache),
   *   media_store_id: number
   * }
   */
  async getMessageMedia(messageId, limit = 3) {
    try {
      // Buscar referências de mídia para esta mensagem
      // Assumindo que existe uma tabela de relacionamento (ex: message_media)
      // Por enquanto, retornar array vazio até que a tabela seja criada
      
      // TODO: Implementar quando tabela message_media for criada
      // SELECT mc.id, mc.kind, mc.file_id, ms.url, ms.id as media_store_id
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
    
    console.log(`[MESSAGE_SERVICE][RENDER] contentObj keys:`, Object.keys(contentObj));
    
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
        console.warn(`[MESSAGE_SERVICE][RENDER] Texto não é string, convertendo:`, typeof text, text);
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
      
      console.log(`[MESSAGE_SERVICE][RENDER] Usando novo formato (messages array), ${messages.length} mensagens`);
      
      return {
        messages,
        media_ids: contentObj.media_ids || [],
        buttons: contentObj.buttons || [],
        medias: contentObj.medias || []
      };
    } else if (contentObj.text) {
      // Formato antigo: usar campo text direto
      const text = replaceText(String(contentObj.text));
      console.log(`[MESSAGE_SERVICE][RENDER] Usando formato antigo (text field), text length: ${text.length}`);
      
      return {
        text,
        media_ids: contentObj.media_ids || [],
        buttons: contentObj.buttons || [],
        medias: contentObj.medias || []
      };
    } else {
      console.warn(`[MESSAGE_SERVICE][RENDER] Nenhum texto encontrado em contentObj`);
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
   * 2. Buscar mídias
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

      // 2. Buscar mídias
      const medias = await this.getMessageMedia(template.id, 3);

      // 3. Renderizar conteúdo (retorna todas as mensagens)
      const renderedContent = this.renderContent(template, context);

      // 4. Preparar payloads para Telegram (um por mensagem)
      const payloads = this.prepareTelegramPayloads(telegramId, renderedContent, medias);
      
      if (!payloads || payloads.length === 0) {
        throw new Error(`Nenhum payload para enviar`);
      }

      // 5. Enviar via Telegram API (se botToken fornecido)
      let responses = [];
      if (botToken) {
        console.log(`[MESSAGE_SERVICE][DEBUG] Enviando ${payloads.length} mensagem(ns) para Telegram: chat_id=${telegramId}`);
        for (let i = 0; i < payloads.length; i++) {
          const payload = payloads[i];
          console.log(`[MESSAGE_SERVICE][DEBUG] Mensagem ${i + 1}/${payloads.length}: text_length=${payload.text?.length || 0}`);
          try {
            const response = await this.sendViaTelegramAPI(botToken, payload);
            responses.push(response);
            // Pequeno delay entre mensagens para não sobrecarregar Telegram
            if (i < payloads.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (sendError) {
            console.error(`[ERRO][MESSAGE_SERVICE][SEND] Mensagem ${i + 1} falhou: ${sendError.message}`);
            // Continuar tentando enviar as próximas mensagens
          }
        }
      } else {
        console.warn(`[MESSAGE_SERVICE][WARN] Bot token não fornecido, pulando envio via Telegram`);
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
        } catch (dbError) {
          console.error(`[ERRO][MESSAGE_SERVICE][FUNNEL_EVENT] event=${eventName} bot=${botId} user=${telegramId} error=${dbError.message}`);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[BOT][MESSAGE] type=${messageType} user=${telegramId} messages=${payloads.length} medias=${medias.length} latency=${duration}ms sent=${responses.length > 0}`);

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
      console.error(`[ERRO][MESSAGE] type=${messageType} user=${telegramId} error=${error.message} latency=${duration}ms`);
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
   * Preparar múltiplos payloads para Telegram API
   * Um payload por mensagem (suporta até 3 mensagens)
   * Mídias são anexadas apenas à primeira mensagem
   * renderedContent: { text, media_ids, buttons, medias }
   */
  prepareTelegramPayloads(telegramId, renderedContent, medias = []) {
    const payloads = [];
    
    // Se houver array de mensagens, criar um payload por mensagem
    if (renderedContent.messages && Array.isArray(renderedContent.messages)) {
      renderedContent.messages.forEach((msgItem, index) => {
        // Garantir que msgItem é string
        const text = typeof msgItem === 'string' ? msgItem : String(msgItem || '');
        const trimmedText = (text || '').trim();
        
        if (!trimmedText) {
          console.warn(`[MESSAGE_SERVICE] Pulando mensagem vazia no índice ${index}`);
          return;
        }
        
        const payload = {
          chat_id: telegramId,
          text: trimmedText,
          parse_mode: 'MarkdownV2'
        };
        
        // Anexar mídias apenas à primeira mensagem
        if (index === 0 && medias.length > 0) {
          payload.media = medias.slice(0, 3).map((media, mediaIndex) => ({
            type: this.mapMediaKindToTelegramType(media.kind),
            media: media.file_id || media.url,
            caption: mediaIndex === 0 ? trimmedText : undefined,
            parse_mode: 'MarkdownV2'
          }));
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
        
        payloads.push(payload);
      });
    } else {
      // Fallback: usar o método antigo de um único payload
      const payload = this.prepareTelegramPayload(telegramId, renderedContent, medias);
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
   */
  prepareTelegramPayload(telegramId, renderedContent, medias = []) {
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
      // Telegram permite enviar múltiplas mídias via media_group
      // Aqui preparamos a estrutura
      payload.media = medias.slice(0, 3).map((media, index) => ({
        type: this.mapMediaKindToTelegramType(media.kind),
        media: media.file_id || media.url,
        caption: index === 0 && trimmedText ? trimmedText : undefined,
        parse_mode: trimmedText ? 'MarkdownV2' : undefined
      }));
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
   * Enviar via Telegram API
   * Suporta texto simples e media groups
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

      // Se houver mídias, usar sendMediaGroup
      if (payload.media && payload.media.length > 0) {
        const response = await axios.post(`${apiUrl}/sendMediaGroup`, {
          chat_id: payload.chat_id,
          media: payload.media
        }, { timeout: 5000 });

        if (response.data.ok) {
          return {
            ok: true,
            message_ids: response.data.result.map(m => m.message_id)
          };
        }
        throw new Error(`Telegram API error: ${response.data.description}`);
      }

      // Caso contrário, usar sendMessage
      if (!payload.text) {
        throw new Error('Nenhum texto para enviar');
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

      const response = await axios.post(`${apiUrl}/sendMessage`, sendPayload, { timeout: 5000 });

      if (response.data.ok) {
        return {
          ok: true,
          message_id: response.data.result.message_id
        };
      }

      throw new Error(`Telegram API error: ${response.data.description}`);
    } catch (error) {
      console.error(`[ERRO][TELEGRAM_API] ${error.message}`);
      throw error;
    }
  }
}

module.exports = MessageService;
