'use strict';

const crypto = require('crypto');

/**
 * Journey Review Service
 *
 * Implementa o fluxo interativo de "Revisar Jornada" (per-journey), dirigido
 * por IA + aprovação humana:
 *
 *   1. Inferir  — gera uma proposta de cenário por IA (generateScenarioWithAI)
 *   2. Mostrar desalinhamento — compara a proposta com o cenário atual/ajustado
 *   3. Ajustes do usuário — o usuário edita o cenário (baseScenario)
 *   4. Nova inferência — re-infere levando os ajustes em conta
 *   5. Aprovação — resultado mostrado para aprovação
 *   6. Atualizar jornada — saveScenario (versão nova, histórico)
 *
 * Também detecta falhas/gaps e sugere correções (coverage + business gaps).
 */

const {
  generateScenarioWithAI,
  saveScenario,
  listLatestScenarios,
  validateScenarioPayload,
} = require('./qaWavesScenarioService');
const qaWavesIntelligenceService = require('./qaWavesIntelligenceService');
const { generateAiResponse } = require('./aiProviderService');
const { belongsToTenant, normalizeTenantKey } = require('../../lib/rpaSecurity');
const { resolveSigningKey } = require('../../lib/replayIntegrity');

const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;
const MISALIGNMENT_SEVERITIES = new Set(['critical', 'warning', 'info']);
const MISALIGNMENT_MAX_ITEMS = 20;
// Bound de tokens: cenários serializados além disso são truncados no prompt.
const MISALIGNMENT_PROMPT_MAX_CHARS = 12000;

function nowIso() {
  return new Date().toISOString();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getLatestScenarioForJourney(vertical, journeyId, tenantId = 'system') {
  const scopedTenantId = normalizeTenantKey(tenantId);
  let items = [];
  try {
    const result = listLatestScenarios({ journeyId, tenantId: scopedTenantId });
    items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  } catch (_) {
    items = [];
  }
  return items.find((item) => String(item.vertical || '').toLowerCase() === String(vertical || '').toLowerCase())
    || items[0]
    || null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

function hashScenario(scenario) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(scenario || {}))).digest('hex');
}

function reviewSigningKey() {
  return resolveSigningKey(process.env.QA_WAVES_REVIEW_SIGNING_KEY || null);
}

function createReviewToken(claims) {
  const encoded = Buffer.from(JSON.stringify(stable(claims)), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', reviewSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyReviewToken(token) {
  const [encoded, providedSignature, extra] = String(token || '').split('.');
  if (!encoded || !providedSignature || extra !== undefined) {
    throw Object.assign(new Error('reviewToken inválido'), { code: 'BAD_REQUEST' });
  }
  const expectedSignature = crypto.createHmac('sha256', reviewSigningKey()).update(encoded).digest('base64url');
  const provided = Buffer.from(providedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw Object.assign(new Error('reviewToken inválido'), { code: 'BAD_REQUEST' });
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_) {
    throw Object.assign(new Error('reviewToken inválido'), { code: 'BAD_REQUEST' });
  }
  if (!Number.isFinite(claims.expiresAt) || Date.now() > claims.expiresAt) {
    throw Object.assign(new Error('reviewToken expirado; execute uma nova inferência'), { code: 'BAD_REQUEST' });
  }
  if (!Number.isFinite(claims.issuedAt) || claims.issuedAt - Date.now() > 5 * 60 * 1000) {
    throw Object.assign(new Error('reviewToken com timestamp inválido'), { code: 'BAD_REQUEST' });
  }
  return claims;
}

/**
 * Compara o cenário base (atual/ajustado pelo usuário) com a proposta da IA e
 * devolve a lista de desalinhamentos — análise SEMÂNTICA via IA (IA-first):
 * o próprio modelo julga equivalência de passos, seeds, validadores e
 * executabilidade, em vez de igualdade de strings/heurística de conjuntos.
 *
 * Sem provider configurado ou resposta inválida, devolve uma entrada
 * `analysis_unavailable` — nunca faz fallback para heurística de strings.
 *
 * @param {object} baseScenario
 * @param {object} inferredScenario
 * @param {string} [tenantId]
 * @returns {Promise<Array<{type: string, severity: string, message: string}>>}
 */
async function computeMisalignment(baseScenario, inferredScenario, tenantId = 'system') {
  if (!inferredScenario || typeof inferredScenario !== 'object') {
    return [{
      type: 'missing_proposal',
      severity: 'critical',
      message: 'A proposta da IA não gerou cenário.',
    }];
  }

  const unavailable = (reason) => [{
    type: 'analysis_unavailable',
    severity: 'warning',
    message: `Análise semântica de desalinhamento indisponível (${reason}). Revise manualmente antes de aprovar.`,
  }];

  const compact = (scenario) => {
    const steps = safeArray(scenario?.semanticSteps).length > 0
      ? safeArray(scenario.semanticSteps)
      : safeArray(scenario?.steps);
    return {
      name: scenario?.name || null,
      goal: scenario?.goal || null,
      steps: steps.map((s) => ({
        type: s?.type || s?.id || null,
        description: s?.description || s?.action || s?.goal || null,
      })),
      seedsCount: safeArray(scenario?.seeds).length,
      validatorsCount: safeArray(scenario?.validators).length,
      platformScenarioIds: safeArray(scenario?.platformScenarioIds),
    };
  };

  let baseJson = JSON.stringify(compact(baseScenario || {}));
  let inferredJson = JSON.stringify(compact(inferredScenario));
  if (baseJson.length + inferredJson.length > MISALIGNMENT_PROMPT_MAX_CHARS) {
    const budget = Math.floor(MISALIGNMENT_PROMPT_MAX_CHARS / 2);
    baseJson = baseJson.slice(0, budget);
    inferredJson = inferredJson.slice(0, budget);
  }

  const prompt = [
    'Você é um revisor de cenários de QA de uma plataforma de operações.',
    'Compare o CENÁRIO ATUAL com a PROPOSTA DA IA e aponte desalinhamentos SEMÂNTICOS',
    '(passos equivalentes com nomes diferentes NÃO são desalinhamento; julgue pela intenção).',
    'Avalie: cobertura de passos, seeds de dados, validadores e executabilidade',
    '(platformScenarioIds ausentes na proposta = crítico, pois o cenário não roda no mesh).',
    'Responda APENAS com um array JSON (sem markdown), em português, no formato:',
    '[{"type":"snake_case","severity":"critical|warning|info","message":"descrição curta"}]',
    'Se estiverem semanticamente alinhados, responda:',
    '[{"type":"aligned","severity":"info","message":"Cenário alinhado com a proposta da IA."}]',
    '',
    'CENÁRIO ATUAL:',
    baseJson,
    '',
    'PROPOSTA DA IA:',
    inferredJson,
  ].join('\n');

  let text;
  try {
    const result = await generateAiResponse(prompt, normalizeTenantKey(tenantId), {
      caller: 'journeyReviewService.computeMisalignment',
      source: 'journey-review',
    });
    text = result && result.text;
  } catch (error) {
    return unavailable(error && error.message ? error.message : 'provider de IA indisponível');
  }

  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return unavailable('resposta da IA fora do formato esperado');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return unavailable('resposta da IA com JSON inválido');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return unavailable('resposta da IA sem itens de análise');
  }

  const items = parsed
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.message === 'string' && entry.message.trim())
    .slice(0, MISALIGNMENT_MAX_ITEMS)
    .map((entry) => ({
      type: typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim() : 'semantic_diff',
      severity: MISALIGNMENT_SEVERITIES.has(entry.severity) ? entry.severity : 'info',
      message: entry.message.trim(),
    }));
  return items.length > 0 ? items : unavailable('resposta da IA sem itens utilizáveis');
}

/**
 * Coleta sugestões de correção (falhas/gaps) para a jornada.
 */
function collectJourneySuggestions(vertical, journeyId, tenantId = 'system') {
  const suggestions = [];
  try {
    const coverage = qaWavesIntelligenceService.analyzeCoverageGaps({ vertical, journey: journeyId, tenantId });
    for (const action of coverage.recommendedActions || []) {
      suggestions.push({ source: 'coverage', message: action });
    }
    for (const weak of coverage.weakScenarios || []) {
      suggestions.push({
        source: 'coverage',
        message: `Cenário fraco ${weak.id}: ${(weak.reasons || []).join(', ')}`,
      });
    }
  } catch (_) {
    // best-effort
  }

  try {
    const business = qaWavesIntelligenceService.getBusinessGaps({ vertical, journey: journeyId, tenantId });
    for (const entry of business.verticals || []) {
      for (const cap of entry.gaps?.capabilityGaps || []) {
        suggestions.push({
          source: 'business',
          message: `Jornada ${entry.journeyId} sem cenário QA para a capability: ${cap}`,
        });
      }
    }
  } catch (_) {
    // best-effort
  }

  return suggestions;
}

/**
 * Fase "inferir" (e "nova inferência"): gera proposta + desalinhamento + sugestões.
 *
 * @param {object} options
 * @param {string} options.vertical
 * @param {string} options.journeyId
 * @param {string} [options.goal]
 * @param {object} [options.baseScenario] - cenário ajustado pelo usuário (para nova inferência)
 * @returns {Promise<object>}
 */
async function inferJourneyReview(options = {}) {
  const vertical = String(options.vertical || '').trim().toLowerCase();
  const journeyId = String(options.journeyId || options.journey || '').trim();
  const tenantId = normalizeTenantKey(options.tenantId || 'system');
  const reviewedBy = String(options.reviewedBy || '').trim();
  if (!vertical || !journeyId) {
    const error = new Error('vertical e journeyId são obrigatórios');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (!reviewedBy) {
    throw Object.assign(new Error('reviewedBy autenticado é obrigatório'), { code: 'BAD_REQUEST' });
  }

  if (options.baseScenario?.tenantId && !belongsToTenant(options.baseScenario, tenantId)) {
    throw Object.assign(new Error('baseScenario não pertence ao tenant autenticado'), { code: 'BAD_REQUEST' });
  }

  const existing = getLatestScenarioForJourney(vertical, journeyId, tenantId);
  const base = options.baseScenario && typeof options.baseScenario === 'object'
    ? options.baseScenario
    : existing;

  const inferred = await generateScenarioWithAI({
    vertical,
    journeyId,
    goal: options.goal || journeyId,
    channels: options.channels || ['whatsapp', 'chat'],
    tenantId,
    preserveExplicitJourney: true,
    ...(options.baseScenario && base
      ? {
          aiOutput: {
            ...base,
            vertical,
            journey: journeyId,
            journeyId,
            status: 'reviewed',
          },
        }
      : {}),
    constraints: {
      semanticStepsOnly: true,
      platformCompatibleOnly: true,
      generateSeeds: true,
    },
  });

  const issuedAt = Date.now();
  const reviewClaims = {
    reviewId: crypto.randomUUID(),
    tenantId,
    reviewedBy,
    vertical,
    journeyId,
    currentScenarioId: existing?.id || null,
    currentVersion: existing?.version || null,
    proposedScenarioId: inferred.scenario?.id || null,
    proposedScenarioSha256: hashScenario(inferred.scenario),
    issuedAt,
    expiresAt: issuedAt + REVIEW_TOKEN_TTL_MS,
  };

  return {
    reviewedAt: nowIso(),
    vertical,
    journeyId,
    existingScenarioId: existing?.id || null,
    existingVersion: existing?.version || null,
    inferredScenario: inferred.scenario,
    reviewToken: createReviewToken(reviewClaims),
    reviewExpiresAt: new Date(reviewClaims.expiresAt).toISOString(),
    validation: inferred.validation,
    misalignment: await computeMisalignment(base, inferred.scenario, tenantId),
    suggestions: collectJourneySuggestions(vertical, journeyId, tenantId),
  };
}

/**
 * Fase "aprovar e atualizar": persiste o cenário aprovado (nova versão).
 *
 * @param {object} options
 * @param {object} options.scenario - cenário aprovado
 * @param {string} [options.changedBy]
 * @param {string[]} [options.changes]
 * @returns {object}
 */
function applyJourneyReview(options = {}) {
  if (options.approved !== true) {
    throw Object.assign(new Error('approved=true é obrigatório para aplicar a revisão'), { code: 'BAD_REQUEST' });
  }
  const changedBy = String(options.changedBy || '').trim();
  if (!changedBy) {
    throw Object.assign(new Error('changedBy autenticado é obrigatório'), { code: 'BAD_REQUEST' });
  }
  const tenantId = normalizeTenantKey(options.tenantId);
  const claims = verifyReviewToken(options.reviewToken);
  if (claims.tenantId !== tenantId) {
    throw Object.assign(new Error('reviewToken não pertence ao tenant autenticado'), { code: 'BAD_REQUEST' });
  }
  if (!claims.reviewedBy || claims.reviewedBy !== changedBy) {
    throw Object.assign(new Error('reviewToken não pertence ao revisor autenticado'), { code: 'BAD_REQUEST' });
  }
  const scenario = options.scenario;
  if (!scenario || typeof scenario !== 'object') {
    const error = new Error('scenario é obrigatório');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (String(scenario.id || '') !== String(claims.proposedScenarioId || '')) {
    throw Object.assign(new Error('scenario diverge da identidade aprovada na inferência'), { code: 'BAD_REQUEST' });
  }
  if (String(scenario.vertical || '').toLowerCase() !== claims.vertical
    || String(scenario.journeyId || scenario.journey || '') !== claims.journeyId) {
    throw Object.assign(new Error('scenario diverge da jornada vinculada ao reviewToken'), { code: 'BAD_REQUEST' });
  }
  if (hashScenario(scenario) !== claims.proposedScenarioSha256) {
    throw Object.assign(new Error(
      'scenario foi alterado após a inferência; execute uma nova inferência antes de aprovar',
    ), { code: 'BAD_REQUEST' });
  }

  const current = getLatestScenarioForJourney(claims.vertical, claims.journeyId, tenantId);
  if ((current?.id || null) !== claims.currentScenarioId || (current?.version || null) !== claims.currentVersion) {
    throw Object.assign(new Error('A jornada mudou após a inferência; revise novamente antes de aprovar'), { code: 'CONFLICT' });
  }

  const listed = listLatestScenarios({ tenantId, journeyId: claims.journeyId });
  // Check-then-act seguro: applyJourneyReview é síncrono de ponta a ponta
  // (store em arquivo com escrita atômica) e a API roda em processo único —
  // não há interleaving entre este check e o saveScenario abaixo. Se um dia
  // este fluxo ganhar awaits ou a API rodar multi-processo, é preciso lock.
  const alreadyApplied = Object.values(listed.history || {})
    .flatMap((entries) => safeArray(entries))
    .some((entry) => entry?.reviewId === claims.reviewId);
  if (alreadyApplied) {
    throw Object.assign(new Error('Esta revisão já foi aplicada'), { code: 'CONFLICT' });
  }

  const approvedScenario = { ...scenario, tenantId, status: 'approved' };
  const validation = validateScenarioPayload({ scenario: approvedScenario, tenantId });
  if (!validation.valid) {
    const error = new Error('Cenário inválido para aprovação');
    error.code = 'BAD_REQUEST';
    error.details = validation;
    throw error;
  }
  return saveScenario({
    scenario: validation.normalizedScenario,
    tenantId,
    changedBy,
    reviewId: claims.reviewId,
    changes: Array.isArray(options.changes) && options.changes.length > 0
      ? options.changes
      : ['revisão de jornada aprovada'],
  });
}

module.exports = {
  REVIEW_TOKEN_TTL_MS,
  inferJourneyReview,
  applyJourneyReview,
  computeMisalignment,
  collectJourneySuggestions,
};
