/**
 * Teste automatizado de Shot Broadcast
 * Cria um shot, dispara e verifica resultados
 */

const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000';
const BOT_ID = 14;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  try {
    log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
    log('║  TESTE AUTOMATIZADO: SHOT BROADCAST EM ONDAS              ║', 'cyan');
    log('╚════════════════════════════════════════════════════════════╝\n', 'cyan');

    // PASSO 1: Verificar usuários ativos
    log('📊 PASSO 1: Verificando usuários ativos...', 'blue');
    const usersResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM bot_users 
      WHERE bot_id = $1 AND blocked = FALSE
    `, [BOT_ID]);
    const activeUsers = parseInt(usersResult.rows[0].count);
    log(`✓ Usuários ativos encontrados: ${activeUsers}`, 'green');

    if (activeUsers === 0) {
      log('⚠ Nenhum usuário ativo. Teste abortado.', 'yellow');
      return;
    }

    // PASSO 2: Criar shot de teste
    log('\n🎯 PASSO 2: Criando shot de teste...', 'blue');
    const timestamp = Date.now();
    const shotData = {
      shots: [{
        slug: `test_broadcast_${timestamp}`,
        content: {
          text: `🚀 TESTE DE BROADCAST EM ONDAS\n\nTimestamp: ${timestamp}\n\nEste é um teste automatizado do sistema de broadcast.\n\nSe você recebeu esta mensagem, o sistema está funcionando perfeitamente! ✅`,
          medias: [],
          plans: []
        },
        active: true,
        trigger_type: 'start',
        schedule_type: 'immediate'
      }]
    };

    const createResponse = await makeRequest('PUT', `/api/admin/bots/${BOT_ID}/config/shots`, shotData);
    
    if (createResponse.status !== 200) {
      log(`✗ Erro ao criar shot: ${JSON.stringify(createResponse.data)}`, 'red');
      return;
    }

    const shotId = createResponse.data.data[0].id;
    log(`✓ Shot criado com sucesso! ID: ${shotId}`, 'green');

    // PASSO 3: Aguardar criação das ondas
    log('\n⏳ PASSO 3: Aguardando criação das ondas...', 'blue');
    await sleep(2000);

    const wavesResult = await pool.query(`
      SELECT id, wave_index, total_waves, status, schedule_at,
             jsonb_array_length(chat_ids) as chat_count
      FROM broadcast_waves_queue
      WHERE kind = 'shot' 
        AND context->>'shotId' = $1
      ORDER BY wave_index ASC
    `, [shotId.toString()]);

    if (wavesResult.rows.length === 0) {
      log('✗ Nenhuma onda criada!', 'red');
      return;
    }

    log(`✓ ${wavesResult.rows.length} onda(s) criada(s):`, 'green');
    wavesResult.rows.forEach(wave => {
      log(`  - Onda ${wave.wave_index + 1}/${wave.total_waves}: ${wave.chat_count} usuários, Status: ${wave.status}, Schedule: ${wave.schedule_at}`, 'cyan');
    });

    // PASSO 4: Aguardar processamento das ondas
    log('\n⏳ PASSO 4: Aguardando processamento das ondas (máx 30s)...', 'blue');
    let allCompleted = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!allCompleted && attempts < maxAttempts) {
      await sleep(1000);
      attempts++;

      const statusResult = await pool.query(`
        SELECT status, COUNT(*) as count
        FROM broadcast_waves_queue
        WHERE kind = 'shot' 
          AND context->>'shotId' = $1
        GROUP BY status
      `, [shotId.toString()]);

      const statusMap = {};
      statusResult.rows.forEach(row => {
        statusMap[row.status] = parseInt(row.count);
      });

      const pending = statusMap['pending'] || 0;
      const processing = statusMap['processing'] || 0;
      const completed = statusMap['completed'] || 0;
      const error = statusMap['error'] || 0;

      process.stdout.write(`\r  Tentativa ${attempts}/${maxAttempts}: Pending: ${pending}, Processing: ${processing}, Completed: ${completed}, Error: ${error}    `);

      if (pending === 0 && processing === 0 && completed > 0) {
        allCompleted = true;
      }
    }

    console.log(''); // Nova linha

    if (!allCompleted) {
      log('⚠ Timeout aguardando processamento', 'yellow');
    } else {
      log('✓ Todas as ondas processadas!', 'green');
    }

    // PASSO 5: Verificar resultados
    log('\n📈 PASSO 5: Verificando resultados...', 'blue');
    const resultsResult = await pool.query(`
      SELECT 
        SUM(sent_count) as total_sent,
        SUM(skipped_count) as total_skipped,
        SUM(failed_count) as total_failed,
        COUNT(*) as total_waves
      FROM broadcast_waves_queue
      WHERE kind = 'shot' 
        AND context->>'shotId' = $1
    `, [shotId.toString()]);

    const results = resultsResult.rows[0];
    log(`✓ Resultados do broadcast:`, 'green');
    log(`  - Total de ondas: ${results.total_waves}`, 'cyan');
    log(`  - Mensagens enviadas: ${results.total_sent || 0}`, 'green');
    log(`  - Mensagens puladas: ${results.total_skipped || 0}`, 'yellow');
    log(`  - Mensagens falhadas: ${results.total_failed || 0}`, results.total_failed > 0 ? 'red' : 'cyan');

    // PASSO 6: Verificar eventos registrados
    log('\n📝 PASSO 6: Verificando eventos registrados...', 'blue');
    const eventsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM funnel_events
      WHERE event_name = 'shot_sent'
        AND event_id LIKE $1
    `, [`shot:${shotId}:%`]);

    const eventCount = parseInt(eventsResult.rows[0].count);
    log(`✓ Eventos registrados no funil: ${eventCount}`, 'green');

    // PASSO 7: Verificar detalhes das ondas
    log('\n🔍 PASSO 7: Detalhes das ondas processadas...', 'blue');
    const detailsResult = await pool.query(`
      SELECT id, wave_index, total_waves, status, 
             sent_count, skipped_count, failed_count,
             error_message
      FROM broadcast_waves_queue
      WHERE kind = 'shot' 
        AND context->>'shotId' = $1
      ORDER BY wave_index ASC
    `, [shotId.toString()]);

    detailsResult.rows.forEach(wave => {
      const statusColor = wave.status === 'completed' ? 'green' : wave.status === 'error' ? 'red' : 'yellow';
      log(`  Onda ${wave.wave_index + 1}/${wave.total_waves}:`, statusColor);
      log(`    - Status: ${wave.status}`, statusColor);
      log(`    - Enviados: ${wave.sent_count || 0}, Pulados: ${wave.skipped_count || 0}, Falhados: ${wave.failed_count || 0}`, 'cyan');
      if (wave.error_message) {
        log(`    - Erro: ${wave.error_message}`, 'red');
      }
    });

    // RESUMO FINAL
    log('\n╔════════════════════════════════════════════════════════════╗', 'magenta');
    log('║  RESUMO DO TESTE                                          ║', 'magenta');
    log('╚════════════════════════════════════════════════════════════╝', 'magenta');
    log(`Shot ID: ${shotId}`, 'cyan');
    log(`Usuários ativos: ${activeUsers}`, 'cyan');
    log(`Ondas criadas: ${results.total_waves}`, 'cyan');
    log(`Mensagens enviadas: ${results.total_sent || 0}`, 'green');
    log(`Taxa de sucesso: ${activeUsers > 0 ? Math.round((results.total_sent / activeUsers) * 100) : 0}%`, 'green');
    
    if (results.total_sent === activeUsers) {
      log('\n✅ TESTE PASSOU! Todos os usuários receberam a mensagem!', 'green');
    } else if (results.total_sent > 0) {
      log('\n⚠ TESTE PARCIAL: Alguns usuários receberam, outros não.', 'yellow');
    } else {
      log('\n❌ TESTE FALHOU! Nenhuma mensagem foi enviada.', 'red');
    }

  } catch (error) {
    log(`\n❌ ERRO NO TESTE: ${error.message}`, 'red');
    console.error(error.stack);
  } finally {
    await pool.end();
    log('\n🏁 Teste finalizado.\n', 'cyan');
  }
}

runTest();
