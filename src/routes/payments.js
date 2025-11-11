/**
 * Rotas de webhooks de pagamento
 * POST /api/payments/webhook/:gateway
 */

const express = require('express');
const router = express.Router();

/**
 * Webhook genérico para gateways de pagamento
 * POST /api/payments/webhook/:gateway
 * 
 * Suporta múltiplos gateways:
 * - pushinpay
 * - syncpay
 * - (futuros)
 */
router.post('/webhook/:gateway', async (req, res) => {
  const { gateway } = req.params;
  const payload = req.body;

  try {
    // TODO: Implementar validação de assinatura do gateway
    // TODO: Implementar normalização de evento de pagamento
    // TODO: Implementar atualização de status em payments
    // TODO: Implementar registro em funnel_events
    // TODO: Implementar integração com UTMify (se pix_paid)
    
    console.log(`[PAYMENT][WEBHOOK] gateway=${gateway}`);
    
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error(`[ERRO][PAYMENT_WEBHOOK] gateway=${gateway} error=${error.message}`);
    res.status(200).json({ ok: true }); // Não reprocessar
  }
});

module.exports = router;
