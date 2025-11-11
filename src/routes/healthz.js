/**
 * Rota de health check
 * GET /healthz
 */

const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // Verificar conexão com banco de dados
    const result = await req.pool.query('SELECT NOW()');
    
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    console.error('[ERRO][HEALTHZ] Falha ao conectar ao banco:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

module.exports = router;
