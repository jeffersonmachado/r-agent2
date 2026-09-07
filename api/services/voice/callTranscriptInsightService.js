'use strict';

/**
 * Call Transcript Insight Service — Voice → Intent (P5.15).
 *
 * Extrai intenção e resumo de transcrições de chamadas usando o provider de
 * IA do tenant (getAiProviderForTenant). O resultado alimenta a timeline da
 * conversa (Inbox) e a Next Best Action.
 *
 * Fail-soft por desenho: sem provider, timeout, JSON inválido ou intent
 * fora da allowlist → null (a chamada e a transcrição continuam íntegras;
 * apenas o insight fica ausente). Nunca lança.
 */

const logger = require('../../utils/logger');

const INTENT_ALLOWLIST = new Set([
  'agendar',
  'reagendar',
  'cancelar',
  'confirmar',
  'reclamacao',
  'duvida',
  'compra',
  'pagamento',
  'retorno',
  'suporte',
  'outro',
]);

const URGENCY_ALLOWLIST = new Set(['baixa', 'media', 'alta']);

const MAX_TRANSCRIPT_CHARS = 4000;
const AI_TIMEOUT_MS = Math.max(1000, Number(process.env.CALL_INSIGHT_AI_TIMEOUT_MS) || 20000);

function buildPrompt(transcript) {
  return [
    'Você analisa transcrições de ligações de atendimento e responde SOMENTE com JSON válido.',
    'Formato obrigatório (sem markdown, sem texto extra):',
    '{"intent":"agendar|reagendar|cancelar|confirmar|reclamacao|duvida|compra|pagamento|retorno|suporte|outro","summary":"resumo objetivo em até 140 caracteres, em português","urgency":"baixa|media|alta","suggestedAction":"próxima ação operacional sugerida em até 120 caracteres"}',
    'Regras:',
    '- intent = intenção principal do cliente na ligação;',
    '- summary = o que o cliente quer, em linguagem de negócio (nunca técnica);',
    '- suggestedAction = ação que o operador deve tomar em seguida;',
    '- se a transcrição não permitir concluir, use intent "outro" e urgency "baixa".',
    '',
    'TRANSCRIÇÃO:',
    transcript,
  ].join('\n');
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_err) {
    return null;
  }
}

function sanitizeInsight(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const intent = String(parsed.intent || '').trim().toLowerCase();
  if (!INTENT_ALLOWLIST.has(intent)) return null;
  const summary = String(parsed.summary || '').trim().slice(0, 200);
  if (!summary) return null;
  const urgency = URGENCY_ALLOWLIST.has(String(parsed.urgency || '').trim().toLowerCase())
    ? String(parsed.urgency).trim().toLowerCase()
    : 'media';
  const suggestedAction = String(parsed.suggestedAction || '').trim().slice(0, 160) || null;
  return { intent, summary, urgency, suggestedAction };
}

/**
 * Analisa uma transcrição de chamada.
 *
 * @param {{ tenantId: string, transcript: string }} args
 * @returns {Promise<{intent: string, summary: string, urgency: string, suggestedAction: string|null, analyzedAt: string, provider: string}|null>}
 */
async function analyzeCallTranscript({ tenantId, transcript } = {}) {
  const text = String(transcript || '').trim();
  if (!tenantId || !text) return null;

  try {
    // Require tardio: mantém o serviço carregável em ambientes sem engine.
    // eslint-disable-next-line global-require
    const { getAiProviderForTenant } = require('../../../engine/aiProviderManager');
    const provider = getAiProviderForTenant(tenantId);
    if (!provider || typeof provider.generate !== 'function') return null;

    const prompt = buildPrompt(text.slice(0, MAX_TRANSCRIPT_CHARS));
    let timer = null;
    const result = await Promise.race([
      provider.generate(prompt, { tenantId: String(tenantId), purpose: 'call_transcript_insight' }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('ai_timeout: insight de transcrição excedeu o limite')), AI_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]).finally(() => clearTimeout(timer));

    const rawText = typeof result === 'string' ? result : (result?.text || result?.content || '');
    const insight = sanitizeInsight(extractJson(rawText));
    if (!insight) {
      logger.warn('[CallInsight] Resposta de IA fora do contrato — insight descartado', { tenantId });
      return null;
    }
    return {
      ...insight,
      analyzedAt: new Date().toISOString(),
      provider: result?.provider || provider.id || 'tenant-ai',
    };
  } catch (err) {
    logger.warn('[CallInsight] Análise de transcrição indisponível (fail-soft)', {
      tenantId,
      error: err?.message,
    });
    return null;
  }
}

module.exports = {
  analyzeCallTranscript,
  INTENT_ALLOWLIST,
};
