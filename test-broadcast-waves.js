/**
 * Script de teste para sistema de broadcast em ondas
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTests() {
  try {
    console.log('\n=== TESTE 1: Verificar tabela broadcast_waves_queue ===');
    const tableCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM broadcast_waves_queue
    `);
    console.log(`✓ Tabela existe. Registros: ${tableCheck.rows[0].count}`);

    console.log('\n=== TESTE 2: Verificar usuários ativos ===');
    const activeUsers = await pool.query(`
      SELECT bu.telegram_id, bu.blocked, b.slug as bot_slug
      FROM bot_users bu
      JOIN bots b ON bu.bot_id = b.id
      WHERE bu.blocked = FALSE
      ORDER BY b.slug, bu.telegram_id
    `);
    console.log(`✓ Usuários ativos: ${activeUsers.rows.length}`);
    activeUsers.rows.forEach(user => {
      console.log(`  - Bot: ${user.bot_slug}, Chat: ${user.telegram_id}, Bloqueado: ${user.blocked}`);
    });

    console.log('\n=== TESTE 3: Verificar shots ativos ===');
    const shots = await pool.query(`
      SELECT s.id, s.slug, s.active, s.schedule_type, s.trigger_type, b.slug as bot_slug
      FROM shots s
      JOIN bots b ON s.bot_id = b.id
      WHERE s.active = TRUE
      ORDER BY s.id DESC
      LIMIT 5
    `);
    console.log(`✓ Shots ativos: ${shots.rows.length}`);
    shots.rows.forEach(shot => {
      console.log(`  - ID: ${shot.id}, Slug: ${shot.slug}, Bot: ${shot.bot_slug}, Type: ${shot.schedule_type}, Trigger: ${shot.trigger_type}`);
    });

    console.log('\n=== TESTE 4: Verificar ondas pendentes ===');
    const waves = await pool.query(`
      SELECT id, bot_slug, kind, wave_index, total_waves, 
             status, schedule_at, 
             jsonb_array_length(chat_ids) as chat_count
      FROM broadcast_waves_queue
      WHERE status = 'pending'
      ORDER BY schedule_at ASC
      LIMIT 10
    `);
    console.log(`✓ Ondas pendentes: ${waves.rows.length}`);
    waves.rows.forEach(wave => {
      console.log(`  - ID: ${wave.id}, Bot: ${wave.bot_slug}, Kind: ${wave.kind}, Wave: ${wave.wave_index + 1}/${wave.total_waves}, Chats: ${wave.chat_count}, Schedule: ${wave.schedule_at}`);
    });

    console.log('\n=== TESTE 5: Verificar ondas completas ===');
    const completedWaves = await pool.query(`
      SELECT id, bot_slug, kind, wave_index, total_waves, 
             sent_count, skipped_count, failed_count, status
      FROM broadcast_waves_queue
      WHERE status = 'completed'
      ORDER BY id DESC
      LIMIT 10
    `);
    console.log(`✓ Ondas completas: ${completedWaves.rows.length}`);
    completedWaves.rows.forEach(wave => {
      console.log(`  - ID: ${wave.id}, Bot: ${wave.bot_slug}, Kind: ${wave.kind}, Wave: ${wave.wave_index + 1}/${wave.total_waves}, Sent: ${wave.sent_count}, Skipped: ${wave.skipped_count}, Failed: ${wave.failed_count}`);
    });

    console.log('\n=== TESTE 6: Verificar eventos de shot enviados ===');
    const shotEvents = await pool.query(`
      SELECT event_id, telegram_id, occurred_at
      FROM funnel_events
      WHERE event_name = 'shot_sent'
      ORDER BY occurred_at DESC
      LIMIT 10
    `);
    console.log(`✓ Eventos de shot enviados: ${shotEvents.rows.length}`);
    shotEvents.rows.forEach(event => {
      console.log(`  - Event ID: ${event.event_id}, Chat: ${event.telegram_id}, Data: ${event.occurred_at}`);
    });

    console.log('\n=== TESTE 7: Simular criação de onda (DRY RUN) ===');
    const BroadcastService = require('./src/modules/broadcast-service');
    const broadcastService = new BroadcastService(pool);
    
    // Buscar primeiro bot ativo
    const botResult = await pool.query(`
      SELECT id, slug FROM bots WHERE active = TRUE LIMIT 1
    `);
    
    if (botResult.rows.length > 0) {
      const bot = botResult.rows[0];
      console.log(`✓ Testando com bot: ${bot.slug} (ID: ${bot.id})`);
      
      // Buscar usuários ativos
      const targets = await broadcastService.getActiveChatsForBot(bot.id);
      console.log(`✓ Usuários elegíveis: ${targets.length}`);
      
      if (targets.length > 0) {
        const waveSize = 20;
        const numWaves = Math.ceil(targets.length / waveSize);
        console.log(`✓ Seriam criadas ${numWaves} onda(s) de até ${waveSize} usuários cada`);
        
        for (let i = 0; i < numWaves; i++) {
          const waveStart = i * waveSize;
          const waveEnd = Math.min(waveStart + waveSize, targets.length);
          const waveTargets = targets.slice(waveStart, waveEnd);
          const delayMs = i * 1000; // 1 segundo entre ondas
          console.log(`  - Onda ${i + 1}/${numWaves}: ${waveTargets.length} usuários, delay: ${delayMs}ms`);
        }
      }
    } else {
      console.log('⚠ Nenhum bot ativo encontrado');
    }

    console.log('\n=== TODOS OS TESTES CONCLUÍDOS ===\n');

  } catch (error) {
    console.error('\n❌ ERRO:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

runTests();
