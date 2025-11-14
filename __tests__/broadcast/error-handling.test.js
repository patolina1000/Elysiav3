/**
 * Testes de tratamento de erros - Erros 429 do Telegram
 * 
 * Testa reação a rate limit do Telegram com retry_after
 */

const { RateLimiter } = require('../../src/modules/rate-limiter');
const { TelegramMock } = require('../helpers/telegram-mock');

describe('Broadcast - Tratamento de Erros 429', () => {
  let rateLimiter;
  let telegramMock;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      globalMaxRate: 20,
      perChatMaxRate: 5
    });
    telegramMock = new TelegramMock();
  });

  afterEach(() => {
    telegramMock.reset();
  });

  /**
   * L1 - Um erro 429 com retry_after
   */
  test('L1 - Erro 429: deve registrar e aplicar retry_after', async () => {
    const chatId = 12345;

    // Criar bucket primeiro (simular que houve envio)
    await rateLimiter.acquireToken(chatId);

    // Simular 429
    rateLimiter.register429(chatId, 3); // retry_after = 3 segundos

    // Verificar estatísticas
    const stats = rateLimiter.getStats();
    expect(stats.total429s).toBe(1);

    // Tokens devem ter sido zerados para forçar espera
    expect(rateLimiter.globalTokens).toBe(0);
    const chatBucket = rateLimiter.chatBuckets.get(chatId);
    expect(chatBucket?.tokens).toBe(0);
  });

  /**
   * L2 - Muitos 429s seguidos: deve aplicar backoff
   */
  test('L2 - Múltiplos 429s: deve aplicar backoff progressivo', async () => {
    const chatId = 12345;

    // Estado inicial
    expect(rateLimiter.backoffMultiplier).toBe(1.0);

    // Simular 6 erros 429 (acima do threshold de 5)
    for (let i = 0; i < 6; i++) {
      rateLimiter.register429(chatId, 1);
    }

    // Backoff deve ter sido aplicado
    const stats = rateLimiter.getStats();
    expect(stats.total429s).toBe(6);
    expect(stats.recent429Count).toBe(6);
    expect(stats.backoffMultiplier).toBeGreaterThan(1.0);
    expect(stats.backoffMultiplier).toBeLessThanOrEqual(2.0); // Limite máximo

    console.log('Backoff aplicado:', stats.backoffMultiplier);
  });

  /**
   * L3 - Reset de backoff após período de calmaria
   */
  test('L3 - Reset de backoff: deve resetar após resetBackoff()', () => {
    const chatId = 12345;

    // Provocar backoff
    for (let i = 0; i < 6; i++) {
      rateLimiter.register429(chatId, 1);
    }

    expect(rateLimiter.backoffMultiplier).toBeGreaterThan(1.0);

    // Resetar
    rateLimiter.resetBackoff();

    // Deve voltar ao normal
    expect(rateLimiter.backoffMultiplier).toBe(1.0);
    expect(rateLimiter.recent429Count).toBe(0);
  });

  /**
   * L4 - Simulação de envio com 429s intermitentes
   */
  test('L4 - Envio com 429s: deve continuar tentando', async () => {
    const chatId = 12345;
    
    // Configurar TelegramMock para simular 2 erros 429
    telegramMock.simulate429(2);

    let successfulSends = 0;
    let errors429 = 0;

    // Tentar enviar 5 mensagens
    for (let i = 0; i < 5; i++) {
      try {
        await telegramMock.sendMessage(chatId, `Message ${i}`);
        successfulSends++;
      } catch (error) {
        if (error.response?.status === 429) {
          errors429++;
          rateLimiter.register429(chatId, 3);
          
          // Em produção, aqui seria reagendado o envio
          // Para o teste, apenas registramos
        }
      }
    }

    // Primeiras 2 falharam com 429, próximas 3 sucederam
    expect(errors429).toBe(2);
    expect(successfulSends).toBe(3);
    expect(rateLimiter.getStats().total429s).toBe(2);
  });

  /**
   * L5 - Janela de 429s: deve resetar contador após 60 segundos
   */
  test('L5 - Janela de 429s: deve resetar após 60s', () => {
    const chatId = 12345;

    // Registrar 3 erros 429
    rateLimiter.register429(chatId, 1);
    rateLimiter.register429(chatId, 1);
    rateLimiter.register429(chatId, 1);

    expect(rateLimiter.recent429Count).toBe(3);

    // Simular que 61 segundos se passaram
    rateLimiter.recent429Window = Date.now() - 61000;

    // Próximo 429 deve resetar o contador
    rateLimiter.register429(chatId, 1);

    expect(rateLimiter.recent429Count).toBe(1); // Resetado
  });

  /**
   * L6 - Integração: envio com rate limiter + 429s
   */
  test('L6 - Integração: rate limiter + tratamento de 429', async () => {
    const chatId = 12345;
    const messagesToSend = 10;
    
    // Simular que 3 mensagens retornarão 429
    telegramMock.simulate429(3);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < messagesToSend; i++) {
      // Aguardar token do rate limiter
      await rateLimiter.acquireToken(chatId);

      try {
        await telegramMock.sendMessage(chatId, `Message ${i}`);
        sent++;
      } catch (error) {
        if (error.response?.status === 429) {
          failed++;
          const retryAfter = error.response.data?.parameters?.retry_after || 1;
          rateLimiter.register429(chatId, retryAfter);
          
          // Em produção, mensagem seria reagendada
          // Para o teste, continuamos
        }
      }
    }

    // 3 falharam, 7 foram enviadas
    expect(failed).toBe(3);
    expect(sent).toBe(7);

    const stats = rateLimiter.getStats();
    expect(stats.total429s).toBe(3);
    expect(stats.totalRequests).toBe(10);
  }, 10000);

  /**
   * L7 - Backoff máximo: não deve exceder 2.0
   */
  test('L7 - Backoff máximo: deve ter limite de 2.0', () => {
    const chatId = 12345;

    // Provocar muitos 429s
    for (let i = 0; i < 20; i++) {
      rateLimiter.register429(chatId, 1);
    }

    // Backoff não deve exceder 2.0
    expect(rateLimiter.backoffMultiplier).toBeLessThanOrEqual(2.0);
  });
});
