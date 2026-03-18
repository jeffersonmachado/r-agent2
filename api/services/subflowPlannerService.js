/**
 * Planejador de subfluxos (best-effort).
 *
 * Objetivo:
 * - Dada uma descrição do fluxo principal, sugerir 0..N subfluxos para modularizar.
 * - Retornar SOMENTE um JSON simples para ser consumido pelo orquestrador.
 *
 * Observações:
 * - Best-effort: se IA não estiver configurada ou falhar, retorna lista vazia.
 * - NÃO persiste nada.
 */

const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}
function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  try { return err.message || String(err) || fallback; } catch (_) { return fallback; }
}

function clampInt(v, { min, max, fallback }) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function safeParseJson(text) {
  try {
    if (!text || typeof text !== 'string') return null;
    const raw = text.trim();
    // tenta extrair o primeiro JSON entre chaves
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : raw;
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   tenantId: string,
 *   name?: string|null,
 *   description: string,
 *   subflowMax?: number,
 *   signal?: AbortSignal|null,
 * }} input
 * @returns {Promise<Array<{name: string, description: string, role?: string}>>}
 */
async function planSubflows(input) {
  const tenantId = input?.tenantId;
  if (!tenantId || typeof tenantId !== 'string') return [];

  const description = safeTrim(input?.description || '');
  if (!description) return [];

  const subflowMax = clampInt(input?.subflowMax, { min: 0, max: 5, fallback: 2 });
  if (subflowMax <= 0) return [];

  // Prompt curto e determinístico: gerar apenas um JSON com subflows.
  const prompt = [
    'Você é um arquiteto de fluxos conversacionais.',
    'Tarefa: sugerir subfluxos para modularizar um fluxo principal, SEMPRE que for possível sem perder clareza.',
    '',
    'Regras obrigatórias:',
    `- Retorne APENAS um JSON válido (sem markdown, sem texto extra).`,
    `- No máximo ${subflowMax} subfluxo(s).`,
    '- Cada subfluxo deve ser coeso e ter responsabilidade única.',
    '- Priorize subfluxos quando o fluxo envolver múltiplos temas/etapas (ex.: triagem, FAQ, pagamento, cancelamento, suporte humano, status, abertura de ticket).',
    '- Evite criar subfluxos triviais (ex.: apenas uma mensagem).',
    '- NÃO inclua IDs; apenas name/description/role.',
    '',
    'Formato (OBRIGATÓRIO):',
    '{ "subflows": [ { "name": "string", "description": "string", "role": "string(opcional)" } ] }',
    '',
    'Contexto do fluxo principal:',
    `- Nome: ${input?.name ? safeToString(input.name).slice(0, 120) : 'N/A'}`,
    `- Descrição: ${description.slice(0, 2500)}`,
  ].join('\n');

  try {
    const res = await generateAiResponse(prompt, tenantId, {
      source: 'subflowPlannerService',
      endpoint: '/flows/generate',
      signal: input?.signal || null,
    });
    const parsed = safeParseJson(res?.text || '');
    const subflowsRaw = Array.isArray(parsed?.subflows) ? parsed.subflows : [];

    const cleaned = [];
    for (const sf of subflowsRaw) {
      if (!sf || typeof sf !== 'object') continue;
      const name = safeTrim(sf.name || '').slice(0, 120);
      const desc = safeTrim(sf.description || '').slice(0, 2000);
      const role = sf.role != null ? safeTrim(sf.role || '').slice(0, 80) : undefined;
      if (!name || desc.length < 20) continue;
      cleaned.push({ name, description: desc, ...(role ? { role } : {}) });
      if (cleaned.length >= subflowMax) break;
    }

    logger.info('[SubflowPlanner] Planejamento concluído', {
      tenantId,
      requestedMax: subflowMax,
      planned: cleaned.length,
    });

    return cleaned;
  } catch (err) {
    logger.warn('[SubflowPlanner] Falha ao planejar subfluxos (best-effort)', {
      tenantId,
      error: safeErrorMessage(err),
    });
    return [];
  }
}

module.exports = {
  planSubflows,
};

