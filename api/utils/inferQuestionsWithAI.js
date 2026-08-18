'use strict';

/**
 * inferQuestionsWithAI — geração de perguntas por INFERÊNCIA (IA), compartilhada
 * entre o FAQ do tenant (conteúdo de negócio) e o Journey FAQ (help da
 * plataforma por jornada).
 *
 * Guardrails (regras do projeto):
 * - A IA só FORMULA perguntas — nunca afirma preços, horários, endereços ou
 *   políticas. Respostas são sempre geradas depois, ancoradas (RAG/fontes
 *   governadas), nunca por este helper.
 * - Toda candidata deriva de uma âncora explícita (`anchor` = quadro de
 *   negócio: capacidades, pré-condições, tópicos, etc.).
 * - Pós-filtro determinístico: forma (10–160 chars, contém '?'), dedup
 *   case-insensitive contra perguntas existentes, teto por env.
 * - Falha da IA é responsabilidade do chamador reportar (ele recebe [] ou a
 *   exceção e registra `ai_unavailable`) — aqui não há fallback silencioso.
 */

const { generateAiResponse } = require('../services/aiProviderService');

const DEFAULT_MAX_QUESTIONS = 24;
const MIN_QUESTION_LENGTH = 10;
const MAX_QUESTION_LENGTH = 160;
const MAX_CONTEXT_CHARS = 6000;
const MAX_EXISTING_IN_PROMPT = 40;

function maxQuestions() {
  const raw = Number(process.env.FAQ_INFERENTIAL_MAX_QUESTIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_QUESTIONS;
}

function buildPrompt({ contextText, anchor, existingQuestions, extraInstructions, limit }) {
  const existing = (Array.isArray(existingQuestions) ? existingQuestions : [])
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, MAX_EXISTING_IN_PROMPT);

  return [
    'Você vai propor perguntas de FAQ que usuários/clientes fariam sobre o contexto abaixo.',
    '',
    'REGRAS (obrigatórias):',
    '- Responda APENAS com JSON: um array de strings.',
    '- Cada string é UMA pergunta curta em Português, terminando com "?".',
    '- NUNCA afirme fatos: não invente preços, horários, endereços, políticas ou prazos.',
    '  Você apenas formula perguntas — as respostas serão geradas depois a partir das fontes oficiais.',
    '- Não repita nem parafraseie as perguntas já existentes (lista abaixo).',
    `- No máximo ${limit} perguntas.`,
    extraInstructions ? `- ${extraInstructions}` : null,
    '',
    'ÂNCORA DE NEGÓCIO (as perguntas devem derivar daqui):',
    String(anchor || '').slice(0, 2000),
    '',
    'CONTEXTO:',
    String(contextText || '').slice(0, MAX_CONTEXT_CHARS),
    '',
    'PERGUNTAS JÁ EXISTENTES (não repetir):',
    existing.length > 0 ? JSON.stringify(existing, null, 1) : '(nenhuma)',
  ].filter((line) => line !== null).join('\n');
}

/**
 * @param {{ tenantId: string, contextText: string, anchor?: string,
 *   existingQuestions?: string[], extraInstructions?: string }} input
 * @returns {Promise<string[]>} perguntas candidatas (filtradas e deduplicadas)
 */
async function inferQuestionsWithAI({ tenantId, contextText, anchor, existingQuestions, extraInstructions }) {
  const limit = maxQuestions();
  const prompt = buildPrompt({ contextText, anchor, existingQuestions, extraInstructions, limit });

  const response = await generateAiResponse(prompt, tenantId, {});
  const raw = String(response && response.text || '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set(
    (Array.isArray(existingQuestions) ? existingQuestions : [])
      .map((q) => String(q || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const out = [];
  for (const item of parsed) {
    const question = String(item || '').trim();
    if (question.length < MIN_QUESTION_LENGTH || question.length > MAX_QUESTION_LENGTH) continue;
    if (!question.includes('?')) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  inferQuestionsWithAI,
  // exportado para testes
  buildPrompt,
};
