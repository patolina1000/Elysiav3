/**
 * Bot Service
 * 
 * Responsabilidades:
 * - Gerenciar bots (CRUD)
 * - Validar slug/name
 * - Invalidar cache quando necessário
 * - Persistir e validar tokens Telegram
 */

const { getCryptoService } = require('./crypto-singleton');
const TelegramValidator = require('./telegram-validator');

class BotService {
  constructor(pool, botEngine) {
    this.pool = pool;
    this.botEngine = botEngine;
    this.crypto = getCryptoService(); // Usar singleton
    this.telegramValidator = new TelegramValidator();
  }

  /**
   * Normalizar slug: converter para lowercase, remover caracteres especiais
   */
  normalizeSlug(input) {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }


  /**
   * Buscar bot por slug
   */
  async getBotBySlug(slug) {
    try {
      const result = await this.pool.query(
        `SELECT 
          id, slug, name, active, provider, 
          gateway_default, token_status, bot_username, bot_name, 
          created_at, updated_at 
         FROM bots WHERE slug = $1`,
        [slug]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao buscar bot', { slug, error });
      throw error;
    }
  }

  /**
   * Criar novo bot
   * Regra: slug e name sempre iguais
   */
  async createBot(input) {
    const normalizedSlug = this.normalizeSlug(input.slug || input.name || '');

    if (!normalizedSlug) {
      throw new Error('Slug inválido: não pode estar vazio');
    }

    // Verificar unicidade de slug
    const existing = await this.getBotBySlug(normalizedSlug);
    if (existing) {
      throw new Error(`Bot com slug "${normalizedSlug}" já existe`);
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO bots (slug, name, active, provider, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id, slug, name, active, provider, created_at, updated_at`,
        [
          normalizedSlug,
          normalizedSlug, // name = slug
          input.active !== false, // default true
          input.provider || 'pushinpay' // default provider
        ]
      );

      const bot = result.rows[0];
      console.log(`[BOT_SERVICE] Bot criado: slug=${bot.slug}`);

      // Invalidar cache
      if (this.botEngine) {
        this.botEngine.botCache.delete(normalizedSlug);
      }

      return bot;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao criar bot:', error);
      throw error;
    }
  }

  /**
   * Atualizar bot
   * Regra: se name mudar, slug é rederivado (e vice-versa)
   */
  async updateBot(botId, input) {
    const bot = await this.getBotById(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} não encontrado`);
    }

    // Estratégia: se houver input.name ou input.slug, normalizar e usar o mesmo para ambos
    let newSlug = bot.slug;
    let newName = bot.name;

    if (input.name || input.slug) {
      const inputValue = input.name || input.slug;
      newSlug = this.normalizeSlug(inputValue);
      newName = newSlug;

      // Se slug está mudando, verificar unicidade
      if (newSlug !== bot.slug) {
        const existing = await this.getBotBySlug(newSlug);
        if (existing) {
          throw new Error(`Bot com slug "${newSlug}" já existe`);
        }
      }
    }

    try {
      const result = await this.pool.query(
        `UPDATE bots 
         SET slug = $1, name = $2, active = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING id, slug, name, active, provider, created_at, updated_at`,
        [
          newSlug,
          newName,
          input.active !== undefined ? input.active : bot.active,
          botId
        ]
      );

      const updated = result.rows[0];
      console.log(`[BOT_SERVICE] Bot atualizado: id=${botId} slug=${updated.slug}`);

      // Invalidar cache
      if (this.botEngine) {
        this.botEngine.botCache.delete(bot.slug);
        this.botEngine.botCache.delete(newSlug);
      }

      return updated;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao atualizar bot', { botId, error });
      throw error;
    }
  }

  /**
   * Deletar bot (soft delete via flag active)
   */
  async deleteBot(botId) {
    try {
      const result = await this.pool.query(
        `UPDATE bots 
         SET active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, name, active`,
        [botId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Bot ${botId} não encontrado`);
      }

      const bot = result.rows[0];
      console.log(`[BOT_SERVICE] Bot desativado: id=${botId} slug=${bot.slug}`);

      // Invalidar cache
      if (this.botEngine) {
        this.botEngine.botCache.delete(bot.slug);
      }

      return bot;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao deletar bot', { botId, error });
      throw error;
    }
  }

  /**
   * Ativar bot
   */
  async activateBot(botId) {
    try {
      const result = await this.pool.query(
        `UPDATE bots 
         SET active = TRUE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, name, active`,
        [botId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Bot ${botId} não encontrado`);
      }

      const bot = result.rows[0];
      console.log(`[BOT_SERVICE] Bot ativado: id=${botId} slug=${bot.slug}`);

      // Invalidar cache
      if (this.botEngine) {
        this.botEngine.botCache.delete(bot.slug);
      }

      return bot;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao ativar bot', { botId, error });
      throw error;
    }
  }

  /**
   * Validar token Telegram e persistir resultado
   * 
   * Fluxo:
   * 1. Verificar rate limit (máx 1 tentativa por bot a cada 10s)
   * 2. Chamar Telegram getMe
   * 3. Se OK: criptografar e persistir token, atualizar status para 'validated'
   * 4. Se erro: persistir status 'invalid' com timestamp
   * 5. Emitir evento interno bot_token_validated
   * 
   * Retorna: { ok: true, username, name, checked_at } ou { ok: false, code, message }
   */
  async validateToken(botId, token) {
    const startTime = Date.now();
    const bot = await this.getBotById(botId);

    if (!bot) {
      throw new Error(`Bot ${botId} não encontrado`);
    }

    // Verificar rate limit
    const rateLimitCheck = this.telegramValidator.checkRateLimit(botId);
    if (!rateLimitCheck.allowed) {
      return {
        ok: false,
        code: 'RATE_LIMIT',
        message: `Aguarde ${rateLimitCheck.waitSeconds}s para tentar novamente`
      };
    }

    // Validar token via Telegram
    const validationResult = await this.telegramValidator.validateToken(token);
    const took = Date.now() - startTime;

    try {
      if (validationResult.ok) {
        // Criptografar token
        const tokenEncrypted = this.crypto.encrypt(token);

        // Persistir dados validados
        await this.pool.query(
          `UPDATE bots 
           SET token_encrypted = $1, 
               token_status = $2, 
               token_checked_at = NOW(),
               bot_username = $3,
               bot_name = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [tokenEncrypted, 'validated', validationResult.username, validationResult.name, botId]
        );

        console.log(
          `[ADMIN][TOKEN][VALIDATE][OK] { slug: ${bot.slug}, username: ${validationResult.username}, name: ${validationResult.name}, took_ms: ${took} }`
        );

        // Emitir evento interno (para futuros ganchos de setWebhook)
        // TODO: Implementar sistema de eventos
        // this.emit('bot_token_validated', { botId, username: validationResult.username });

        return {
          ok: true,
          username: validationResult.username,
          name: validationResult.name,
          checked_at: new Date().toISOString()
        };
      } else {
        // Persistir status 'invalid'
        await this.pool.query(
          `UPDATE bots 
           SET token_status = $1, 
               token_checked_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          ['invalid', botId]
        );

        console.log(
          `[ADMIN][TOKEN][VALIDATE][ERR] { slug: ${bot.slug}, code: ${validationResult.code}, message: ${validationResult.message}, took_ms: ${took} }`
        );

        return {
          ok: false,
          code: validationResult.code,
          message: validationResult.message
        };
      }
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao validar token', { botId, error });
      throw error;
    }
  }

  /**
   * Atualizar gateway padrão e/ou token do bot
   * 
   * Body: { gateway_default?, token_encrypted?, active? }
   * 
   * Nota: token_encrypted é enviado já criptografado do cliente? Não!
   * O cliente envia o token em plaintext, e aqui criptografamos.
   * Mas para compatibilidade com a rota PATCH, aceitamos token_encrypted.
   */
  async updateBotTokenAndGateway(botId, input) {
    const bot = await this.getBotById(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} não encontrado`);
    }

    const updates = {};
    const params = [];
    let paramIndex = 1;

    if (input.gateway_default) {
      updates.gateway_default = `$${paramIndex}`;
      params.push(input.gateway_default);
      paramIndex++;
    }

    if (input.token_encrypted) {
      // Se enviado token em plaintext, criptografar
      const tokenEncrypted = this.crypto.encrypt(input.token_encrypted);
      updates.token_encrypted = `$${paramIndex}`;
      params.push(tokenEncrypted);
      paramIndex++;
    }

    if (input.active !== undefined) {
      updates.active = `$${paramIndex}`;
      params.push(input.active);
      paramIndex++;
    }

    if (Object.keys(updates).length === 0) {
      return bot; // Nada para atualizar
    }

    updates.updated_at = 'NOW()';

    const setClause = Object.entries(updates)
      .map(([key, value]) => `${key} = ${value}`)
      .join(', ');

    params.push(botId);

    const query = `
      UPDATE bots 
      SET ${setClause}
      WHERE id = $${paramIndex}
      RETURNING id, slug, name, active, provider, gateway_default, token_status, bot_username, bot_name, created_at, updated_at
    `;

    try {
      const result = await this.pool.query(query, params);
      const updated = result.rows[0];

      console.log(`[BOT_SERVICE] Bot atualizado: id=${botId} slug=${updated.slug}`);

      // Invalidar cache
      if (this.botEngine) {
        this.botEngine.botCache.delete(bot.slug);
      }

      return updated;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao atualizar token/gateway', { botId, error });
      throw error;
    }
  }

  /**
   * Listar bots com campos de token e gateway
   * Sobrescreve listBots para incluir novos campos
   */
  async listBots(includeInactive = false) {
    try {
      let query = `
        SELECT 
          id, slug, name, active, provider, 
          gateway_default, token_status, bot_username, bot_name, 
          created_at, updated_at 
        FROM bots
      `;
      const params = [];

      if (includeInactive) {
        query += ' WHERE active = FALSE';
      } else {
        query += ' WHERE active = TRUE';
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao listar bots:', error);
      throw error;
    }
  }

  /**
   * Buscar bot por ID com campos de token e gateway
   * Sobrescreve getBotById para incluir novos campos
   */
  async getBotById(botId) {
    try {
      const result = await this.pool.query(
        `SELECT 
          id, slug, name, active, provider, 
          gateway_default, token_status, bot_username, bot_name, 
          created_at, updated_at 
         FROM bots WHERE id = $1`,
        [botId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('[ERRO][BOT_SERVICE] Falha ao buscar bot', { botId, error });
      throw error;
    }
  }
}

module.exports = BotService;
