/**
 * Mock do pool de banco de dados para testes
 * Simula conexão PostgreSQL sem banco real
 */

class MockPool {
  constructor() {
    this.queries = [];
    this.mockData = new Map();
  }

  async query(sql, params) {
    this.queries.push({ sql, params, timestamp: Date.now() });

    // Mock de queries específicas
    if (sql.includes('SELECT') && sql.includes('bot_users')) {
      return this._handleBotUsersQuery(sql, params);
    }

    if (sql.includes('SELECT') && sql.includes('bot_downsells')) {
      return this._handleDownsellsQuery(sql, params);
    }

    if (sql.includes('SELECT') && sql.includes('shots')) {
      return this._handleShotsQuery(sql, params);
    }

    if (sql.includes('INSERT INTO broadcast_waves_queue')) {
      return { rows: [{ id: Math.floor(Math.random() * 10000) }] };
    }

    if (sql.includes('INSERT INTO downsells_queue')) {
      return { rows: [{ id: Math.floor(Math.random() * 10000) }] };
    }

    if (sql.includes('SELECT') && sql.includes('payments')) {
      return this._handlePaymentsQuery(sql, params);
    }

    if (sql.includes('SELECT') && sql.includes('bots')) {
      return { rows: [{ slug: 'test-bot', name: 'Test Bot', token_encrypted: 'encrypted_token' }] };
    }

    return { rows: [] };
  }

  _handleBotUsersQuery(sql, params) {
    const data = this.mockData.get('bot_users') || [];
    
    // Filtrar por bot_id se fornecido
    let filtered = data;
    if (params && params[0]) {
      filtered = data.filter(u => u.bot_id === params[0]);
    }

    // Filtrar por blocked se especificado na query
    if (sql.includes('blocked = FALSE') || sql.includes('blocked = $')) {
      filtered = filtered.filter(u => !u.blocked);
    }

    return { rows: filtered };
  }

  _handleDownsellsQuery(sql, params) {
    const data = this.mockData.get('downsells') || [];
    
    let filtered = data;
    if (params && params[0]) {
      // Filtrar por ID ou bot_id
      if (sql.includes('WHERE id =')) {
        filtered = data.filter(d => d.id === params[0]);
      } else {
        filtered = data.filter(d => d.bot_id === params[0]);
      }
    }

    if (sql.includes('active = TRUE')) {
      filtered = filtered.filter(d => d.active);
    }

    return { rows: filtered };
  }

  _handleShotsQuery(sql, params) {
    const data = this.mockData.get('shots') || [];
    
    let filtered = data;
    if (params && params[0]) {
      if (sql.includes('WHERE id =') || sql.includes('WHERE s.id =')) {
        filtered = data.filter(s => s.id === params[0]);
      } else {
        filtered = data.filter(s => s.bot_id === params[0]);
      }
    }

    if (sql.includes('active = TRUE')) {
      filtered = filtered.filter(s => s.active);
    }

    return { rows: filtered };
  }

  _handlePaymentsQuery(sql, params) {
    const data = this.mockData.get('payments') || [];
    
    let filtered = data;
    if (params && params.length > 0) {
      filtered = data.filter(p => p.bot_user_id === params[0]);
      
      if (params.length > 1) {
        filtered = filtered.filter(p => p.status === params[1]);
      }
    }

    return { rows: filtered };
  }

  // Métodos auxiliares para configurar dados mock
  setMockData(table, data) {
    this.mockData.set(table, data);
  }

  clearMockData() {
    this.mockData.clear();
    this.queries = [];
  }

  getQueries() {
    return this.queries;
  }

  getQueriesByType(type) {
    return this.queries.filter(q => q.sql.includes(type));
  }
}

module.exports = { MockPool };
