#!/usr/bin/env node

/**
 * Teste do PublicUrlManager
 * Verifica se a URL pública está sendo resolvida corretamente
 */

require('dotenv').config();

const publicUrlManager = require('./src/modules/public-url-manager');

console.log('\n=== Teste PublicUrlManager ===\n');

// Simular ambiente de desenvolvimento
console.log('1. Ambiente de desenvolvimento (sem ngrok):');
const infoWithoutNgrok = publicUrlManager.getInfo();
console.log('   Info:', JSON.stringify(infoWithoutNgrok, null, 2));
console.log('   Webhook PushinPay:', publicUrlManager.buildWebhookUrl('/api/payments/webhook/pushinpay'));
console.log('   Webhook Telegram:', publicUrlManager.buildWebhookUrl('/tg/meubot/webhook'));

// Simular ngrok manager
console.log('\n2. Simulando ngrok manager:');
const mockNgrokManager = {
  getPublicUrl: () => 'https://abc123.ngrok.io'
};
publicUrlManager.setNgrokManager(mockNgrokManager);

const infoWithNgrok = publicUrlManager.getInfo();
console.log('   Info:', JSON.stringify(infoWithNgrok, null, 2));
console.log('   Webhook PushinPay:', publicUrlManager.buildWebhookUrl('/api/payments/webhook/pushinpay'));
console.log('   Webhook Telegram:', publicUrlManager.buildWebhookUrl('/tg/meubot/webhook'));

// Simular produção
console.log('\n3. Simulando produção (com PUBLIC_BASE_URL):');
process.env.NODE_ENV = 'production';
process.env.PUBLIC_BASE_URL = 'https://meudominio.com';

// Recriar singleton para pegar novas variáveis
delete require.cache[require.resolve('./src/modules/public-url-manager')];
const publicUrlManagerProd = require('./src/modules/public-url-manager');

const infoProduction = publicUrlManagerProd.getInfo();
console.log('   Info:', JSON.stringify(infoProduction, null, 2));
console.log('   Webhook PushinPay:', publicUrlManagerProd.buildWebhookUrl('/api/payments/webhook/pushinpay'));
console.log('   Webhook Telegram:', publicUrlManagerProd.buildWebhookUrl('/tg/meubot/webhook'));

console.log('\n=== Teste concluído ===\n');
