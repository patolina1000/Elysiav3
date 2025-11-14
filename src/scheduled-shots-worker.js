/**
 * Worker para processar shots agendados
 * 
 * Executa periodicamente (ex: a cada minuto) e:
 * 1. Busca shots com schedule_type='scheduled' e scheduled_at <= NOW()
 * 2. Cria jobs na shots_queue para cada shot elegível
 * 3. Evita reprocessar shots que já foram enfileirados
 */

const { pool } = require('./db');
const ShotScheduler = require('./modules/shot-scheduler');

class ScheduledShotsWorker {
  constructor() {
    this.isRunning = false;
    this.interval = null;
  }

  /**
   * Iniciar worker
   * @param {number} intervalMs - Intervalo em ms (padrão: 60000 = 1 minuto)
   */
  start(intervalMs = 60000) {
    if (this.isRunning) {
      console.warn('[SCHEDULED_SHOTS_WORKER] Já está em execução');
      return;
    }

    this.isRunning = true;
    console.log(`[SCHEDULED_SHOTS_WORKER] Iniciado com intervalo de ${intervalMs}ms`);

    // Executar imediatamente na primeira vez
    this.processScheduledShots().catch(err => {
      console.error('[ERRO][SCHEDULED_SHOTS_WORKER]', err.message);
    });

    // Depois executar periodicamente
    this.interval = setInterval(() => {
      this.processScheduledShots().catch(err => {
        console.error('[ERRO][SCHEDULED_SHOTS_WORKER]', err.message);
      });
    }, intervalMs);
  }

  /**
   * Parar worker
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[SCHEDULED_SHOTS_WORKER] Parado');
  }

  /**
   * Processar shots agendados
   */
  async processScheduledShots() {
    try {
      const scheduler = new ShotScheduler(pool);
      const result = await scheduler.processScheduledShots();
      
      if (result.processed > 0) {
        console.log(`[SCHEDULED_SHOTS_WORKER] Processados ${result.processed} shots agendados`);
      }
    } catch (error) {
      console.error('[ERRO][SCHEDULED_SHOTS_WORKER]', {
        error: error.message,
        stack: error.stack
      });
    }
  }
}

// Se executado diretamente (não como módulo)
if (require.main === module) {
  console.log('[SCHEDULED_SHOTS_WORKER] Iniciando worker standalone...');
  
  const worker = new ScheduledShotsWorker();
  worker.start(60000); // Executar a cada 1 minuto

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[SCHEDULED_SHOTS_WORKER] Recebido SIGINT, encerrando...');
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[SCHEDULED_SHOTS_WORKER] Recebido SIGTERM, encerrando...');
    worker.stop();
    process.exit(0);
  });
}

module.exports = ScheduledShotsWorker;
