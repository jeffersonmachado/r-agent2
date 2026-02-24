'use strict';

const logger = require('../utils/logger');
const { getAiProviderForTenant } = require('../../engine/aiProviderManager');

function compactText(text, maxLen = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}…` : normalized;
}

function chooseQuestion(intent, nextAction) {
  if (nextAction !== 'ask') return null;
  if (intent === 'sales') return 'Qual é sua principal necessidade agora?';
  if (intent === 'support') return 'Pode me dizer qual erro aparece para você?';
  if (intent === 'billing') return 'Você prefere resolver por boleto, cartão ou PIX?';
  return 'Quer que eu te explique em um passo rápido?';
}

function buildFallbackDecision({ funnelTransition, engineOutputText }) {
  const responseBase = compactText(engineOutputText || '', 180);
  const optionalQuestion = chooseQuestion(funnelTransition.after.intent, funnelTransition.after.next_action);
  const actions = [];
  if (funnelTransition.shouldHandoff) actions.push('handoff');
  if (funnelTransition.after.intent === 'support') actions.push('create_ticket');
  if (funnelTransition.after.next_action === 'followup') actions.push('schedule_followup');

  return {
    response_text: responseBase || 'Entendi. Vamos resolver isso com objetividade.',
    optional_question: optionalQuestion,
    actions,
    updated_funnel_state: funnelTransition.after,
  };
}

async function decideNextResponse({
  tenantId,
  inboundText,
  engineOutputText,
  funnelTransition,
  traceId,
}) {
  const fallback = buildFallbackDecision({ funnelTransition, engineOutputText });
  try {
    const aiProvider = getAiProviderForTenant(tenantId);
    if (!aiProvider || typeof aiProvider.generate !== 'function') return fallback;

    const prompt = [
      'Você é um orquestrador de decisão para atendimento comercial/suporte.',
      'Responda em JSON estrito: {"response_text":string,"optional_question":string|null,"actions":string[],"updated_funnel_state":object}.',
      'Regras obrigatórias: resposta curta, no máximo uma pergunta, não forçar venda, avançar quando intenção clara, educar quando dúvida.',
      `Contexto inbound: ${compactText(inboundText, 220)}`,
      `Resposta base da engine: ${compactText(engineOutputText, 220)}`,
      `Estado funnel atual: ${JSON.stringify(funnelTransition.after)}`,
    ].join('\n');

    const aiRaw = await aiProvider.generate(prompt, { temperature: 0.2, maxTokens: 180 });
    const aiText = typeof aiRaw === 'string'
      ? aiRaw
      : (aiRaw && typeof aiRaw.text === 'string' ? aiRaw.text : '');
    const parsed = JSON.parse(aiText);

    const responseText = compactText(parsed && parsed.response_text ? parsed.response_text : fallback.response_text, 220);
    const question = parsed && parsed.optional_question ? compactText(parsed.optional_question, 120) : null;
    const actions = Array.isArray(parsed && parsed.actions) ? parsed.actions.slice(0, 4).map((a) => String(a)) : fallback.actions;
    const updatedState = parsed && parsed.updated_funnel_state && typeof parsed.updated_funnel_state === 'object'
      ? parsed.updated_funnel_state
      : fallback.updated_funnel_state;

    return {
      response_text: responseText,
      optional_question: question,
      actions,
      updated_funnel_state: updatedState,
    };
  } catch (err) {
    logger.warn('[DecisionOrchestrator] fallback', {
      tenantId: tenantId || null,
      traceId: traceId || null,
      error: err && err.message ? err.message : String(err),
    });
    return fallback;
  }
}

module.exports = {
  decideNextResponse,
};
