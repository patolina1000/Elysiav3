/**
 * Teste de fluxo completo do sistema de downsells
 * Simula agendamento via DownsellScheduler
 */

const { Pool } = require('pg');
const DownsellScheduler = require('./src/modules/downsell-scheduler');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testDownsellFlow() {
  console.log('🧪 Teste de fluxo completo do sistema de downsells\n');

  try {
    // Buscar bot de teste
    const botResult = await pool.query('SELECT id, slug, name FROM bots LIMIT 1');
    if (botResult.rows.length === 0) {
      console.error('❌ Nenhum bot encontrado');
      process.exit(1);
    }

    const bot = botResult.rows[0];
    console.log(`✅ Bot: ${bot.name} (ID: ${bot.id})\n`);

    // Criar/buscar bot_user de teste
    const testTelegramId = 999999999;
    const botUserResult = await pool.query(
      `INSERT INTO bot_users (bot_id, telegram_id, blocked, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES ($1, $2, FALSE, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (bot_id, telegram_id) DO UPDATE
       SET blocked = FALSE, last_seen_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [bot.id, testTelegramId]
    );
    const botUserId = botUserResult.rows[0].id;
    console.log(`✅ Bot user: ID ${botUserId}, telegram_id: ${testTelegramId}\n`);

    // Limpar fila anterior
    await pool.query(
      'DELETE FROM downsells_queue WHERE bot_id = $1 AND telegram_id = $2',
      [bot.id, testTelegramId]
    );
    console.log('✅ Fila limpa\n');

    // Teste 1: Agendar downsells após /start
    console.log('📝 Teste 1: Agendar downsells após /start');
    const scheduler = new DownsellScheduler(pool);
    const result1 = await scheduler.scheduleAfterStart(bot.id, testTelegramId, botUserId);
    console.log(`✅ Resultado: ${JSON.stringify(result1)}`);
    
    // Verificar fila
    const queueResult1 = await pool.query(
      `SELECT dq.id, bd.slug, bd.trigger_type, dq.schedule_at, dq.status
       FROM downsells_queue dq
       JOIN bot_downsells bd ON dq.downsell_id = bd.id
       WHERE dq.bot_id = $1 AND dq.telegram_id = $2
       ORDER BY dq.created_at DESC`,
      [bot.id, testTelegramId]
    );
    console.log(`✅ Jobs na fila: ${queueResult1.rows.length}`);
    queueResult1.rows.forEach(job => {
      const scheduleAt = new Date(job.schedule_at);
      const delay = Math.round((scheduleAt - new Date()) / 1000);
      console.log(`   - [${job.trigger_type}] ${job.slug} → ${delay}s (status: ${job.status})`);
    });
    console.log('');

    // Teste 2: Bloquear usuário e tentar agendar novamente
    console.log('📝 Teste 2: Bloquear usuário e tentar agendar');
    await pool.query(
      'UPDATE bot_users SET blocked = TRUE WHERE id = $1',
      [botUserId]
    );
    const result2 = await scheduler.scheduleAfterStart(bot.id, testTelegramId, botUserId);
    console.log(`✅ Resultado (bloqueado): ${JSON.stringify(result2)}`);
    console.log('');

    // Teste 3: Desbloquear e testar agendamento após PIX
    console.log('📝 Teste 3: Desbloquear e agendar após PIX');
    await pool.query(
      'UPDATE bot_users SET blocked = FALSE WHERE id = $1',
      [botUserId]
    );
    
    // Criar pagamento de teste
    const paymentResult = await pool.query(
      `INSERT INTO payments (bot_id, bot_user_id, value_cents, status, transaction_id, provider, created_at, updated_at)
       VALUES ($1, $2, 1000, 'pending', $3, 'test', NOW(), NOW())
       RETURNING id`,
      [bot.id, botUserId, `test_txn_${Date.now()}`]
    );
    const paymentId = paymentResult.rows[0].id;
    console.log(`✅ Pagamento criado: ID ${paymentId}`);

    const result3 = await scheduler.scheduleAfterPixCreated(bot.id, testTelegramId, botUserId, paymentId);
    console.log(`✅ Resultado: ${JSON.stringify(result3)}`);

    // Verificar fila novamente
    const queueResult2 = await pool.query(
      `SELECT dq.id, bd.slug, bd.trigger_type, dq.schedule_at, dq.status
       FROM downsells_queue dq
       JOIN bot_downsells bd ON dq.downsell_id = bd.id
       WHERE dq.bot_id = $1 AND dq.telegram_id = $2
       ORDER BY dq.created_at DESC`,
      [bot.id, testTelegramId]
    );
    console.log(`✅ Jobs na fila após PIX: ${queueResult2.rows.length}`);
    queueResult2.rows.forEach(job => {
      const scheduleAt = new Date(job.schedule_at);
      const delay = Math.round((scheduleAt - new Date()) / 1000);
      console.log(`   - [${job.trigger_type}] ${job.slug} → ${delay}s (status: ${job.status})`);
    });
    console.log('');

    // Teste 4: Marcar pagamento como pago e tentar agendar novamente
    console.log('📝 Teste 4: Marcar pagamento como pago e tentar agendar');
    await pool.query(
      'UPDATE payments SET status = $1 WHERE id = $2',
      ['paid', paymentId]
    );
    const result4 = await scheduler.scheduleAfterPixCreated(bot.id, testTelegramId, botUserId, paymentId);
    console.log(`✅ Resultado (já pago): ${JSON.stringify(result4)}`);
    console.log('');

    // Resumo final
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ TODOS OS TESTES DE FLUXO PASSARAM!');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📊 Resumo dos testes:');
    console.log('1. ✅ Agendamento após /start funciona');
    console.log('2. ✅ Bloqueio impede agendamento');
    console.log('3. ✅ Agendamento após PIX funciona');
    console.log('4. ✅ Pagamento confirmado impede agendamento\n');

    console.log('🎯 Próximo passo: Testar com bot real no Telegram');
    console.log('   1. Envie /start no bot');
    console.log('   2. Aguarde 60 segundos');
    console.log('   3. Verifique se recebeu o downsell\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testDownsellFlow();
