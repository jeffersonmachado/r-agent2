'use strict';

const STAGES = ['awareness', 'interest', 'consideration', 'decision', 'post_sale', 'support', 'churn_risk'];
const INTENTS = ['sales', 'support', 'billing', 'complaint', 'cancel', 'info', 'unknown'];
const ACTIONS = ['ask', 'educate', 'offer', 'handoff', 'followup', 'close'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function createDefaultFunnelState() {
  return {
    stage: 'awareness',
    intent: 'unknown',
    severity: 'medium',
    score: 0,
    next_action: 'ask',
  };
}

function normalizeFunnelState(state) {
  const base = state && typeof state === 'object' ? state : {};
  const stage = STAGES.includes(base.stage) ? base.stage : 'awareness';
  const intent = INTENTS.includes(base.intent) ? base.intent : 'unknown';
  const nextAction = ACTIONS.includes(base.next_action) ? base.next_action : 'ask';
  const severity = SEVERITIES.includes(base.severity) ? base.severity : 'medium';
  const score = Number.isFinite(Number(base.score))
    ? Math.max(0, Math.min(100, Math.round(Number(base.score))))
    : 0;
  return {
    stage,
    intent,
    severity,
    score,
    next_action: nextAction,
  };
}

function detectIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'unknown';
  if (/humano|atendente|pessoa|reclama|insatisfeito|não resolveu|nao resolveu/i.test(t)) return 'complaint';
  if (/cancelar|cancelamento|encerrar|desistir/i.test(t)) return 'cancel';
  if (/suporte|erro|bug|problema|não funciona|nao funciona/i.test(t)) return 'support';
  if (/boleto|fatura|pagamento|cobrança|cobranca|nota/i.test(t)) return 'billing';
  if (/preço|preco|orçamento|orcamento|comprar|plano|contratar|vendas|fechar/i.test(t)) return 'sales';
  if (/como|o que|qual|informação|informacao|detalhe/i.test(t)) return 'info';
  return 'unknown';
}

function wantsHuman(text) {
  return /humano|atendente|pessoa|falar com alguém|falar com alguem|reclama|não resolveu|nao resolveu/i.test(String(text || '').toLowerCase());
}

function resolveStageByIntent(currentStage, intent) {
  const idx = STAGES.indexOf(currentStage);
  if (intent === 'sales') {
    if (currentStage === 'awareness') return 'interest';
    if (currentStage === 'interest') return 'consideration';
    if (currentStage === 'consideration') return 'decision';
    return idx >= 0 ? currentStage : 'interest';
  }
  if (intent === 'support') return 'support';
  if (intent === 'complaint') return 'churn_risk';
  if (intent === 'cancel') return 'churn_risk';
  if (intent === 'billing') return 'consideration';
  return currentStage;
}

function decideNextAction({ intent, stage, text }) {
  if (wantsHuman(text) || intent === 'complaint' || intent === 'cancel') return 'handoff';
  if (intent === 'support') return 'educate';
  if (intent === 'sales' && (stage === 'consideration' || stage === 'decision')) return 'ask';
  if (intent === 'sales') return 'offer';
  if (intent === 'billing') return 'educate';
  if (intent === 'info') return 'educate';
  return 'ask';
}

function transitionFunnelState(currentState, { text = '', explicitIntent = null } = {}) {
  const before = normalizeFunnelState(currentState || createDefaultFunnelState());
  const inferredIntent = explicitIntent && INTENTS.includes(explicitIntent)
    ? explicitIntent
    : detectIntent(text);
  const stageAfter = resolveStageByIntent(before.stage, inferredIntent);
  const nextAction = decideNextAction({ intent: inferredIntent, stage: stageAfter, text });
  const scoreDelta = inferredIntent === 'sales' ? 10 : inferredIntent === 'support' ? 5 : 2;
  const severity = inferredIntent === 'complaint' || inferredIntent === 'cancel'
    ? 'high'
    : (wantsHuman(text) ? 'critical' : (inferredIntent === 'support' ? 'medium' : 'low'));
  const updated = {
    stage: stageAfter,
    intent: inferredIntent,
    severity,
    score: Math.max(0, Math.min(100, before.score + scoreDelta)),
    next_action: nextAction,
  };
  const reason = `intent:${inferredIntent};action:${nextAction}`;
  return {
    before,
    after: updated,
    reason,
    shouldHandoff: nextAction === 'handoff',
  };
}

module.exports = {
  STAGES,
  INTENTS,
  ACTIONS,
  SEVERITIES,
  createDefaultFunnelState,
  normalizeFunnelState,
  transitionFunnelState,
};
