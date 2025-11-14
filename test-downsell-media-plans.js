/**
 * Script de teste para verificar envio de downsell com mídia + planos
 * 
 * Uso:
 * node test-downsell-media-plans.js <bot_id> <telegram_id>
 * 
 * Exemplo:
 * node test-downsell-media-plans.js 1 123456789
 */

const { Pool } = require('pg');
const MessageService = require('./src/modules/message-service');
const { getCryptoService } = require('./src/modules/crypto-singleton');

async function testDownsellWithMediaAndPlans(botId, telegramId) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/elysia'
  });

  try {
    console.log('\n=== TESTE: Downsell com Mídia + Planos ===\n');
    console.log(`Bot ID: ${botId}`);
    console.log(`Telegram ID: ${telegramId}\n`);

    // 1. Buscar bot e token
    console.log('1. Buscando bot...');
    const botResult = await pool.query(
      'SELECT id, slug, name, token_encrypted FROM bots WHERE id = $1',
      [botId]
    );

    if (botResult.rows.length === 0) {
      throw new Error(`Bot ${botId} não encontrado`);
    }

    const bot = botResult.rows[0];
    console.log(`   ✓ Bot encontrado: ${bot.name} (${bot.slug})\n`);

    // 2. Buscar downsell ativo
    console.log('2. Buscando downsell ativo...');
    const downsellResult = await pool.query(
      `SELECT id, slug, content, delay_seconds, trigger_type 
       FROM bot_downsells 
       WHERE bot_id = $1 AND active = TRUE 
       ORDER BY delay_seconds ASC 
       LIMIT 1`,
      [botId]
    );

    if (downsellResult.rows.length === 0) {
      throw new Error(`Nenhum downsell ativo encontrado para bot ${botId}`);
    }

    const downsell = downsellResult.rows[0];
    console.log(`   ✓ Downsell encontrado: ${downsell.slug}`);
    console.log(`   - Delay: ${downsell.delay_seconds}s`);
    console.log(`   - Trigger: ${downsell.trigger_type}`);
    
    // Analisar conteúdo
    let content = downsell.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (e) {
        content = { text: content };
      }
    }

    console.log(`   - Texto: ${content.text ? 'SIM' : 'NÃO'}`);
    console.log(`   - Mídias: ${content.medias?.length || 0}`);
    console.log(`   - Planos: ${content.plans?.length || 0}`);
    
    if (content.medias && content.medias.length > 0) {
      console.log(`   - Tipos de mídia: ${content.medias.map(m => m.kind).join(', ')}`);
    }
    
    if (content.plans && content.plans.length > 0) {
      console.log(`   - Planos configurados:`);
      content.plans.forEach((plan, i) => {
        const price = plan.price_cents || plan.priceCents || plan.price || 0;
        const name = plan.name || plan.title || `Plano ${i + 1}`;
        console.log(`     ${i + 1}. ${name} - R$ ${(price / 100).toFixed(2)}`);
      });
    }
    console.log('');

    // 3. Descriptografar token
    console.log('3. Descriptografando token...');
    const crypto = getCryptoService();
    const botToken = bot.token_encrypted ? crypto.decrypt(bot.token_encrypted) : null;
    
    if (!botToken) {
      throw new Error('Token do bot não encontrado ou inválido');
    }
    console.log(`   ✓ Token descriptografado\n`);

    // 4. Enviar downsell via MessageService
    console.log('4. Enviando downsell...');
    const messageService = new MessageService(pool);
    
    const context = {
      userName: 'Usuário Teste',
      botName: bot.name,
      userId: telegramId
    };

    const startTime = Date.now();
    const result = await messageService.sendMessage(
      botId,
      telegramId,
      'downsell',
      context,
      botToken
    );
    const duration = Date.now() - startTime;

    console.log(`   ✓ Downsell enviado em ${duration}ms\n`);

    // 5. Exibir resultado
    console.log('=== RESULTADO ===\n');
    console.log(`Status: ${result.success ? '✓ SUCESSO' : '✗ FALHA'}`);
    console.log(`Duração total: ${result.duration}ms`);
    console.log(`Payloads enviados: ${result.messageCount || 0}`);
    console.log(`Mídias enviadas: ${result.mediaCount || 0}`);
    console.log(`Respostas recebidas: ${result.responses?.length || 0}`);
    
    if (result.breakdown) {
      console.log('\nBreakdown de performance:');
      console.log(`  - Template lookup: ${result.breakdown.templateLookup}ms`);
      console.log(`  - Media resolve: ${result.breakdown.mediaResolve}ms`);
      console.log(`  - Content render: ${result.breakdown.contentRender}ms`);
      console.log(`  - Payload preparation: ${result.breakdown.payloadPreparation}ms`);
      console.log(`  - Telegram dispatch: ${result.breakdown.telegramDispatch}ms`);
    }

    if (!result.success) {
      console.log(`\nErro: ${result.error}`);
    }

    console.log('\n=== TESTE CONCLUÍDO ===\n');

  } catch (error) {
    console.error('\n✗ ERRO:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Executar teste
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Uso: node test-downsell-media-plans.js <bot_id> <telegram_id>');
  console.error('Exemplo: node test-downsell-media-plans.js 1 123456789');
  process.exit(1);
}

const botId = parseInt(args[0], 10);
const telegramId = parseInt(args[1], 10);

if (isNaN(botId) || isNaN(telegramId)) {
  console.error('Erro: bot_id e telegram_id devem ser números');
  process.exit(1);
}

testDownsellWithMediaAndPlans(botId, telegramId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
