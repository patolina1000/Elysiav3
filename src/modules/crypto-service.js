/**
 * Serviço de Criptografia
 * 
 * Responsabilidades:
 * - Criptografar tokens em repouso (AES-256-GCM)
 * - Descriptografar tokens
 * - Mascarar tokens em logs e respostas
 * 
 * Segurança:
 * - Chave derivada de TOKEN_SECRET via PBKDF2
 * - IV aleatório por criptografia
 * - Autenticação via GCM tag
 */

// IMPORTANTE: Garantir que dotenv seja carregado ANTES
require('dotenv').config();

const crypto = require('crypto');

class CryptoService {
  constructor() {
    // Chave mestra vem de TOKEN_SECRET no .env
    // Em desenvolvimento, usar valor padrão seguro
    // Em produção, DEVE estar definida no .env
    const secret = process.env.TOKEN_SECRET || 'dev-secret-change-in-production-min-32-chars';
    
    if (!process.env.TOKEN_SECRET && process.env.NODE_ENV === 'production') {
      throw new Error('TOKEN_SECRET não definida em .env (obrigatório em produção)');
    }

    // Log para debug (remover em produção)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CRYPTO] TOKEN_SECRET carregado: ${secret.substring(0, 10)}...`);
    }

    // Derivar chave de 32 bytes (256 bits) para AES-256
    this.key = crypto.pbkdf2Sync(secret, 'elysia-bots', 100000, 32, 'sha256');
  }

  /**
   * Criptografar token
   * Retorna: base64(iv + ciphertext + authTag)
   */
  encrypt(plaintext) {
    if (!plaintext) return null;

    const iv = crypto.randomBytes(12); // 96 bits para GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Concatenar: iv + ciphertext + authTag
    const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), authTag]);
    return combined.toString('base64');
  }

  /**
   * Descriptografar token
   * Entrada: base64(iv + ciphertext + authTag) - aceita string ou Buffer
   */
  decrypt(encoded) {
    if (!encoded) return null;

    try {
      // Converter Buffer para string UTF-8 se necessário
      const encodedStr = Buffer.isBuffer(encoded) ? encoded.toString('utf8') : encoded;
      
      console.log('[CRYPTO][DEBUG] Tentando descriptografar...');
      console.log('[CRYPTO][DEBUG] TOKEN_SECRET atual:', process.env.TOKEN_SECRET ? process.env.TOKEN_SECRET.substring(0, 10) + '...' : 'UNDEFINED');
      console.log('[CRYPTO][DEBUG] Encoded length:', encodedStr.length);
      console.log('[CRYPTO][DEBUG] Is Buffer:', Buffer.isBuffer(encoded));
      
      const combined = Buffer.from(encodedStr, 'base64');

      // Extrair componentes
      const iv = combined.slice(0, 12);
      const authTag = combined.slice(-16); // Últimos 16 bytes
      const ciphertext = combined.slice(12, -16);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      console.log('[CRYPTO][DEBUG] ✓ Descriptografia bem-sucedida');
      return decrypted;
    } catch (error) {
      console.error('[CRYPTO] Falha ao descriptografar:', error.message);
      console.error('[CRYPTO][DEBUG] Erro completo:', error);
      return null;
    }
  }

  /**
   * Mascarar token para logs/respostas
   * Exibe: primeiros 5 + "..." + últimos 3
   * Ex: "123456789012345" → "12345...345"
   */
  maskToken(token) {
    if (!token || token.length < 10) {
      return '***';
    }
    const first = token.substring(0, 5);
    const last = token.substring(token.length - 3);
    return `${first}...${last}`;
  }
}

module.exports = CryptoService;
