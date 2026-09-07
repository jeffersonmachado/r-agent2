'use strict';

/**
 * actOnOperationsInsight — fecha o loop Decision Intelligence também no
 * Operations Dashboard: o insight vertical (no_show_risk, churn_risk etc.),
 * que antes terminava em card com "acao" textual, ganha uma recomendação
 * real no RecommendationEngine (ação create_task, interna — respeita o
 * nível de autonomia do tenant e mede outcome pelo sinal task_completion).
 *
 * Idempotente: a chave vertical:type:subjectId impede recomendações
 * duplicadas em aberto para o mesmo insight — clicar duas vezes (ou
 * recarregar e clicar de novo) retorna a recomendação já existente.
 */

const INSIGHT_ACTION_MAP = {
  no_show_risk: {
    actionType: 'no_show_recovery',
    title: 'Recuperar risco de falta (no-show)',
    highScore: 0.7,
  },
  return_eligibility: {
    actionType: 'recall_return',
    title: 'Chamar cliente elegível a retorno',
    highScore: 0.7,
  },
  upsell_opportunity: {
    actionType: 'upsell_offer',
    title: 'Oferecer complemento (upsell)',
    highScore: 0.8,
  },
  churn_risk: {
    actionType: 'churn_recovery',
    title: 'Recuperar cliente em risco de saída',
    highScore: 0.7,
  },
  low_frequency: {
    actionType: 'frequency_recovery',
    title: 'Reengajar cliente com frequência baixa',
    highScore: 0.7,
  },
  membership_block_followup: {
    actionType: 'membership_followup',
    title: 'Acompanhar pendência de matrícula',
    highScore: 0.8,
  },
};

function insightKey({ vertical, type, subjectId }) {
  return `${String(vertical || 'all')}:${String(type)}:${String(subjectId || '-')}`;
}

async function actOnOperationsInsight({ tenantId, insight, recommendationEngine }) {
  if (!tenantId) throw new Error('tenantId is required');
  const type = String(insight?.type || '');
  const mapping = INSIGHT_ACTION_MAP[type];
  if (!mapping) {
    const err = new Error('unsupported_insight_type');
    err.code = 'unsupported_insight_type';
    err.statusCode = 422;
    throw err;
  }
  if (!recommendationEngine) throw new Error('recommendationEngine is required');

  const key = insightKey(insight);

  // Dedupe: já existe recomendação aberta para este insight?
  const { items } = await recommendationEngine.listRecommendations({
    tenantId,
    status: 'open',
    limit: 500,
  });
  const existing = (items || []).find((item) => item.metadata?.verticalInsight?.key === key);
  if (existing) {
    return { ok: true, deduplicated: true, recommendation: existing };
  }

  const score = Number(insight?.score);
  const priority = Number.isFinite(score) && score >= mapping.highScore ? 'high' : 'medium';
  const reason = String(insight?.reason || '').trim();
  const suggestedAction = String(insight?.action || '').trim();

  const recommendation = await recommendationEngine.createRecommendation({
    tenantId,
    payload: {
      title: mapping.title,
      description: [
        reason || 'Insight operacional do dashboard.',
        suggestedAction ? `Ação sugerida pelo motor: ${suggestedAction}.` : null,
        Number.isFinite(score) ? `Score do insight: ${score.toFixed(2)}.` : null,
        insight?.vertical ? `Vertical: ${insight.vertical}.` : null,
      ].filter(Boolean).join(' '),
      actionType: mapping.actionType,
      priority,
      estimatedImpact: { expected: priority === 'high' ? 'high' : 'medium', horizon: 'short_term' },
      metadata: {
        verticalInsight: {
          key,
          vertical: insight?.vertical ? String(insight.vertical) : null,
          type,
          subjectId: insight?.subjectId ? String(insight.subjectId) : null,
          customerId: insight?.customerId ? String(insight.customerId) : null,
          membershipId: insight?.membershipId ? String(insight.membershipId) : null,
          score: Number.isFinite(score) ? score : null,
          sourceAction: suggestedAction || null,
        },
      },
      action: { kind: 'create_task', label: 'Criar tarefa operacional' },
    },
  });

  return { ok: true, deduplicated: false, recommendation };
}

module.exports = {
  actOnOperationsInsight,
  INSIGHT_ACTION_MAP,
  insightKey,
};
