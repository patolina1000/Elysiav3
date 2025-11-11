/**
 * Singleton de CryptoService
 * Garante que apenas uma instância seja criada e reutilizada
 * Evita problemas com múltiplas chaves de criptografia
 */

const CryptoService = require('./crypto-service');

let instance = null;

function getCryptoService() {
  if (!instance) {
    instance = new CryptoService();
  }
  return instance;
}

module.exports = {
  getCryptoService,
  // Para testes: permitir reset
  reset: () => {
    instance = null;
  }
};
