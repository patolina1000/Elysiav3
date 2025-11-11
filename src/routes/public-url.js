/**
 * Rota para obter URL pública do ngrok
 * GET /api/public-url
 * 
 * Retorna a URL pública atual para que o frontend possa usá-la
 * para construir URLs de webhooks, etc.
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/public-url
 * Obter URL pública do ngrok (se disponível)
 */
router.get('/', (req, res) => {
  try {
    if (!req.ngrokManager) {
      return res.status(503).json({
        success: false,
        error: 'NgrokManager não inicializado'
      });
    }

    const publicUrl = req.ngrokManager.getPublicUrl();
    
    if (!publicUrl) {
      return res.status(503).json({
        success: false,
        error: 'ngrok não está conectado',
        note: 'Certifique-se de que ngrok está rodando: ngrok http 3000'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        publicUrl,
        localUrl: `http://localhost:${process.env.PORT || 3000}`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[PUBLIC_URL] Erro:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
