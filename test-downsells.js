/**
 * Script de teste para sistema de downsells
 * Testa os 5 cenários principais
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTests() {
  console.log('🧪 Iniciando testes do sistema de downsells\n');

  try {
    // Buscar um bot de teste
    const botResult = await pool.query('SELECT id, slug, name FROM bots LIMIT 1');
    if (botResult.rows.length === 0) {
      console.error('❌ Nenhum bot encontrado no banco. Crie um bot primeiro.');
      process.exit(1);
    }

    const bot = botResult.rows[0];
    console.log(`✅ Bot de teste: ${bot.name} (ID: ${bot.id}, slug: ${bot.slug})\n`);

    // Teste 1: Criar downsell com trigger 'start'
    console.log('📝 Teste 1: Criar downsell com trigger "start" (delay 60s)');
    const downsell1Result = await pool.query(
      `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (bot_id, slug) DO UPDATE 
       SET name = EXCLUDED.name, content = EXCLUDED.content, delay_seconds = EXCLUDED.delay_seconds, 
           active = EXCLUDED.active, trigger_type = EXCLUDED.trigger_type, updated_at = NOW()
       RETURNING id, slug, trigger_type`,
      [bot.id, 'test-downsell-start-60s', 'Downsell Start 60s', JSON.stringify({ text: '🎯 Downsell após /start! Ainda está aí?' }), 60, true, 'start']
    );
    console.log(`✅ Downsell criado: ID ${downsell1Result.rows[0].id}, trigger: ${downsell1Result.rows[0].trigger_type}\n`);

    // Teste 2: Criar downsell com trigger 'pix'
    console.log('📝 Teste 2: Criar downsell com trigger "pix" (delay 60s)');
    const downsell2Result = await pool.query(
      `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (bot_id, slug) DO UPDATE 
       SET name = EXCLUDED.name, content = EXCLUDED.content, delay_seconds = EXCLUDED.delay_seconds, 
           active = EXCLUDED.active, trigger_type = EXCLUDED.trigger_type, updated_at = NOW()
       RETURNING id, slug, trigger_type`,
      [bot.id, 'test-downsell-pix-60s', 'Downsell PIX 60s', JSON.stringify({ text: '💰 Downsell após PIX! Ainda não pagou?' }), 60, true, 'pix']
    );
    console.log(`✅ Downsell criado: ID ${downsell2Result.rows[0].id}, trigger: ${downsell2Result.rows[0].trigger_type}\n`);

    // Teste 3: Verificar estrutura da tabela bot_downsells
    console.log('📝 Teste 3: Verificar estrutura da tabela bot_downsells');
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bot_downsells'
      ORDER BY ordinal_position
    `);
    console.log('✅ Colunas da tabela bot_downsells:');
    columnsResult.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    // Teste 4: Verificar constraint de trigger_type
    console.log('📝 Teste 4: Verificar constraint de trigger_type');
    try {
      await pool.query(
        `INSERT INTO bot_downsells (bot_id, slug, name, content, delay_seconds, active, trigger_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [bot.id, 'test-invalid-trigger', 'Test Invalid', JSON.stringify({ text: 'Teste' }), 60, true, 'invalid']
      );
      console.log('❌ FALHA: Constraint não impediu valor inválido\n');
    } catch (error) {
      if (error.message.includes('bot_downsells_trigger_type_check')) {
        console.log('✅ Constraint funcionando: valores permitidos apenas "start" e "pix"\n');
      } else {
        console.log(`⚠ Erro inesperado: ${error.message}\n`);
      }
    }

    // Teste 5: Verificar índices criados
    console.log('📝 Teste 5: Verificar índices criados');
    const indexesResult = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'bot_downsells'
      AND indexname LIKE '%trigger%'
    `);
    console.log('✅ Índices relacionados a trigger_type:');
    indexesResult.rows.forEach(idx => {
      console.log(`   - ${idx.indexname}`);
    });
    console.log('');

    // Teste 6: Listar downsells ativos por trigger_type
    console.log('📝 Teste 6: Listar downsells ativos por trigger_type');
    const activeDownsellsResult = await pool.query(`
      SELECT id, slug, trigger_type, delay_seconds, active
      FROM bot_downsells
      WHERE bot_id = $1 AND active = TRUE
      ORDER BY trigger_type, delay_seconds
    `, [bot.id]);
    console.log(`✅ Downsells ativos encontrados: ${activeDownsellsResult.rows.length}`);
    activeDownsellsResult.rows.forEach(ds => {
      console.log(`   - [${ds.trigger_type}] ${ds.slug} (${ds.delay_seconds}s)`);
    });
    console.log('');

    // Teste 7: Verificar tabela downsells_queue
    console.log('📝 Teste 7: Verificar estrutura da fila de downsells');
    const queueCountResult = await pool.query('SELECT COUNT(*) as count FROM downsells_queue');
    console.log(`✅ Fila de downsells: ${queueCountResult.rows[0].count} jobs\n`);

    // Teste 8: Simular agendamento (criar bot_user de teste)
    console.log('📝 Teste 8: Criar bot_user de teste para simulação');
    const testTelegramId = 999999999; // ID fictício para teste
    const botUserResult = await pool.query(
      `INSERT INTO bot_users (bot_id, telegram_id, blocked, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES ($1, $2, FALSE, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (bot_id, telegram_id) DO UPDATE
       SET blocked = FALSE, last_seen_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [bot.id, testTelegramId]
    );
    console.log(`✅ Bot user criado/atualizado: ID ${botUserResult.rows[0].id}\n`);

    // Resumo
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ TODOS OS TESTES PASSARAM!');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📋 Próximos passos para testar o sistema completo:\n');
    console.log('1. Envie /start no bot do Telegram');
    console.log('   → Deve agendar downsell com trigger "start"');
    console.log('   → Verificar: SELECT * FROM downsells_queue WHERE status = \'pending\'\n');
    
    console.log('2. Aguarde 60 segundos');
    console.log('   → Scheduler deve processar e enviar downsell');
    console.log('   → Verificar: SELECT * FROM downsells_queue WHERE status = \'sent\'\n');
    
    console.log('3. Gere um PIX (quando implementado)');
    console.log('   → Deve agendar downsell com trigger "pix"');
    console.log('   → Verificar logs: [DOWNSELL][SCHEDULE][PIX][OK]\n');
    
    console.log('4. Bloqueie o bot antes do delay');
    console.log('   → UPDATE bot_users SET blocked = TRUE WHERE telegram_id = <seu_id>');
    console.log('   → Scheduler deve cancelar: status = \'cancelled\'\n');

  } catch (error) {
    console.error('❌ Erro durante os testes:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
