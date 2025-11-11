/**
 * Serviço de Warmup de Mídia
 * Responsável por enviar mídias para um grupo de aquecimento
 * e capturar file_id do Telegram para cache
 */

const axios = require('axios');

class MediaWarmupService {
  constructor(pool) {
    this.pool = pool;
    this.telegramApiUrl = 'https://api.telegram.org';
  }

  /**
   * Fazer warmup de uma mídia
   * @param {number} botId - ID do bot
   * @param {string} botToken - Token do bot Telegram
   * @param {string} mediaKey - Chave única da mídia (sha256 ou similar)
   * @param {string} kind - Tipo: photo, video, audio, document
   * @param {string} filePath - Caminho do arquivo local ou URL
   * @param {number} warmupChatId - ID do chat de aquecimento
   * @returns {Promise<object>} { success, file_id, file_unique_id, message_id, error? }
   */
  async warmupMedia(botId, botToken, mediaKey, kind, filePath, warmupChatId) {
    try {
      if (!botToken || !warmupChatId) {
        return {
          success: false,
          error: 'Token ou warmup_chat_id não configurado'
        };
      }

      // Determinar método de envio baseado no tipo
      const method = this._getMethodByKind(kind);
      if (!method) {
        return {
          success: false,
          error: `Tipo de mídia não suportado: ${kind}`
        };
      }

      // Enviar para Telegram
      const response = await this._sendToTelegram(botToken, warmupChatId, method, filePath);

      if (!response.ok) {
        return {
          success: false,
          error: response.description || 'Erro ao enviar para Telegram'
        };
      }

      // Extrair file_id da resposta
      const fileId = this._extractFileId(response.result, kind);
      const fileUniqueId = this._extractFileUniqueId(response.result, kind);
      const messageId = response.result.message_id;

      // Salvar no cache
      await this._saveToCacheDb(botId, mediaKey, kind, fileId, fileUniqueId, warmupChatId, messageId);

      console.log(`[MEDIA_WARMUP] ✓ Warmup concluído: bot=${botId} key=${mediaKey} file_id=${fileId}`);

      return {
        success: true,
        file_id: fileId,
        file_unique_id: fileUniqueId,
        message_id: messageId,
        warmup_chat_id: warmupChatId
      };
    } catch (error) {
      console.error(`[MEDIA_WARMUP] ✗ Erro ao fazer warmup: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter método de envio baseado no tipo de mídia
   */
  _getMethodByKind(kind) {
    const methods = {
      photo: 'sendPhoto',
      video: 'sendVideo',
      audio: 'sendAudio',
      document: 'sendDocument'
    };
    return methods[kind];
  }

  /**
   * Extrair file_id da resposta do Telegram
   */
  _extractFileId(result, kind) {
    if (!result) return null;

    const fileIdPaths = {
      photo: 'photo[0].file_id',
      video: 'video.file_id',
      audio: 'audio.file_id',
      document: 'document.file_id'
    };

    const path = fileIdPaths[kind];
    if (!path) return null;

    return this._getNestedValue(result, path);
  }

  /**
   * Extrair file_unique_id da resposta do Telegram
   */
  _extractFileUniqueId(result, kind) {
    if (!result) return null;

    const fileUniqueIdPaths = {
      photo: 'photo[0].file_unique_id',
      video: 'video.file_unique_id',
      audio: 'audio.file_unique_id',
      document: 'document.file_unique_id'
    };

    const path = fileUniqueIdPaths[kind];
    if (!path) return null;

    return this._getNestedValue(result, path);
  }

  /**
   * Obter valor aninhado de um objeto
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, prop) => {
      if (prop.includes('[')) {
        const [key, index] = prop.match(/(\w+)\[(\d+)\]/).slice(1);
        return current?.[key]?.[parseInt(index)];
      }
      return current?.[prop];
    }, obj);
  }

  /**
   * Enviar mídia para Telegram
   */
  async _sendToTelegram(botToken, chatId, method, filePath) {
    try {
      const url = `${this.telegramApiUrl}/bot${botToken}/${method}`;
      
      // Preparar FormData para upload
      const FormData = require('form-data');
      const fs = require('fs');
      const form = new FormData();

      form.append('chat_id', chatId);

      // Determinar campo baseado no método
      const fileField = {
        sendPhoto: 'photo',
        sendVideo: 'video',
        sendAudio: 'audio',
        sendDocument: 'document'
      }[method];

      // Se for URL, usar parse_mode; se for arquivo local, fazer upload
      if (filePath.startsWith('http')) {
        form.append(fileField, filePath);
      } else {
        // Arquivo local
        if (!fs.existsSync(filePath)) {
          throw new Error(`Arquivo não encontrado: ${filePath}`);
        }
        form.append(fileField, fs.createReadStream(filePath));
      }

      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error(`[MEDIA_WARMUP] Erro ao enviar para Telegram: ${error.message}`);
      throw error;
    }
  }

  /**
   * Salvar no banco de dados de cache
   */
  async _saveToCacheDb(botId, mediaKey, kind, fileId, fileUniqueId, warmupChatId, messageId) {
    try {
      // Verificar se já existe
      const existingResult = await this.pool.query(
        `SELECT id FROM media_cache 
         WHERE bot_id = $1 AND media_key = $2`,
        [botId, mediaKey]
      );

      if (existingResult.rows.length > 0) {
        // Atualizar
        await this.pool.query(
          `UPDATE media_cache 
           SET tg_file_id = $1, tg_file_unique_id = $2, 
               warmup_chat_id = $3, warmup_message_id = $4,
               status = 'ready', updated_at = NOW()
           WHERE id = $5`,
          [fileId, fileUniqueId, warmupChatId, messageId, existingResult.rows[0].id]
        );
      } else {
        // Criar
        await this.pool.query(
          `INSERT INTO media_cache 
           (bot_id, media_key, kind, tg_file_id, tg_file_unique_id, 
            warmup_chat_id, warmup_message_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', NOW(), NOW())`,
          [botId, mediaKey, kind, fileId, fileUniqueId, warmupChatId, messageId]
        );
      }
    } catch (error) {
      console.error(`[MEDIA_WARMUP] Erro ao salvar no cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obter mídia do cache
   */
  async getFromCache(botId, mediaKey) {
    try {
      const result = await this.pool.query(
        `SELECT * FROM media_cache 
         WHERE bot_id = $1 AND media_key = $2 AND status = 'ready'
         LIMIT 1`,
        [botId, mediaKey]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error(`[MEDIA_WARMUP] Erro ao buscar do cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Limpar cache de uma mídia
   */
  async clearCache(botId, mediaKey) {
    try {
      await this.pool.query(
        `DELETE FROM media_cache 
         WHERE bot_id = $1 AND media_key = $2`,
        [botId, mediaKey]
      );
    } catch (error) {
      console.error(`[MEDIA_WARMUP] Erro ao limpar cache: ${error.message}`);
    }
  }
}

module.exports = MediaWarmupService;
