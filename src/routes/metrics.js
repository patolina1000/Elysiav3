/**
 * Rotas de métricas e analytics
 * GET /api/metrics
 */

const express = require('express');
const router = express.Router();

/**
 * Retorna métricas básicas do funil
 * GET /api/metrics
 * 
 * Query params:
 * - bot_id (opcional): filtrar por bot
 * - start_date (opcional): data inicial (ISO 8601)
 * - end_date (opcional): data final (ISO 8601)
 */
router.get('/', async (req, res) => {
  try {
    // TODO: Implementar query de métricas
    // TODO: Implementar filtros por bot, período
    // TODO: Implementar cálculo de funil (presell → bot → pix → paid)
    
    res.status(200).json({
      presell_views: 0,
      bot_entries: 0,
      pix_created: 0,
      pix_paid: 0,
      conversion_rate: 0
    });
  } catch (error) {
    console.error(`[ERRO][METRICS] error=${error.message}`);
    res.status(500).json({ error: 'Erro ao buscar métricas' });
  }
});

module.exports = router;
