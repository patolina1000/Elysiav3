#!/usr/bin/env node

/**
 * Script de Teste - Implementação de /start com Warmup
 * 
 * Testa:
 * 1. Correção de binding de mensagens
 * 2. Campo warmup_chat_id
 * 3. Botão Preview
 * 4. Planos (máx. 10)
 * 5. Warmup de mídia
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const BOT_ID = 14; // Ajustar conforme necessário

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(type, message) {
  const timestamp = new Date().toISOString();
  const prefix = {
    '✓': `${colors.green}✓${colors.reset}`,
    '✗': `${colors.red}✗${colors.reset}`,
    '⚠': `${colors.yellow}⚠${colors.reset}`,
    'ℹ': `${colors.blue}ℹ${colors.reset}`
  }[type] || type;
  
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function test(name, fn) {
  try {
    log('ℹ', `Iniciando: ${name}`);
    await fn();
    log('✓', `Passou: ${name}`);
    return true;
  } catch (error) {
    log('✗', `Falhou: ${name}`);
    console.error(`  Erro: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTES DE IMPLEMENTAÇÃO - /start com Warmup');
  console.log('='.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;

  // Teste 1: Carregar configuração do bot
  if (await test('GET /api/admin/bots/:id/config', async () => {
    const response = await axios.get(`${BASE_URL}/api/admin/bots/${BOT_ID}/config`);
    if (!response.data.success) throw new Error('Resposta não bem-sucedida');
    if (!response.data.data.startMessage) throw new Error('startMessage não encontrado');
    
    const { messages, medias, plans } = response.data.data.startMessage;
    if (!Array.isArray(messages)) throw new Error('messages não é array');
    if (!Array.isArray(medias)) throw new Error('medias não é array');
    if (!Array.isArray(plans)) throw new Error('plans não é array');
    
    log('ℹ', `  Mensagens: ${messages.length}, Mídias: ${medias.length}, Planos: ${plans.length}`);
  })) passed++; else failed++;

  // Teste 2: Buscar bot com warmup_chat_id
  if (await test('GET /api/admin/bots/:id (com warmup_chat_id)', async () => {
    const response = await axios.get(`${BASE_URL}/api/admin/bots/${BOT_ID}`);
    if (!response.data.success) throw new Error('Resposta não bem-sucedida');
    if (!response.data.data.hasOwnProperty('warmup_chat_id')) {
      throw new Error('warmup_chat_id não retornado');
    }
    log('ℹ', `  warmup_chat_id: ${response.data.data.warmup_chat_id || 'não configurado'}`);
  })) passed++; else failed++;

  // Teste 3: Atualizar warmup_chat_id
  if (await test('PUT /api/admin/bots/:id (atualizar warmup_chat_id)', async () => {
    const response = await axios.put(`${BASE_URL}/api/admin/bots/${BOT_ID}`, {
      slug: 'vipshadriee_bot',
      gateway_default: 'pushinpay',
      active: true,
      warmup_chat_id: -1001234567890
    });
    if (!response.data.success) throw new Error('Resposta não bem-sucedida');
    log('ℹ', `  warmup_chat_id atualizado para: -1001234567890`);
  })) passed++; else failed++;

  // Teste 4: Salvar configuração de /start com múltiplas mensagens
  if (await test('PUT /api/admin/bots/:id/config/start (3 mensagens)', async () => {
    const response = await axios.put(
      `${BASE_URL}/api/admin/bots/${BOT_ID}/config/start`,
      {
        messages: [
          'Olá {user_name}, bem-vindo!',
          'Este é o segundo texto',
          'E este é o terceiro'
        ],
        medias: [],
        plans: [
          { name: 'Plano 7 dias', time: '7 dias', value: 2990 },
          { name: 'Plano 30 dias', time: '30 dias', value: 9990 }
        ]
      }
    );
    if (!response.data.success) throw new Error('Resposta não bem-sucedida');
    log('ℹ', `  Salvo: 3 mensagens, 2 planos`);
  })) passed++; else failed++;

  // Teste 5: Validar limite de 3 mensagens
  if (await test('Validação: máximo 3 mensagens', async () => {
    try {
      await axios.put(
        `${BASE_URL}/api/admin/bots/${BOT_ID}/config/start`,
        {
          messages: ['msg1', 'msg2', 'msg3', 'msg4'],
          medias: [],
          plans: []
        }
      );
      throw new Error('Deveria ter rejeitado 4 mensagens');
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.error?.includes('3')) {
        // Esperado
      } else {
        throw error;
      }
    }
  })) passed++; else failed++;

  // Teste 6: Validar limite de 10 planos
  if (await test('Validação: máximo 10 planos', async () => {
    const plans = Array.from({ length: 11 }, (_, i) => ({
      name: `Plano ${i + 1}`,
      time: `${i + 1} dias`,
      value: (i + 1) * 1000
    }));

    try {
      await axios.put(
        `${BASE_URL}/api/admin/bots/${BOT_ID}/config/start`,
        {
          messages: ['Teste'],
          medias: [],
          plans
        }
      );
      throw new Error('Deveria ter rejeitado 11 planos');
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.error?.includes('10')) {
        // Esperado
      } else {
        throw error;
      }
    }
  })) passed++; else failed++;

  // Teste 7: Preview sem token validado
  if (await test('Preview: validação de token', async () => {
    try {
      await axios.post(
        `${BASE_URL}/api/admin/bots/${BOT_ID}/start/preview`,
        {
          messages: ['Teste'],
          medias: [],
          plans: []
        }
      );
      // Se chegou aqui, pode ser que o token esteja validado
      log('ℹ', `  Token aparentemente validado`);
    } catch (error) {
      if (error.response?.status === 400) {
        log('ℹ', `  Validação funcionando: ${error.response.data.error}`);
      } else {
        throw error;
      }
    }
  })) passed++; else failed++;

  // Teste 8: Carregar configuração novamente (verificar persistência)
  if (await test('Verificar persistência de dados', async () => {
    const response = await axios.get(`${BASE_URL}/api/admin/bots/${BOT_ID}/config`);
    const { messages, plans } = response.data.data.startMessage;
    
    if (messages.length !== 3) throw new Error(`Esperava 3 mensagens, got ${messages.length}`);
    if (plans.length !== 2) throw new Error(`Esperava 2 planos, got ${plans.length}`);
    
    // Verificar se mensagens não são [object Object]
    messages.forEach((msg, idx) => {
      if (typeof msg !== 'string') {
        throw new Error(`Mensagem ${idx} não é string: ${typeof msg}`);
      }
      if (msg.includes('[object Object]')) {
        throw new Error(`Mensagem ${idx} contém [object Object]`);
      }
    });
    
    log('ℹ', `  Dados persistidos corretamente`);
  })) passed++; else failed++;

  // Resumo
  console.log('\n' + '='.repeat(60));
  console.log(`RESUMO: ${colors.green}${passed} passou${colors.reset}, ${colors.red}${failed} falhou${colors.reset}`);
  console.log('='.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Executar testes
runTests().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
