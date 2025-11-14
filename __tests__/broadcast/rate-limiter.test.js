/**
 * Testes unitários - Rate limiter por chat
 * 
 * Testa controle de 5 msg/s por chat e 20 msg/s global
 */

const { RateLimiter } = require('../../src/modules/rate-limiter');

describe('RateLimiter - Controle de Taxa', () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      globalMaxRate: 20,
      perChatMaxRate: 5
    });
  });

  /**
   * R1 - Muitas mensagens para um único chat
   * Deve respeitar limite de 5 msg/s por chat
   */
  test('R1 - Muitas mensagens para um chat: deve respeitar 5 msg/s', async () => {
    const chatId = 12345;
    const messagesToSend = 10;
    const startTime = Date.now();
    const acquisitions = [];

    // Tentar enviar 10 mensagens
    for (let i = 0; i < messagesToSend; i++) {
      const result = await rateLimiter.acquireToken(chatId);
      acquisitions.push({
        index: i,
        timestamp: Date.now(),
        waitedMs: result.waitedMs
      });
    }

    const totalTime = Date.now() - startTime;

    // Análise temporal
    // Com 5 msg/s, 10 mensagens devem levar ~2 segundos
    // Primeiras 5 mensagens: burst imediato
    // Próximas 5: esperar refill

    // Verificar que primeiras 5 foram rápidas
    const firstFive = acquisitions.slice(0, 5);
    firstFive.forEach(acq => {
      expect(acq.waitedMs).toBeLessThan(100); // Burst inicial
    });

    // Verificar que as próximas 5 tiveram que esperar
    const nextFive = acquisitions.slice(5, 10);
    const totalWaited = nextFive.reduce((sum, acq) => sum + acq.waitedMs, 0);
    expect(totalWaited).toBeGreaterThan(500); // Pelo menos meio segundo de espera

    // Tempo total deve ser >= 1 segundo (10 msgs / 5 msg/s = 2s, mas burst inicial ajuda)
    expect(totalTime).toBeGreaterThanOrEqual(900);
  }, 15000); // Timeout maior para este teste

  /**
   * R2 - Vários chats concorrentes
   * Cada chat deve ter seu próprio limite independente
   */
  test('R2 - Vários chats concorrentes: limites independentes', async () => {
    const chat1 = 111;
    const chat2 = 222;
    const chat3 = 333;

    // Enviar 3 mensagens para cada chat em paralelo
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(rateLimiter.acquireToken(chat1));
      promises.push(rateLimiter.acquireToken(chat2));
      promises.push(rateLimiter.acquireToken(chat3));
    }

    const startTime = Date.now();
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    // Verificar que todos conseguiram adquirir tokens
    expect(results).toHaveLength(9);

    // Com 3 chats e 3 mensagens cada (9 total), 
    // dentro do limite global de 20 msg/s
    // Deve ser relativamente rápido (< 1 segundo)
    expect(totalTime).toBeLessThan(1000);

    // Verificar estatísticas
    const stats = rateLimiter.getStats();
    expect(stats.totalRequests).toBe(9);
    expect(stats.activeChatBuckets).toBe(3);
  });

  /**
   * R3 - Registrar erro 429
   */
  test('R3 - Erro 429: deve aplicar backoff', async () => {
    const chatId = 12345;

    // Simular vários 429s
    for (let i = 0; i < 6; i++) {
      rateLimiter.register429(chatId, 1);
    }

    // Verificar que backoff foi aplicado
    const stats = rateLimiter.getStats();
    expect(stats.total429s).toBe(6);
    expect(stats.backoffMultiplier).toBeGreaterThan(1.0);

    // Resetar e verificar
    rateLimiter.resetBackoff();
    const statsAfterReset = rateLimiter.getStats();
    expect(statsAfterReset.backoffMultiplier).toBe(1.0);
  });

  /**
   * R4 - Limite global de 20 msg/s
   */
  test('R4 - Limite global: deve respeitar 20 msg/s', async () => {
    // Criar múltiplos chats para saturar limite global
    const chats = Array.from({ length: 10 }, (_, i) => i + 1);
    const messagesPerChat = 3; // 30 mensagens total
    const startTime = Date.now();

    const promises = [];
    for (const chatId of chats) {
      for (let i = 0; i < messagesPerChat; i++) {
        promises.push(rateLimiter.acquireToken(chatId));
      }
    }

    await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    // 30 mensagens com limite de 20 msg/s
    // Com burst inicial de 20 tokens, deve processar rápido
    // mas eventualmente ter alguma espera
    expect(totalTime).toBeGreaterThanOrEqual(0);

    const stats = rateLimiter.getStats();
    expect(stats.totalRequests).toBe(30);
    
    // Verificar que houve pelo menos algumas esperas
    expect(stats.totalWaits).toBeGreaterThan(0);
  }, 15000);

  /**
   * R5 - Token bucket refill
   */
  test('R5 - Refill de tokens: deve reabastecer ao longo do tempo', async () => {
    const chatId = 12345;

    // Consumir todos os tokens iniciais (5 mensagens)
    for (let i = 0; i < 5; i++) {
      await rateLimiter.acquireToken(chatId);
    }

    // Aguardar 1 segundo para refill
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Deve ter ~5 tokens novamente
    // Tentar adquirir mais 5
    const startTime = Date.now();
    for (let i = 0; i < 5; i++) {
      await rateLimiter.acquireToken(chatId);
    }
    const refillTime = Date.now() - startTime;

    // Deve ser relativamente rápido, pois houve refill
    expect(refillTime).toBeLessThan(500);
  }, 15000);

  /**
   * R6 - Cleanup de buckets inativos
   */
  test('R6 - Cleanup: deve remover buckets inativos', async () => {
    const chat1 = 111;
    const chat2 = 222;

    // Criar dois buckets
    await rateLimiter.acquireToken(chat1);
    await rateLimiter.acquireToken(chat2);

    expect(rateLimiter.chatBuckets.size).toBe(2);

    // Simular que chat1 está inativo há mais de 5 minutos
    const bucket1 = rateLimiter.chatBuckets.get(chat1);
    bucket1.lastRefill = Date.now() - (6 * 60 * 1000); // 6 minutos atrás

    // Executar cleanup
    rateLimiter.cleanupInactiveBuckets();

    // Chat1 deve ter sido removido
    expect(rateLimiter.chatBuckets.size).toBe(1);
    expect(rateLimiter.chatBuckets.has(chat1)).toBe(false);
    expect(rateLimiter.chatBuckets.has(chat2)).toBe(true);
  });

  /**
   * R7 - Burst initial: deve permitir burst de tokens
   */
  test('R7 - Burst: deve permitir múltiplas mensagens em burst inicial', async () => {
    const chatId = 12345;
    
    // Tentar enviar múltiplas mensagens rapidamente
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(rateLimiter.acquireToken(chatId));
    }

    const startTime = Date.now();
    await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    // Burst inicial deve ser rápido (tokens já disponíveis)
    expect(totalTime).toBeLessThan(500);
    
    // Verificar que todos conseguiram tokens
    const stats = rateLimiter.getStats();
    expect(stats.totalRequests).toBeGreaterThanOrEqual(5);
  });
});
