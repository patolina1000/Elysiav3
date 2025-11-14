/**
 * Testes unitários - Divisão em ondas (broadcast core)
 * 
 * Testa a lógica de divisão de alvos em ondas (batches)
 * respeitando configurações de WAVE_SIZE e WAVE_DURATION_MS
 */

const BroadcastService = require('../../src/modules/broadcast-service');
const { MockPool } = require('../helpers/test-db');

describe('BroadcastService - Divisão em Ondas', () => {
  let broadcastService;
  let mockPool;

  beforeEach(() => {
    mockPool = new MockPool();
    broadcastService = new BroadcastService(mockPool);
    
    // Configurar mock de bot
    mockPool.setMockData('bots', [
      { id: 1, slug: 'test-bot', name: 'Test Bot' }
    ]);
  });

  afterEach(() => {
    mockPool.clearMockData();
  });

  /**
   * U1 - Poucos alvos (menor que WAVE_SIZE)
   * Deve criar apenas 1 onda
   */
  test('U1 - Poucos alvos: deve criar 1 onda com 5 alvos', async () => {
    // Arrange
    const targets = [
      { telegram_id: 1 },
      { telegram_id: 2 },
      { telegram_id: 3 },
      { telegram_id: 4 },
      { telegram_id: 5 }
    ];

    // Act
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    expect(result.totalTargets).toBe(5);
    expect(result.waves).toBe(1);
    expect(result.queued).toBe(1);

    // Verificar que foi criado 1 job na fila
    const insertQueries = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(insertQueries).toHaveLength(1);
  });

  /**
   * U2 - N múltiplo do tamanho de onda
   * Deve criar 2 ondas de 20 alvos cada
   */
  test('U2 - N múltiplo: deve criar 2 ondas de 20 alvos cada', async () => {
    // Arrange
    const targets = Array.from({ length: 40 }, (_, i) => ({
      telegram_id: i + 1
    }));

    // Act
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    expect(result.totalTargets).toBe(40);
    expect(result.waves).toBe(2);
    expect(result.queued).toBe(2);

    // Verificar que foram criados 2 jobs
    const insertQueries = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(insertQueries).toHaveLength(2);

    // Verificar delays: primeira onda = 0ms, segunda = 1000ms
    const firstWave = insertQueries[0];
    const secondWave = insertQueries[1];
    
    // Primeira onda deve ter delay ~0
    const firstScheduleAt = new Date(firstWave.params[7]);
    const firstDelay = firstScheduleAt - new Date();
    expect(Math.abs(firstDelay)).toBeLessThan(100); // Margem de 100ms

    // Segunda onda deve ter delay ~1000ms
    const secondScheduleAt = new Date(secondWave.params[7]);
    const secondDelay = secondScheduleAt - new Date();
    expect(Math.abs(secondDelay - 1000)).toBeLessThan(100);
  });

  /**
   * U3 - N não múltiplo do tamanho de onda
   * Deve criar 3 ondas (20, 20, 5)
   */
  test('U3 - N não múltiplo: deve criar 3 ondas (20, 20, 5)', async () => {
    // Arrange
    const targets = Array.from({ length: 45 }, (_, i) => ({
      telegram_id: i + 1
    }));

    // Act
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    expect(result.totalTargets).toBe(45);
    expect(result.waves).toBe(3);
    expect(result.queued).toBe(3);

    // Verificar que foram criados 3 jobs
    const insertQueries = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(insertQueries).toHaveLength(3);

    // Verificar tamanhos das ondas
    const wave1ChatIds = JSON.parse(insertQueries[0].params[4]);
    const wave2ChatIds = JSON.parse(insertQueries[1].params[4]);
    const wave3ChatIds = JSON.parse(insertQueries[2].params[4]);

    expect(wave1ChatIds).toHaveLength(20);
    expect(wave2ChatIds).toHaveLength(20);
    expect(wave3ChatIds).toHaveLength(5);

    // Verificar delays progressivos
    const wave1ScheduleAt = new Date(insertQueries[0].params[7]);
    const wave2ScheduleAt = new Date(insertQueries[1].params[7]);
    const wave3ScheduleAt = new Date(insertQueries[2].params[7]);

    const delay1 = wave1ScheduleAt - new Date();
    const delay2 = wave2ScheduleAt - new Date();
    const delay3 = wave3ScheduleAt - new Date();

    expect(Math.abs(delay1)).toBeLessThan(100);
    expect(Math.abs(delay2 - 1000)).toBeLessThan(100);
    expect(Math.abs(delay3 - 2000)).toBeLessThan(100);
  });

  /**
   * U4 - Lista vazia
   * Não deve criar ondas nem jobs
   */
  test('U4 - Lista vazia: não deve criar ondas', async () => {
    // Arrange
    const targets = [];

    // Act
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    expect(result.totalTargets).toBe(0);
    expect(result.waves).toBe(0);
    expect(result.queued).toBe(0);

    // Verificar que nenhum job foi criado
    const insertQueries = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(insertQueries).toHaveLength(0);
  });

  /**
   * U5 - Configuração customizada de WAVE_SIZE
   */
  test('U5 - WAVE_SIZE customizado: deve respeitar novo tamanho', async () => {
    // Arrange
    const customBroadcastService = new BroadcastService(mockPool);
    customBroadcastService.WAVE_SIZE = 10; // Reduzir para 10
    customBroadcastService.GLOBAL_SAFE_RATE = 10;

    const targets = Array.from({ length: 25 }, (_, i) => ({
      telegram_id: i + 1
    }));

    // Act
    const result = await customBroadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    expect(result.totalTargets).toBe(25);
    expect(result.waves).toBe(3); // 10, 10, 5
    expect(result.queued).toBe(3);
  });

  /**
   * U6 - Verificar índices de ondas
   */
  test('U6 - Índices de ondas: deve numerar corretamente de 0 a N-1', async () => {
    // Arrange
    const targets = Array.from({ length: 50 }, (_, i) => ({
      telegram_id: i + 1
    }));

    // Act
    await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'shot',
      context: { shotId: 1 },
      targets
    });

    // Assert
    const insertQueries = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(insertQueries).toHaveLength(3); // 20, 20, 10

    // Verificar wave_index
    expect(insertQueries[0].params[5]).toBe(0);
    expect(insertQueries[1].params[5]).toBe(1);
    expect(insertQueries[2].params[5]).toBe(2);

    // Verificar total_waves
    expect(insertQueries[0].params[6]).toBe(3);
    expect(insertQueries[1].params[6]).toBe(3);
    expect(insertQueries[2].params[6]).toBe(3);
  });
});
