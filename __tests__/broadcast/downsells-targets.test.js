/**
 * Testes unitários - Seleção de alvos para Downsells
 * 
 * Testa lógica de filtros, gatilhos e deduplicação
 */

const BroadcastService = require('../../src/modules/broadcast-service');
const { MockPool } = require('../helpers/test-db');

describe('BroadcastService - Seleção de Alvos (Downsells)', () => {
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
   * D1 - Gatilho /start: apenas ativos
   */
  test('D1 - Gatilho /start: deve incluir apenas usuários ativos', async () => {
    // Arrange
    mockPool.setMockData('bot_users', [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: true, bot_id: 1 },  // Bloqueado
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 },
      { telegram_id: 4, id: 4, blocked: true, bot_id: 1 },  // Bloqueado
      { telegram_id: 5, id: 5, blocked: false, bot_id: 1 }
    ]);

    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'start', active: true }
    ]);

    mockPool.setMockData('payments', []);

    // Act
    const targets = await broadcastService.selectTargets(1, 'downsell', { downsellId: 1 });

    // Assert
    expect(targets).toHaveLength(3); // Apenas 3 ativos
    expect(targets.map(t => t.telegram_id)).toEqual([1, 3, 5]);
  });

  /**
   * D2 - Gatilho "após gerar PIX": apenas quem gerou PIX e não pagou
   */
  test('D2 - Gatilho PIX: deve incluir apenas quem gerou PIX e não pagou', async () => {
    // Arrange
    mockPool.setMockData('bot_users', [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: false, bot_id: 1 },
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 },
      { telegram_id: 4, id: 4, blocked: false, bot_id: 1 },
      { telegram_id: 5, id: 5, blocked: false, bot_id: 1 }
    ]);

    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'pix', active: true }
    ]);

    mockPool.setMockData('payments', [
      { id: 1, bot_user_id: 1, status: 'pending' },  // Tem PIX pendente
      { id: 2, bot_user_id: 2, status: 'created' },  // Tem PIX criado
      { id: 3, bot_user_id: 3, status: 'paid' },     // Já pagou - NÃO deve receber
      // User 4 e 5 não geraram PIX - NÃO devem receber
    ]);

    // Mock específico para query de PIX
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = async function(sql, params) {
      if (sql.includes('EXISTS (') && sql.includes('payments')) {
        // Query que busca usuários com PIX pending/created e sem paid
        return {
          rows: [
            { telegram_id: 1 },
            { telegram_id: 2 }
          ]
        };
      }
      return originalQuery(sql, params);
    };

    // Act
    const targets = await broadcastService.selectTargets(1, 'downsell', { downsellId: 1 });

    // Assert
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.telegram_id).sort()).toEqual([1, 2]);
  });

  /**
   * D3 - Deduplicação: não enviar para quem já recebeu
   */
  test('D3 - Deduplicação: deve excluir usuários que já receberam', async () => {
    // Arrange
    mockPool.setMockData('bot_users', [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: false, bot_id: 1 },
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 }
    ]);

    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'start', active: true }
    ]);

    // Mock query de downsells_queue (já enviados)
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = async function(sql, params) {
      if (sql.includes('downsells_queue') && sql.includes("status = 'sent'")) {
        // User 2 já recebeu este downsell
        return {
          rows: [
            { telegram_id: 2 }
          ]
        };
      }
      return originalQuery(sql, params);
    };

    // Act
    const targets = await broadcastService.selectTargets(1, 'downsell', { downsellId: 1 });

    // Assert
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.telegram_id).sort()).toEqual([1, 3]);
  });

  /**
   * D4 - Downsell não encontrado: retorna lista vazia
   */
  test('D4 - Downsell não encontrado: deve retornar lista vazia', async () => {
    // Arrange
    mockPool.setMockData('bot_users', [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 }
    ]);

    mockPool.setMockData('downsells', []); // Nenhum downsell

    // Act
    const targets = await broadcastService.selectTargets(1, 'downsell', { downsellId: 999 });

    // Assert
    // Quando downsell não existe, retorna lista vazia
    expect(targets).toHaveLength(0);
    
    // Nota: A verificação de downsell ativo (active=true/false) 
    // deve ser feita ANTES de chamar selectTargets, 
    // no nível do scheduler/service que inicia o broadcast
  });

  /**
   * D5 - Combinação: PIX + deduplicação + bloqueados
   */
  test('D5 - Combinação: deve aplicar todos os filtros corretamente', async () => {
    // Arrange
    mockPool.setMockData('bot_users', [
      { telegram_id: 1, id: 1, blocked: false, bot_id: 1 },
      { telegram_id: 2, id: 2, blocked: true, bot_id: 1 },   // Bloqueado
      { telegram_id: 3, id: 3, blocked: false, bot_id: 1 },
      { telegram_id: 4, id: 4, blocked: false, bot_id: 1 }
    ]);

    mockPool.setMockData('downsells', [
      { id: 1, bot_id: 1, trigger_type: 'pix', active: true }
    ]);

    // Mock queries complexas
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = async function(sql, params) {
      // Query de PIX
      if (sql.includes('EXISTS (') && sql.includes('payments')) {
        return {
          rows: [
            { telegram_id: 1 },
            { telegram_id: 3 },
            { telegram_id: 4 }
          ]
        };
      }
      
      // Query de downsells_queue (já enviados)
      if (sql.includes('downsells_queue') && sql.includes("status = 'sent'")) {
        return {
          rows: [
            { telegram_id: 3 } // User 3 já recebeu
          ]
        };
      }
      
      return originalQuery(sql, params);
    };

    // Act
    const targets = await broadcastService.selectTargets(1, 'downsell', { downsellId: 1 });

    // Assert
    // Apenas users 1 e 4 (user 2 bloqueado, user 3 já recebeu)
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.telegram_id).sort()).toEqual([1, 4]);
  });
});
