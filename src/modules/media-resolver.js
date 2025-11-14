/**
 * Media Resolver - Resolução centralizada de mídias
 * 
 * Responsabilidades:
 * - Resolver mídias de start_config para mídias com tg_file_id
 * - Buscar em media_cache por (bot_slug, kind, sha256)
 * - Garantir que NUNCA envia URL diretamente
 * - Logar pipeline completo de resolução
 * 
 * Fluxo:
 * 1. Receber array de mídias de start_config: [{ kind, key, caption }]
 * 2. Para cada mídia, buscar em media_cache por (bot_slug, kind, key)
 * 3. Se encontrar com tg_file_id e status='ready', retornar
 * 4. Se não encontrar ou sem tg_file_id, pular com razão
 * 5. Retornar array de mídias resolvidas (com tg_file_id)
 */

// OTIMIZAÇÃO CRÍTICA: Cache global compartilhado entre todas as instâncias
const GLOBAL_MEDIA_CACHE = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas (86400000ms)

class MediaResolver {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = config;
  }

  /**
   * Limpar cache expirado
   */
  _cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of GLOBAL_MEDIA_CACHE.entries()) {
      if (entry.expiry < now) {
        GLOBAL_MEDIA_CACHE.delete(key);
      }
    }
  }

  /**
   * Buscar mídia no cache em memória primeiro
   */
  _getCachedMedia(botSlug, kind, sha256) {
    const key = `${botSlug}:${kind}:${sha256}`;
    const entry = GLOBAL_MEDIA_CACHE.get(key);
    
    if (entry && entry.expiry > Date.now()) {
      return entry.data;
    }
    
    return null;
  }

  /**
   * Salvar mídia no cache em memória
   */
  _setCachedMedia(botSlug, kind, sha256, data) {
    const key = `${botSlug}:${kind}:${sha256}`;
    GLOBAL_MEDIA_CACHE.set(key, {
      data,
      expiry: Date.now() + CACHE_TTL
    });
  }

  /**
   * Resolver mídias de start_config para mídias prontas para envio
   * 
   * @param {string} botSlug - slug do bot (ex: 'vipshadriee_bot')
   * @param {array} mediasInConfig - array de mídias do start_config: [{ kind, key, caption }]
   * @returns {array} array de mídias resolvidas: [{ kind, tg_file_id, caption }]
   */
  async resolveMedias(botSlug, mediasInConfig = []) {
    const startTime = Date.now();
    const reasonsSkipped = [];
    const resolvedMedias = [];
    const totalInConfig = Array.isArray(mediasInConfig) ? mediasInConfig.length : 0;

    // OTIMIZAÇÃO: Limpeza periódica do cache (a cada 100 requests)
    if (Math.random() < 0.01) { // 1% de chance
      this._cleanExpiredCache();
    }

    console.info(`START:MEDIA_RESOLVE_START { mediasInConfig:${totalInConfig} }`);

    if (!mediasInConfig || mediasInConfig.length === 0) {
      console.info('START:MEDIA_RESOLVE_END { mediasInConfig:0, resolved:0, skipped:0 }');
      return resolvedMedias;
    }

    for (let i = 0; i < mediasInConfig.length; i++) {
      const media = mediasInConfig[i];
      const mediaKind = media.kind || 'document';
      const mediaKey = media.key || media.sha256 || media.id;

      try {
        // Validar que temos os dados mínimos
        if (!mediaKey) {
          reasonsSkipped.push(`media_${i}_no_key`);
          console.warn(`[MEDIA_RESOLVER] Mídia ${i} sem key/sha256`);
          continue;
        }

        // OTIMIZAÇÃO: Buscar no cache em memória primeiro
        let cachedMedia = this._getCachedMedia(botSlug, mediaKind, mediaKey);
        
        if (cachedMedia) {
          console.log(`[MEDIA_RESOLVER] Mídia ${i} CACHE HIT: kind=${mediaKind}`);
        } else {
          console.log(`[MEDIA_RESOLVER] Mídia ${i} CACHE MISS: kind=${mediaKind}`);
          // Se não está no cache em memória, buscar no banco
          const queryStart = Date.now();
          const cacheResult = await this.pool.query(
            `SELECT id, tg_file_id, tg_file_unique_id, status
             FROM media_cache
             WHERE bot_slug = $1 AND kind = $2 AND sha256 = $3
             LIMIT 1`,
            [botSlug, mediaKind, mediaKey]
          );
          const queryDuration = Date.now() - queryStart;
          if (queryDuration > 100) {
            console.warn(`[MEDIA_RESOLVER] Query lenta: ${queryDuration}ms`);
          }

          if (cacheResult.rows.length === 0) {
            reasonsSkipped.push(`media_${i}_not_in_cache`);
            console.warn(`[MEDIA_RESOLVER] Mídia ${i} não encontrada em cache: kind=${mediaKind}, key=${mediaKey.substring(0, 20)}...`);
            continue;
          }

          cachedMedia = cacheResult.rows[0];
          
          // CORREÇÃO: Sempre salvar no cache, mesmo se inválida (para evitar queries repetidas)
          this._setCachedMedia(botSlug, mediaKind, mediaKey, cachedMedia);
          console.log(`[MEDIA_RESOLVER] Mídia ${i} CACHED: kind=${mediaKind}, valid=${Boolean(cachedMedia.tg_file_id && cachedMedia.status === 'ready')}`);
        }

        // Validar que tem tg_file_id e status='ready'
        if (!cachedMedia.tg_file_id) {
          reasonsSkipped.push(`media_${i}_no_file_id`);
          console.warn(`[MEDIA_RESOLVER] Mídia ${i} em cache mas sem tg_file_id: status=${cachedMedia.status}`);
          continue;
        }

        if (cachedMedia.status !== 'ready') {
          reasonsSkipped.push(`media_${i}_status_${cachedMedia.status}`);
          console.warn(`[MEDIA_RESOLVER] Mídia ${i} com status inválido: ${cachedMedia.status}`);
          continue;
        }

        // Mídia válida - adicionar ao resultado
        resolvedMedias.push({
          kind: mediaKind,
          tg_file_id: cachedMedia.tg_file_id,
          tg_file_unique_id: cachedMedia.tg_file_unique_id,
          caption: media.caption || '',
          cache_id: cachedMedia.id
        });

        console.log(`[MEDIA_RESOLVER] Mídia ${i} resolvida com sucesso: kind=${mediaKind}`);
      } catch (error) {
        reasonsSkipped.push(`media_${i}_error`);
        console.error(`[MEDIA_RESOLVER] Erro ao resolver mídia ${i}: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    console.info(`START:MEDIA_RESOLVE_END { mediasInConfig:${mediasInConfig.length}, resolved:${resolvedMedias.length}, skipped:${reasonsSkipped.length} }`);

    console.log(`[MEDIA_RESOLVER] Completo: medias_in_config=${mediasInConfig.length}, resolved=${resolvedMedias.length}, skipped=${reasonsSkipped.length}, duration=${duration}ms`);

    return resolvedMedias;
  }

  /**
   * Validar que bot tem warmup_chat_id configurado e é admin do canal
   * 
   * @param {number} botId - ID do bot
   * @param {string} botToken - token do bot (descriptografado)
   * @returns {object} { ok: boolean, warmup_chat_id?: number, error?: string }
   */
  async validateWarmupSetup(botId, botToken) {
    try {
      const botResult = await this.pool.query(
        `SELECT warmup_chat_id FROM bots WHERE id = $1`,
        [botId]
      );

      if (botResult.rows.length === 0) {
        return { ok: false, error: 'Bot não encontrado' };
      }

      const warmupChatId = botResult.rows[0].warmup_chat_id;

      if (!warmupChatId) {
        return { ok: false, error: 'warmup_chat_id não configurado' };
      }

      // Validar formato de chat_id (deve ser BIGINT negativo para grupos)
      if (warmupChatId > 0) {
        return { ok: false, error: `warmup_chat_id inválido (deve ser negativo para grupos): ${warmupChatId}` };
      }

      console.log(`[MEDIA_RESOLVER:WARMUP] Bot ${botId} tem warmup_chat_id válido: ${warmupChatId}`);

      return { ok: true, warmup_chat_id: warmupChatId };
    } catch (error) {
      console.error(`[MEDIA_RESOLVER:WARMUP] Erro ao validar setup: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Logar diagnóstico completo de mídias de um bot
   * Útil para debugging
   */
  async logMediaDiagnostics(botSlug) {
    try {
      const result = await this.pool.query(
        `SELECT id, kind, sha256, status, tg_file_id, warmup_chat_id, last_error
         FROM media_cache
         WHERE bot_slug = $1
         ORDER BY kind, created_at DESC`,
        [botSlug]
      );

      console.log(`[MEDIA_RESOLVER:DIAGNOSTICS] Bot ${botSlug}: ${result.rows.length} mídias em cache`);

      result.rows.forEach((row, idx) => {
        const hasFileId = row.tg_file_id ? 'YES' : 'NO';
        const error = row.last_error ? ` error="${row.last_error}"` : '';
        console.log(`  [${idx + 1}] kind=${row.kind} status=${row.status} file_id=${hasFileId}${error}`);
      });
    } catch (error) {
      console.error(`[MEDIA_RESOLVER:DIAGNOSTICS] Erro: ${error.message}`);
    }
  }
}

module.exports = MediaResolver;
