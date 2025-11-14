/**
 * Testes de integração - Broadcast completo com mocks
 * 
 * Testa fluxo end-to-end sem Telegram real
 */

const BroadcastService = require('../../src/modules/broadcast-service');
const ShotScheduler = require('../../src/modules/shot-scheduler');
const { MockPool } = require('../helpers/test-db');

describe('Broadcast - Integração Completa', () => {
  let broadcastService;
  let mockPool;

  beforeEach(() => {
    mockPool = new MockPool();
    broadcastService = new BroadcastService(mockPool);
  });

  afterEach(() => {
    mockPool.clearMockData();
  });

  /**
   * I1 - Downsell para 50 usuários ativos
   */
  test('I1 - Downsell broadcast: 50 usuários em 3 ondas', async () => {
    // Arrange
    const users = Array.from({ length: 50 }, (_, i) => ({
      telegram_id: i + 1,
      id: i + 1,
      blocked: false,
      bot_id: 1
    }));

    mockPool.setMockData('bot_users', users);
    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'start', active: true, content: { text: 'Test' } }
    ]);
    mockPool.setMockData('bots', [
      { id: 1, slug: 'test-bot', name: 'Test Bot', token_encrypted: 'token123' }
    ]);

    // Act - Agendar broadcast
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'downsell',
      context: { downsellId: 1 }
    });

    // Assert - Criação de ondas
    expect(result.totalTargets).toBe(50);
    expect(result.waves).toBe(3); // 20, 20, 10
    expect(result.queued).toBe(3);

    // Verificar jobs criados
    const waveJobs = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(waveJobs).toHaveLength(3);

    // Verificar tamanhos das ondas
    const wave1Ids = JSON.parse(waveJobs[0].params[4]);
    const wave2Ids = JSON.parse(waveJobs[1].params[4]);
    const wave3Ids = JSON.parse(waveJobs[2].params[4]);

    expect(wave1Ids).toHaveLength(20);
    expect(wave2Ids).toHaveLength(20);
    expect(wave3Ids).toHaveLength(10);
  }, 15000);

  /**
   * I2 - Shot agendado
   */
  test('I2 - Shot agendado: deve processar no horário correto', async () => {
    // Arrange
    const scheduler = new ShotScheduler(mockPool);
    
    const users = Array.from({ length: 10 }, (_, i) => ({
      telegram_id: i + 1,
      id: i + 1,
      blocked: false,
      bot_id: 1
    }));

    mockPool.setMockData('bot_users', users);
    
    // Shot agendado para "agora"
    const scheduledAt = new Date();
    mockPool.setMockData('shots', [
      {
        id: 1,
        bot_id: 1,
        slug: 'test-shot',
        trigger_type: 'start',
        schedule_type: 'scheduled',
        scheduled_at: scheduledAt,
        active: true,
        content: { text: 'Test shot' }
      }
    ]);

    mockPool.setMockData('bots', [
      { id: 1, slug: 'test-bot', name: 'Test Bot', token_encrypted: 'token123' }
    ]);

    // Act - Processar shots agendados
    const result = await scheduler.processScheduledShots();

    // Assert
    expect(result.processed).toBe(1);

    // Verificar que ondas foram criadas
    const waveJobs = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(waveJobs.length).toBeGreaterThan(0);
  });

  /**
   * I3 - Usuário bloqueado depois do agendamento
   */
  test('I3 - Revalidação: lógica de seleção considera usuários ativos', async () => {
    // Arrange
    const users = [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: true, bot_id: 1 },  // Bloqueado
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 }
    ];

    mockPool.setMockData('bot_users', users);
    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'start', active: true, content: { text: 'Test' } }
    ]);
    mockPool.setMockData('bots', [
      { id: 1, slug: 'test-bot', name: 'Test Bot', token_encrypted: 'token123' }
    ]);

    // Act - Agendar broadcast
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'downsell',
      context: { downsellId: 1 }
    });

    // Assert - Apenas usuários ativos devem ser incluídos
    expect(result.totalTargets).toBe(2); // Apenas 1 e 3
    expect(result.waves).toBe(1);
    
    const waveJobs = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    const wave1Ids = JSON.parse(waveJobs[0].params[4]);
    expect(wave1Ids).toEqual([1, 3]); // User 2 não incluído
  });

  /**
   * I4 - Múltiplos bots simultaneamente
   */
  test('I4 - Múltiplos bots: devem ter filas independentes', async () => {
    // Arrange - Bot 1
    const users1 = Array.from({ length: 10 }, (_, i) => ({
      telegram_id: i + 1,
      id: i + 1,
      blocked: false,
      bot_id: 1
    }));

    // Bot 2
    const users2 = Array.from({ length: 15 }, (_, i) => ({
      telegram_id: i + 100,
      id: i + 100,
      blocked: false,
      bot_id: 2
    }));

    mockPool.setMockData('bot_users', [...users1, ...users2]);
    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'start', active: true },
      { id: 2, bot_id: 2, trigger_type: 'start', active: true }
    ]);

    // Act - Agendar broadcasts para ambos
    const result1 = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'bot1',
      botId: 1,
      kind: 'downsell',
      context: { downsellId: 1 },
      targets: users1
    });

    const result2 = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'bot2',
      botId: 2,
      kind: 'downsell',
      context: { downsellId: 2 },
      targets: users2
    });

    // Assert
    expect(result1.totalTargets).toBe(10);
    expect(result1.waves).toBe(1);

    expect(result2.totalTargets).toBe(15);
    expect(result2.waves).toBe(1);

    // Total de ondas criadas: 2
    const waveJobs = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    expect(waveJobs).toHaveLength(2);
  });

  /**
   * I5 - Broadcast com usuários que já pagaram (PIX trigger)
   */
  test('I5 - PIX trigger: deve excluir quem já pagou na seleção', async () => {
    // Arrange
    const users = [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: false, bot_id: 1 },
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 }
    ];

    mockPool.setMockData('bot_users', users);
    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'pix', active: true, content: { text: 'Test' } }
    ]);
    mockPool.setMockData('bots', [
      { id: 1, slug: 'test-bot', name: 'Test Bot', token_encrypted: 'token123' }
    ]);

    // Mock query de PIX - apenas users 1 e 3 têm PIX pendente
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = async function(sql, params) {
      if (sql.includes('EXISTS (') && sql.includes('payments')) {
        return {
          rows: [
            { telegram_id: 1 },
            { telegram_id: 3 }
          ]
        };
      }
      return originalQuery(sql, params);
    };

    // Act - Agendar broadcast
    const result = await broadcastService.scheduleBroadcastInWaves({
      botSlug: 'test-bot',
      botId: 1,
      kind: 'downsell',
      context: { downsellId: 1 }
    });

    // Assert - Apenas users 1 e 3 devem ser incluídos
    expect(result.totalTargets).toBe(2);
    
    const waveJobs = mockPool.getQueriesByType('INSERT INTO broadcast_waves_queue');
    const wave1Ids = JSON.parse(waveJobs[0].params[4]);
    expect(wave1Ids.sort()).toEqual([1, 3]); // User 2 não incluído
  });
});
