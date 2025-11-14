// Mock do axios para testes - evita chamadas HTTP reais

const axios = {
  create: jest.fn(() => axios),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  defaults: {
    headers: {
      common: {}
    }
  }
};

module.exports = axios;
