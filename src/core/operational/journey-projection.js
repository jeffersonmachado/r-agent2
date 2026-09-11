'use strict';

/**
 * Projeção operacional de jornadas de negócio.
 *
 * Problema que este módulo resolve: o grafo de QA (QA Waves / QA Mesh) contém
 * identificadores técnicos — wave ID, scenarioId, seeds, replay, passos de RPA,
 * rotas internas, nomes de engines. Esse material é DEVELOPMENT e não pode
 * aparecer em superfície operacional nem no conhecimento consumido pelo
 * copiloto.
 *
 * A projeção operacional é uma representação de NEGÓCIO derivada desse material
 * e sanitizada: apenas estágios, canais e pré-condições operacionais
 * sobrevivem. A sanitização é fail-closed — se qualquer token técnico
 * classificado como DEVELOPMENT sobreviver, a projeção é REJEITADA (o gerador
 * falha em vez de publicar conteúdo contaminado).
 */

const PROJECTION_SCOPE = 'OPERATIONAL';
const PROJECTION_VERSION = 1;

// Chaves de estrutura técnica que NUNCA entram na projeção operacional.
const FORBIDDEN_KEYS = Object.freeze([
  'scenarioId', 'scenario_id', 'waveId', 'wave_id', 'seedId', 'seed_id',
  'replayId', 'replay_id', 'replaySupport', 'replayEnabled', 'qaSupport',
  'technicalRoute', 'route', 'selector', 'uiTrace', 'rpaSteps', 'steps',
  'operationalAssertions', 'assertions', 'status', 'maturity', 'generatedAt',
  'coverage', 'fingerprint', 'sha256', 'engine', 'engines', 'jobId', 'runId',
  'executionId', 'evidence', 'artifacts',
]);

// Tokens que denunciam conteúdo técnico vazado em texto operacional.
const TECHNICAL_TOKEN_PATTERNS = Object.freeze([
  { id: 'wave', pattern: /\bqa[-_\s]*waves?\b|\bwave[-_\s]*\d+\b/i },
  { id: 'qa_mesh', pattern: /\bqa[-_\s]*mesh\b/i },
  { id: 'scenario_id', pattern: /\bscenario[-_]?id\b|\bbusiness-e2e-|precond-/i },
  { id: 'seed', pattern: /\bseeds?\b|\bseed[-_]?(?:type|data)\b/i },
  { id: 'replay', pattern: /\breplays?\b|\brpa\b|\bui[-_]?trace\b/i },
  { id: 'coverage', pattern: /\bcoverage[-_\s]?(?:gate|engine|analysis)\b|\bfingerprints?\b/i },
  { id: 'engine', pattern: /\b(?:validation|regression|evidence|benchmark)[-_\s]?engine\b|\bnodeschemas\b|\bnosele\b/i },
  { id: 'route', pattern: /\/api\/|\/dev\/|\bhttps?:\/\/(?:localhost|127\.0\.0\.1)\b/i },
  { id: 'step_chain', pattern: /\bstep[_-]\d+\b|\bstep_e2e_|\bvalidate_backend\b|\bstep[_-][a-z0-9]+_[a-z0-9_]+\b/i },
  { id: 'draft_marker', pattern: /\bdraft_ai\b|\bprecondi[çc][ãa]o:\s/i },
]);

/**
 * Verifica se um texto contém token técnico proibido.
 * @returns {{clean: boolean, tokens: string[]}} tokens NUNCA valores
 */
function detectTechnicalTokens(text) {
  const raw = String(text ?? '');
  if (!raw) return { clean: true, tokens: [] };
  const tokens = [];
  for (const { id, pattern } of TECHNICAL_TOKEN_PATTERNS) {
    if (pattern.test(raw)) tokens.push(id);
  }
  return { clean: tokens.length === 0, tokens };
}

function sanitizeOperationalText(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  const { clean, tokens } = detectTechnicalTokens(value);
  if (!clean) {
    const error = new Error(`Conteúdo técnico detectado em projeção operacional: ${tokens.join(', ')}`);
    error.code = 'TECHNICAL_LEAK';
    error.tokens = tokens;
    throw error;
  }
  return value;
}

/**
 * Percorre a projeção garantindo que nenhuma chave proibida e nenhum token
 * técnico sobreviva. Fail-closed.
 *
 * @param {*} node
 * @param {string} [path]
 */
function assertOperationalClean(node, path = '$') {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const { clean, tokens } = detectTechnicalTokens(node);
    if (!clean) {
      const error = new Error(`Vazamento técnico em ${path}: ${tokens.join(', ')}`);
      error.code = 'TECHNICAL_LEAK';
      error.path = path;
      error.tokens = tokens;
      throw error;
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertOperationalClean(item, `${path}[${index}]`));
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        const error = new Error(`Chave técnica proibida em ${path}.${key}`);
        error.code = 'TECHNICAL_LEAK';
        error.path = `${path}.${key}`;
        throw error;
      }
      assertOperationalClean(value, `${path}.${key}`);
    }
  }
}

/**
 * Constrói uma projeção operacional de uma jornada.
 *
 * @param {Object} input
 * @param {string} input.vertical
 * @param {string} input.journeyKey
 * @param {string} input.title
 * @param {Array<{id?: string, title: string, description?: string}>} input.stages
 * @param {string[]} [input.channels]
 * @param {string[]} [input.preconditions]
 * @returns {Object} projeção sanitizada
 */
function projectBusinessJourney({ vertical, journeyKey, title, stages, channels = [], preconditions = [] }) {
  const projection = {
    scope: PROJECTION_SCOPE,
    version: PROJECTION_VERSION,
    vertical: sanitizeOperationalText(vertical) || null,
    journeyKey: sanitizeOperationalText(journeyKey) || null,
    title: sanitizeOperationalText(title) || null,
    channels: (Array.isArray(channels) ? channels : [])
      .map((channel) => sanitizeOperationalText(channel))
      .filter(Boolean)
      .slice(0, 12),
    preconditions: (Array.isArray(preconditions) ? preconditions : [])
      .map((item) => sanitizeOperationalText(item))
      .filter(Boolean)
      .slice(0, 12),
    stages: (Array.isArray(stages) ? stages : [])
      .map((stage, index) => ({
        id: `stage_${index + 1}`,
        title: sanitizeOperationalText(stage?.title),
        description: sanitizeOperationalText(stage?.description) || null,
      }))
      .filter((stage) => stage.title),
  };

  assertOperationalClean(projection);
  return projection;
}

/**
 * Deriva estágios de negócio a partir de uma entrada de cobertura de QA,
 * usando um catálogo declarativo de mapeamento.
 *
 * Regra de segurança: passos técnicos SEM mapeamento de negócio são
 * DESCARTADOS (nunca emitidos). Nada é inferido a partir do texto técnico.
 *
 * @param {Object} coverageJourney - entrada de `qa-waves/journey-coverage/*.json`
 * @param {Object} catalog - `{ [journeyKey]: { title, stages: [{ title, description }] } }`
 * @returns {Object|null}
 */
function deriveProjectionFromQaCoverage(coverageJourney, catalog = {}) {
  const journeyKey = String(coverageJourney?.journey || '').trim();
  if (!journeyKey) return null;

  const entry = catalog[journeyKey];
  if (!entry || !Array.isArray(entry.stages) || entry.stages.length === 0) {
    // Sem estágios de negócio mapeados: nenhuma projeção é emitida.
    // Preferimos ausência a publicar material técnico.
    return null;
  }

  const channels = [...new Set(
    (coverageJourney?.scenarios || [])
      .flatMap((scenario) => (Array.isArray(scenario?.channels) ? scenario.channels : []))
      .map((channel) => String(channel).trim())
      .filter((channel) => channel && !/^(?:api|backend|integration)$/i.test(channel)),
  )].sort();

  return projectBusinessJourney({
    vertical: coverageJourney?.vertical,
    journeyKey,
    title: entry.title || journeyKey,
    stages: entry.stages,
    channels,
    preconditions: entry.preconditions || [],
  });
}

module.exports = {
  PROJECTION_SCOPE,
  PROJECTION_VERSION,
  FORBIDDEN_KEYS,
  TECHNICAL_TOKEN_PATTERNS,
  detectTechnicalTokens,
  sanitizeOperationalText,
  assertOperationalClean,
  projectBusinessJourney,
  deriveProjectionFromQaCoverage,
};
