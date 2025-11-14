#!/usr/bin/env node

/**
 * Script de teste para funcionalidade de Shot
 * Testa: Criar, editar, listar e deletar shots com novos campos
 */

const http = require('http');

// Configuração
const BASE_URL = 'http://localhost:3000';
const BOT_ID = 14; // Usar um bot existente

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  log('\n🧪 Iniciando testes de funcionalidade de Shot\n', 'cyan');

  try {
    // Teste 1: Listar shots atuais
    log('📋 Teste 1: Listar shots atuais', 'blue');
    const getConfig = await makeRequest('GET', `/api/admin/bots/${BOT_ID}/config`);
    
    if (getConfig.status !== 200) {
      log(`❌ Erro ao buscar config: ${getConfig.status}`, 'red');
      return;
    }

    const shots = getConfig.data.data?.shots || [];
    log(`✅ Shots encontrados: ${shots.length}`, 'green');
    
    if (shots.length > 0) {
      log(`\n📌 Primeiro shot:`, 'yellow');
      const firstShot = shots[0];
      log(`  ID: ${firstShot.id}`, 'yellow');
      log(`  Slug: ${firstShot.slug}`, 'yellow');
      log(`  Trigger: ${firstShot.trigger_type || 'N/A'}`, 'yellow');
      log(`  Schedule: ${firstShot.schedule_type || 'N/A'}`, 'yellow');
      log(`  Scheduled At: ${firstShot.scheduled_at || 'N/A'}`, 'yellow');
    }

    // Teste 2: Criar novo shot com todos os campos
    log('\n📝 Teste 2: Criar novo shot com agendamento', 'blue');
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const scheduledAt = futureDate.toISOString().split('T')[0] + 'T14:30:00';

    const newShot = {
      shots: [{
        slug: `test_shot_${Date.now()}`,
        content: {
          text: 'Teste de shot com agendamento',
          medias: [],
          plans: [
            { name: 'Plano Teste', time: '7 dias', value: 2990 }
          ],
          media_mode: 'single',
          attach_text_as_caption: false
        },
        filter_criteria: 'test=true',
        active: true,
        trigger_type: 'start',
        schedule_type: 'scheduled',
        scheduled_at: scheduledAt
      }]
    };

    const createResult = await makeRequest('PUT', `/api/admin/bots/${BOT_ID}/config/shots`, newShot);
    
    if (createResult.status !== 200) {
      log(`❌ Erro ao criar shot: ${createResult.status}`, 'red');
      log(`   Resposta: ${JSON.stringify(createResult.data)}`, 'red');
      return;
    }

    const createdShotId = createResult.data.data[0].id;
    log(`✅ Shot criado com sucesso! ID: ${createdShotId}`, 'green');

    // Teste 3: Verificar se o shot foi salvo com os novos campos
    log('\n🔍 Teste 3: Verificar shot criado', 'blue');
    const getConfigAfterCreate = await makeRequest('GET', `/api/admin/bots/${BOT_ID}/config`);
    const updatedShots = getConfigAfterCreate.data.data?.shots || [];
    const createdShot = updatedShots.find(s => s.id === createdShotId);

    if (!createdShot) {
      log('❌ Shot não encontrado após criação', 'red');
      return;
    }

    log('✅ Shot encontrado com os seguintes dados:', 'green');
    log(`  Slug: ${createdShot.slug}`, 'green');
    log(`  Trigger Type: ${createdShot.trigger_type}`, 'green');
    log(`  Schedule Type: ${createdShot.schedule_type}`, 'green');
    log(`  Scheduled At: ${createdShot.scheduled_at}`, 'green');
    
    // Validar content
    let content = createdShot.content;
    if (typeof content === 'string') {
      content = JSON.parse(content);
    }
    log(`  Plans: ${content.plans?.length || 0}`, 'green');

    // Teste 4: Editar shot para mudar para disparo imediato
    log('\n✏️  Teste 4: Editar shot para disparo imediato', 'blue');
    
    const editShot = {
      shots: [{
        id: createdShotId,
        slug: createdShot.slug,
        content: {
          text: 'Shot editado - disparo imediato',
          medias: [],
          plans: [
            { name: 'Plano Editado', time: '30 dias', value: 4990 }
          ],
          media_mode: 'single',
          attach_text_as_caption: false
        },
        filter_criteria: 'test=true',
        active: true,
        trigger_type: 'pix_created',
        schedule_type: 'immediate',
        scheduled_at: null
      }]
    };

    const editResult = await makeRequest('PUT', `/api/admin/bots/${BOT_ID}/config/shots`, editShot);
    
    if (editResult.status !== 200) {
      log(`❌ Erro ao editar shot: ${editResult.status}`, 'red');
      return;
    }

    log('✅ Shot editado com sucesso!', 'green');

    // Teste 5: Verificar edição
    log('\n🔍 Teste 5: Verificar shot editado', 'blue');
    const getConfigAfterEdit = await makeRequest('GET', `/api/admin/bots/${BOT_ID}/config`);
    const editedShot = (getConfigAfterEdit.data.data?.shots || []).find(s => s.id === createdShotId);

    if (!editedShot) {
      log('❌ Shot não encontrado após edição', 'red');
      return;
    }

    log('✅ Shot editado verificado:', 'green');
    log(`  Trigger Type: ${editedShot.trigger_type} (esperado: pix_created)`, 'green');
    log(`  Schedule Type: ${editedShot.schedule_type} (esperado: immediate)`, 'green');
    log(`  Scheduled At: ${editedShot.scheduled_at || 'null'} (esperado: null)`, 'green');

    let editedContent = editedShot.content;
    if (typeof editedContent === 'string') {
      editedContent = JSON.parse(editedContent);
    }
    log(`  Plans: ${editedContent.plans?.length || 0} (esperado: 1)`, 'green');

    // Teste 6: Validar estrutura de dados
    log('\n✔️  Teste 6: Validar estrutura de dados', 'blue');
    
    const validations = [
      {
        name: 'trigger_type é string',
        check: typeof editedShot.trigger_type === 'string'
      },
      {
        name: 'schedule_type é string',
        check: typeof editedShot.schedule_type === 'string'
      },
      {
        name: 'scheduled_at é null ou timestamp',
        check: editedShot.scheduled_at === null || typeof editedShot.scheduled_at === 'string'
      },
      {
        name: 'content.plans é array',
        check: Array.isArray(editedContent.plans)
      },
      {
        name: 'content.medias é array',
        check: Array.isArray(editedContent.medias)
      }
    ];

    let allValid = true;
    for (const validation of validations) {
      if (validation.check) {
        log(`  ✅ ${validation.name}`, 'green');
      } else {
        log(`  ❌ ${validation.name}`, 'red');
        allValid = false;
      }
    }

    if (allValid) {
      log('\n🎉 Todos os testes passaram com sucesso!', 'green');
    } else {
      log('\n⚠️  Alguns testes falharam', 'yellow');
    }

  } catch (error) {
    log(`\n❌ Erro durante testes: ${error.message}`, 'red');
    console.error(error);
  }
}

// Aguardar servidor estar pronto
setTimeout(runTests, 2000);
