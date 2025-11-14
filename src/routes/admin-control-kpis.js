/**
 * Rotas administrativas de KPIs de controle
 * GET /api/admin/bots/:slug/control-kpis - KPIs do bot (ativos, bloqueados, faturamento)
 */

const express = require('express');
const router = express.Router();

/**
 * Buscar KPIs de controle do bot
 * GET /api/admin/bots/:slug/control-kpis?from=ISO&to=ISO&range=all|custom
 * 
 * Retorna:
 * - active_users: usuários que não bloquearam o bot
 * - blocked_users: usuários que bloquearam o bot
 * - revenue_total_cents: faturamento total em centavos (eventos purchase)
 */
router.get('/:slug/control-kpis', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { slug } = req.params;
    const { from, to, range } = req.query;

    // Validar slug
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Slug é obrigatório'
      });
    }

    // Buscar bot por slug
    const botResult = await req.pool.query(
      'SELECT id, slug FROM bots WHERE slug = $1',
      [slug]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];
    const botId = bot.id;

    // Determinar janela de tempo
    let fromDate = null;
    let toDate = null;
    let rangeLabel = 'all';

    if (range !== 'all' && from && to) {
      fromDate = new Date(from);
      toDate = new Date(to);
      rangeLabel = 'custom';
      
      // Validar datas
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Datas inválidas (use formato ISO 8601)'
        });
      }
    } else if (range && range !== 'all') {
      // Calcular range predefinido (ex: last_30d)
      toDate = new Date();
      const days = parseInt(range.replace(/\D/g, ''), 10) || 30;
      fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
      rangeLabel = range;
    }

    // KPI 1: Usuários ativos (não bloqueados)
    const activeUsersResult = await req.pool.query(
      'SELECT COUNT(DISTINCT telegram_id) as count FROM bot_users WHERE bot_id = $1 AND blocked = FALSE',
      [botId]
    );
    const activeUsers = parseInt(activeUsersResult.rows[0]?.count || 0, 10);

    // KPI 2: Usuários bloqueados
    const blockedUsersResult = await req.pool.query(
      'SELECT COUNT(DISTINCT telegram_id) as count FROM bot_users WHERE bot_id = $1 AND blocked = TRUE',
      [botId]
    );
    const blockedUsers = parseInt(blockedUsersResult.rows[0]?.count || 0, 10);

    // KPI 3: Faturamento total (pagamentos aprovados - reembolsos)
    let revenueQuery = `
      SELECT COALESCE(SUM(value_cents), 0) as total
      FROM payments
      WHERE bot_id = $1
        AND status IN ('paid', 'refunded')
    `;
    const revenueParams = [botId];

    // Aplicar filtro de data se não for "all"
    if (fromDate && toDate) {
      revenueQuery += ' AND paid_at >= $2 AND paid_at <= $3';
      revenueParams.push(fromDate.toISOString(), toDate.toISOString());
    }

    // Subtrair reembolsos
    let refundQuery = `
      SELECT COALESCE(SUM(value_cents), 0) as total
      FROM payments
      WHERE bot_id = $1
        AND status = 'refunded'
    `;
    const refundParams = [botId];

    if (fromDate && toDate) {
      refundQuery += ' AND paid_at >= $2 AND paid_at <= $3';
      refundParams.push(fromDate.toISOString(), toDate.toISOString());
    }

    let revenueTotalCents = 0;
    let revenueNote = null;

    try {
      // Calcular pagamentos aprovados
      const revenueResult = await req.pool.query(revenueQuery, revenueParams);
      const paidTotal = parseInt(revenueResult.rows[0]?.total || 0, 10);

      // Calcular reembolsos
      const refundResult = await req.pool.query(refundQuery, refundParams);
      const refundTotal = parseInt(refundResult.rows[0]?.total || 0, 10);

      // Faturamento líquido = pagamentos - reembolsos
      revenueTotalCents = paidTotal - refundTotal;
    } catch (revenueError) {
      // Se a tabela ou coluna não existir, retornar 0 com nota
      console.warn('[CONTROL_KPIS] Erro ao calcular faturamento:', revenueError.message);
      revenueTotalCents = 0;
      revenueNote = 'no_revenue_source';
    }

    const tookMs = Date.now() - startTime;

    // Logar telemetria
    console.log(`[CONTROL_KPIS] ${slug} | range=${rangeLabel} | took=${tookMs}ms | active=${activeUsers} blocked=${blockedUsers} revenue=${revenueTotalCents}`);

    // Resposta
    const response = {
      slug,
      range: rangeLabel,
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
      kpis: {
        active_users: activeUsers,
        blocked_users: blockedUsers,
        revenue_total_cents: revenueTotalCents,
        currency: 'BRL'
      },
      took_ms: tookMs
    };

    if (revenueNote) {
      response.note = revenueNote;
    }

    res.status(200).json(response);
  } catch (error) {
    const tookMs = Date.now() - startTime;
    console.error('[ERRO][CONTROL_KPIS] Falha ao buscar KPIs:', error);
    
    res.status(500).json({
      success: false,
      error: 'Falha ao carregar KPIs',
      took_ms: tookMs
    });
  }
});

module.exports = router;
