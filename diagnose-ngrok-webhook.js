#!/usr/bin/env node

/**
 * Script de Diagnóstico: ngrok + Webhook
 * 
 * Verifica:
 * 1. Se ngrok está rodando e conectado
 * 2. Se servidor Node está ouvindo porta 3000
 * 3. Se webhook está registrado no Telegram
 * 4. Se template /start existe no banco
 * 5. Se bot está ativo e com token validado
 */

require('dotenv').config();

const axios = require('axios');
const { pool } = require('./src/db');

const NGROK_API = process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api';
const SERVER_PORT = process.env.PORT || 3000;

async function diagnose() {
  console.log('\n========================================');
  console.log('🔍 DIAGNÓSTICO: ngrok + Webhook + /start');
  console.log('========================================\n');

  try {
    // 1. Verificar ngrok
    console.log('1️⃣  Verificando ngrok...');
    let ngrokUrl = null;
    try {
      const ngrokResponse = await axios.get(`${NGROK_API}/tunnels`, { timeout: 2000 });
      const tunnels = ngrokResponse.data.tunnels || [];
      const httpTunnel = tunnels.find(t => t.proto === 'https');
      
      if (httpTunnel) {
        ngrokUrl = httpTunnel.public_url;
        console.log(`   ✅ ngrok conectado: ${ngrokUrl}`);
      } else {
        console.log(`   ⚠️  ngrok rodando, mas nenhum túnel HTTPS encontrado`);
        console.log(`   Túneis disponíveis: ${tunnels.map(t => `${t.proto}://${t.public_url}`).join(', ')}`);
      }
    } catch (error) {
      console.log(`   ❌ ngrok não está respondendo em ${NGROK_API}`);
      console.log(`   Erro: ${error.message}`);
      console.log(`   Solução: Execute em outro terminal: ngrok http ${SERVER_PORT}`);
    }

    // 2. Verificar servidor Node
    console.log('\n2️⃣  Verificando servidor Node...');
    try {
      const healthResponse = await axios.get(`http://localhost:${SERVER_PORT}/healthz`, { timeout: 2000 });
      console.log(`   ✅ Servidor respondendo em porta ${SERVER_PORT}`);
      console.log(`   Status: ${JSON.stringify(healthResponse.data)}`);
    } catch (error) {
      console.log(`   ❌ Servidor não está respondendo em localhost:${SERVER_PORT}`);
      console.log(`   Erro: ${error.message}`);
      console.log(`   Solução: Execute em outro terminal: npm start`);
    }

    // 3. Buscar bots ativos
    console.log('\n3️⃣  Buscando bots ativos...');
    const botsResult = await pool.query(
      `SELECT id, slug, name, active, token_status, bot_username FROM bots WHERE active = TRUE ORDER BY created_at DESC LIMIT 5`
    );

    if (botsResult.rows.length === 0) {
      console.log(`   ⚠️  Nenhum bot ativo encontrado`);
    } else {
      console.log(`   ✅ ${botsResult.rows.length} bot(s) ativo(s):`);
      for (const bot of botsResult.rows) {
        console.log(`      - ${bot.slug} (ID: ${bot.id}, Token: ${bot.token_status})`);
      }
    }

    // 4. Para cada bot, verificar template /start
    console.log('\n4️⃣  Verificando templates /start...');
    for (const bot of botsResult.rows) {
      const templateResult = await pool.query(
        `SELECT id, slug, active, content FROM bot_messages WHERE bot_id = $1 AND slug = 'start' LIMIT 1`,
        [bot.id]
      );

      if (templateResult.rows.length === 0) {
        console.log(`   ❌ Bot "${bot.slug}" - Nenhum template /start encontrado`);
      } else {
        const template = templateResult.rows[0];
        let contentPreview = '';
        try {
          const content = typeof template.content === 'string' ? JSON.parse(template.content) : template.content;
          if (content.messages && Array.isArray(content.messages)) {
            contentPreview = `${content.messages.length} mensagens`;
          } else if (content.text) {
            contentPreview = `"${content.text.substring(0, 50)}..."`;
          } else {
            contentPreview = JSON.stringify(content).substring(0, 50);
          }
        } catch {
          contentPreview = template.content.substring(0, 50);
        }
        console.log(`   ✅ Bot "${bot.slug}" - Template encontrado (${contentPreview})`);
      }
    }

    // 5. Verificar webhook registrado no Telegram
    if (botsResult.rows.length > 0 && ngrokUrl) {
      console.log('\n5️⃣  Verificando webhooks no Telegram...');
      const { getCryptoService } = require('./src/modules/crypto-singleton');
      const crypto = getCryptoService();

      for (const bot of botsResult.rows) {
        if (bot.token_status !== 'validated') {
          console.log(`   ⚠️  Bot "${bot.slug}" - Token não validado (status: ${bot.token_status})`);
          continue;
        }

        try {
          const botToken = bot.token_encrypted ? crypto.decrypt(bot.token_encrypted) : null;
          if (!botToken) {
            console.log(`   ❌ Bot "${bot.slug}" - Falha ao descriptografar token`);
            continue;
          }

          const webhookInfo = await axios.get(
            `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
            { timeout: 5000 }
          );

          if (webhookInfo.data.ok) {
            const webhook = webhookInfo.data.result;
            const expectedUrl = `${ngrokUrl}/tg/${bot.slug}/webhook`;
            if (webhook.url === expectedUrl) {
              console.log(`   ✅ Bot "${bot.slug}" - Webhook correto registrado`);
              console.log(`      URL: ${webhook.url}`);
            } else if (webhook.url) {
              console.log(`   ⚠️  Bot "${bot.slug}" - Webhook registrado, mas URL diferente`);
              console.log(`      Esperado: ${expectedUrl}`);
              console.log(`      Registrado: ${webhook.url}`);
            } else {
              console.log(`   ⚠️  Bot "${bot.slug}" - Nenhum webhook registrado`);
              console.log(`      Esperado: ${expectedUrl}`);
            }
          } else {
            console.log(`   ❌ Bot "${bot.slug}" - Erro ao verificar webhook: ${webhookInfo.data.description}`);
          }
        } catch (error) {
          console.log(`   ❌ Bot "${bot.slug}" - Erro ao verificar webhook: ${error.message}`);
        }
      }
    }

    // 6. Resumo
    console.log('\n========================================');
    console.log('📋 RESUMO DO DIAGNÓSTICO');
    console.log('========================================\n');

    const checks = {
      'ngrok conectado': ngrokUrl ? '✅' : '❌',
      'Servidor Node rodando': '✅',
      'Bots ativos': botsResult.rows.length > 0 ? '✅' : '❌',
      'Templates /start': botsResult.rows.length > 0 ? '✅' : '❌'
    };

    for (const [check, status] of Object.entries(checks)) {
      console.log(`${status} ${check}`);
    }

    console.log('\n📝 PRÓXIMOS PASSOS:');
    if (!ngrokUrl) {
      console.log('1. Inicie ngrok em outro terminal: ngrok http 3000');
    }
    if (botsResult.rows.length === 0) {
      console.log('2. Crie um bot no Admin e valide o token');
    }
    if (botsResult.rows.length > 0 && botsResult.rows[0].token_status !== 'validated') {
      console.log('3. Valide o token do bot no Admin');
    }
    console.log('4. Envie /start no Telegram e verifique os logs do servidor');
    console.log('5. Procure por logs com prefixo [START:*] para diagnosticar problemas');

    console.log('\n');

  } catch (error) {
    console.error('❌ Erro durante diagnóstico:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

diagnose();
