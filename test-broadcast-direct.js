/**
 * Teste direto de broadcast (sem precisar do servidor HTTP)
 * Cria shot diretamente no banco e testa o broadcast
 */

const { Pool } = require('pg');
require('dotenv').config();

const BOT_ID = 14;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  try {
    log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
    log('║  TESTE DIRETO: SHOT BROADCAST EM ONDAS                   ║', 'cyan');
    log('╚════════════════════════════════════════════════════════════╝\n', 'cyan');

    // PASSO 1: Verificar usuários ativos
    log('📊 PASSO 1: Verificando usuários ativos...', 'blue');
    const usersResult = await pool.query(`
      SELECT telegram_id, blocked
      FROM bot_users 
      WHERE bot_id = $1 AND blocked = FALSE
      ORDER BY telegram_id
    `, [BOT_ID]);
    
    const activeUsers = usersResult.rows;
    log(`✓ Usuários ativos encontrados: ${activeUsers.length}`, 'green');
    activeUsers.forEach(user => {
      log(`  - Chat ID: ${user.telegram_id}`, 'cyan');
    });

    if (activeUsers.length === 0) {
      log('⚠ Nenhum usuário ativo. Teste abortado.', 'yellow');
      return;
    }

    // PASSO 2: Criar shot diretamente no banco
    log('\n🎯 PASSO 2: Criando shot de teste no banco...', 'blue');
    const timestamp = Date.now();
    const shotSlug = `test_broadcast_${timestamp}`;
    const shotContent = {
      text: `🚀 TESTE DE BROADCAST EM ONDAS\n\nTimestamp: ${timestamp}\n\nEste é um teste automatizado do sistema de broadcast.\n\nSe você recebeu esta mensagem, o sistema está funcionando perfeitamente! ✅`,
      medias: [],
      plans: []
    };

    const shotResult = await pool.query(`
      INSERT INTO shots (
        bot_id, slug, title, content, active, 
        trigger_type, schedule_type, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id
    `, [
      BOT_ID,
      shotSlug,
      shotSlug,
      JSON.stringify(shotContent),
      true,
      'start',
      'immediate'
    ]);

    const shotId = shotResult.rows[0].id;
    log(`✓ Shot criado! ID: ${shotId}, Slug: ${shotSlug}`, 'green');

    // PASSO 3: Disparar broadcast usando ShotScheduler
    log('\n🚀 PASSO 3: Disparando broadcast...', 'blue');
    const ShotScheduler = require('./src/modules/shot-scheduler');
    const scheduler = new ShotScheduler(pool);
    
    const broadcastResult = await scheduler.createImmediateJobs(shotId, BOT_ID);
    log(`✓ Broadcast disparado!`, 'green');
    log(`  - Ondas criadas: ${broadcastResult.waves || 0}`, 'cyan');
    log(`  - Total de alvos: ${broadcastResult.totalTargets || 0}`, 'cyan');
    log(`  - Jobs enfileirados: ${broadcastResult.queued || 0}`, 'cyan');

    // PASSO 4: Verificar ondas criadas
    log('\n📋 PASSO 4: Verificando ondas criadas...', 'blue');
    const wavesResult = await pool.query(`
      SELECT id, wave_index, total_waves, status, schedule_at,
             jsonb_array_length(chat_ids) as chat_count
      FROM broadcast_waves_queue
      WHERE kind = 'shot' 
        AND context->>'shotId' = $1
      ORDER BY wave_index ASC
    `, [shotId.toString()]);

    log(`✓ ${wavesResult.rows.length} onda(s) encontrada(s):`, 'green');
    wavesResult.rows.forEach(wave => {
      const scheduleDate = new Date(wave.schedule_at);
      const now = new Date();
      const delayMs = scheduleDate - now;
      log(`  - Onda ${wave.wave_index + 1}/${wave.total_waves}: ${wave.chat_count} usuários, Status: ${wave.status}, Delay: ${Math.max(0, delayMs)}ms`, 'cyan');
    });

    // PASSO 5: Aguardar processamento
    log('\n⏳ PASSO 5: Aguardando processamento das ondas (máx 30s)...', 'blue');
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

      if (pending === 0 && processing === 0 && (completed > 0 || error > 0)) {
        allCompleted = true;
      }
    }

    console.log(''); // Nova linha

    if (!allCompleted) {
      log('⚠ Timeout aguardando processamento. Verifique se o servidor está rodando!', 'yellow');
      log('  Execute: npm start', 'yellow');
    } else {
      log('✓ Todas as ondas processadas!', 'green');
    }

    // PASSO 6: Verificar resultados finais
    log('\n📈 PASSO 6: Verificando resultados finais...', 'blue');
    const resultsResult = await pool.query(`
      SELECT 
        id, wave_index, total_waves, status,
        sent_count, skipped_count, failed_count,
        error_message
      FROM broadcast_waves_queue
      WHERE kind = 'shot' 
        AND context->>'shotId' = $1
      ORDER BY wave_index ASC
    `, [shotId.toString()]);

    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    resultsResult.rows.forEach(wave => {
      totalSent += wave.sent_count || 0;
      totalSkipped += wave.skipped_count || 0;
      totalFailed += wave.failed_count || 0;

      const statusColor = wave.status === 'completed' ? 'green' : wave.status === 'error' ? 'red' : 'yellow';
      log(`  Onda ${wave.wave_index + 1}/${wave.total_waves}:`, statusColor);
      log(`    - Status: ${wave.status}`, statusColor);
      log(`    - Enviados: ${wave.sent_count || 0}, Pulados: ${wave.skipped_count || 0}, Falhados: ${wave.failed_count || 0}`, 'cyan');
      if (wave.error_message) {
        log(`    - Erro: ${wave.error_message}`, 'red');
      }
    });

    // PASSO 7: Verificar eventos no funil
    log('\n📝 PASSO 7: Verificando eventos no funil...', 'blue');
    const eventsResult = await pool.query(`
      SELECT event_id, telegram_id, occurred_at
      FROM funnel_events
      WHERE event_name = 'shot_sent'
        AND event_id LIKE $1
      ORDER BY occurred_at DESC
    `, [`shot:${shotId}:%`]);

    log(`✓ Eventos registrados: ${eventsResult.rows.length}`, 'green');
    eventsResult.rows.forEach(event => {
      log(`  - Chat ${event.telegram_id}: ${event.occurred_at}`, 'cyan');
    });

    // RESUMO FINAL
    log('\n╔════════════════════════════════════════════════════════════╗', 'magenta');
    log('║  RESUMO DO TESTE                                          ║', 'magenta');
    log('╚════════════════════════════════════════════════════════════╝', 'magenta');
    log(`Shot ID: ${shotId}`, 'cyan');
    log(`Slug: ${shotSlug}`, 'cyan');
    log(`Usuários ativos: ${activeUsers.length}`, 'cyan');
    log(`Ondas criadas: ${wavesResult.rows.length}`, 'cyan');
    log(`Mensagens enviadas: ${totalSent}`, totalSent > 0 ? 'green' : 'yellow');
    log(`Mensagens puladas: ${totalSkipped}`, 'cyan');
    log(`Mensagens falhadas: ${totalFailed}`, totalFailed > 0 ? 'red' : 'cyan');
    log(`Eventos registrados: ${eventsResult.rows.length}`, 'cyan');
    
    if (totalSent === activeUsers.length) {
      log('\n✅ TESTE PASSOU! Todos os usuários receberam a mensagem!', 'green');
    } else if (totalSent > 0) {
      log('\n⚠ TESTE PARCIAL: Alguns usuários receberam, outros não.', 'yellow');
      log(`Taxa de sucesso: ${Math.round((totalSent / activeUsers.length) * 100)}%`, 'yellow');
    } else if (allCompleted) {
      log('\n❌ TESTE FALHOU! Nenhuma mensagem foi enviada.', 'red');
    } else {
      log('\n⏸ TESTE INCOMPLETO: Servidor não processou as ondas.', 'yellow');
      log('  Certifique-se de que o servidor está rodando: npm start', 'yellow');
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
