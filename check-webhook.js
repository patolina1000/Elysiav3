#!/usr/bin/env node

/**
 * Script para verificar status do webhook no Telegram
 */

const axios = require('axios');

const botToken = '8240789383:AAHYg9vPwxT0EGOfCbnVtWXjNkHqpLLE08E';

async function checkWebhook() {
  try {
    console.log('[CHECK] Verificando webhook do Telegram...');
    
    const response = await axios.get(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
      { timeout: 10000 }
    );

    if (response.data.ok) {
      console.log('[CHECK] ✓ Resposta recebida\n');
      console.log(JSON.stringify(response.data.result, null, 2));
    } else {
      console.error('[CHECK] ✗ Erro:', response.data);
    }
  } catch (error) {
    console.error('[CHECK] Erro:', error.message);
  }
}

checkWebhook();
