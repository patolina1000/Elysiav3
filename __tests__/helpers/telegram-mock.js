/**
 * Mock do cliente Telegram para testes
 * Simula API do Telegram sem fazer chamadas HTTP reais
 */

class TelegramMock {
  constructor() {
    this.sentMessages = [];
    this.sentMediaGroups = [];
    this.errors = [];
    this.shouldReturn429 = false;
    this.retry429Count = 0;
    this.delay429After = null;
  }

  // Simular envio de mensagem
  async sendMessage(chatId, text, options = {}) {
    if (this.shouldReturn429 && this.retry429Count > 0) {
      this.retry429Count--;
      const error = new Error('Too Many Requests');
      error.response = { status: 429, data: { parameters: { retry_after: 3 } } };
      this.errors.push({ chatId, type: 'sendMessage', error: '429' });
      throw error;
    }

    this.sentMessages.push({
      chatId,
      text,
      options,
      timestamp: Date.now()
    });

    return {
      ok: true,
      result: {
        message_id: Math.floor(Math.random() * 100000),
        chat: { id: chatId },
        text
      }
    };
  }

  // Simular envio de foto
  async sendPhoto(chatId, photo, options = {}) {
    if (this.shouldReturn429 && this.retry429Count > 0) {
      this.retry429Count--;
      const error = new Error('Too Many Requests');
      error.response = { status: 429, data: { parameters: { retry_after: 3 } } };
      this.errors.push({ chatId, type: 'sendPhoto', error: '429' });
      throw error;
    }

    this.sentMessages.push({
      chatId,
      photo,
      options,
      type: 'photo',
      timestamp: Date.now()
    });

    return {
      ok: true,
      result: {
        message_id: Math.floor(Math.random() * 100000),
        chat: { id: chatId }
      }
    };
  }

  // Simular envio de vídeo
  async sendVideo(chatId, video, options = {}) {
    if (this.shouldReturn429 && this.retry429Count > 0) {
      this.retry429Count--;
      const error = new Error('Too Many Requests');
      error.response = { status: 429, data: { parameters: { retry_after: 3 } } };
      this.errors.push({ chatId, type: 'sendVideo', error: '429' });
      throw error;
    }

    this.sentMessages.push({
      chatId,
      video,
      options,
      type: 'video',
      timestamp: Date.now()
    });

    return {
      ok: true,
      result: {
        message_id: Math.floor(Math.random() * 100000),
        chat: { id: chatId }
      }
    };
  }

  // Simular envio de media group
  async sendMediaGroup(chatId, media, options = {}) {
    if (this.shouldReturn429 && this.retry429Count > 0) {
      this.retry429Count--;
      const error = new Error('Too Many Requests');
      error.response = { status: 429, data: { parameters: { retry_after: 3 } } };
      this.errors.push({ chatId, type: 'sendMediaGroup', error: '429' });
      throw error;
    }

    this.sentMediaGroups.push({
      chatId,
      media,
      options,
      timestamp: Date.now()
    });

    return {
      ok: true,
      result: media.map(() => ({
        message_id: Math.floor(Math.random() * 100000),
        chat: { id: chatId }
      }))
    };
  }

  // Configurar para simular erro 429
  simulate429(count = 1) {
    this.shouldReturn429 = true;
    this.retry429Count = count;
  }

  // Resetar mock
  reset() {
    this.sentMessages = [];
    this.sentMediaGroups = [];
    this.errors = [];
    this.shouldReturn429 = false;
    this.retry429Count = 0;
  }

  // Obter estatísticas
  getStats() {
    return {
      totalMessages: this.sentMessages.length,
      totalMediaGroups: this.sentMediaGroups.length,
      totalErrors: this.errors.length,
      messagesByChat: this._groupByChat()
    };
  }

  _groupByChat() {
    const grouped = {};
    this.sentMessages.forEach(msg => {
      grouped[msg.chatId] = (grouped[msg.chatId] || 0) + 1;
    });
    return grouped;
  }

  // Verificar se um chat recebeu mensagem
  didSendTo(chatId) {
    return this.sentMessages.some(msg => msg.chatId === chatId);
  }

  // Contar mensagens para um chat
  countMessagesTo(chatId) {
    return this.sentMessages.filter(msg => msg.chatId === chatId).length;
  }
}

module.exports = { TelegramMock };
