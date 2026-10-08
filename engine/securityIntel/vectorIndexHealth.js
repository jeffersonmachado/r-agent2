'use strict';

/**
 * vectorIndexHealth — veredito de saúde de índice vetorial.
 *
 * Módulo PURO e DETERMINÍSTICO. Recebe apenas FATOS MEDIDOS (versão da extensão,
 * estado do índice no catálogo do PostgreSQL, dimensões dos embeddings, uso pelo
 * planner) e devolve um veredito com a evidência que o produziu.
 *
 * Por que existe: o RAP tem histórico de problemas classificados como "corrupção
 * dos índices do RAG". Medição de 2026-10-08 mostrou que o índice atual está
 * VÁLIDO — o que significa que o problema ou já foi resolvido, ou é intermitente,
 * ou foi diagnosticado errado. Sem um check permanente, cada investigação começa
 * do zero e termina em narrativa. Este módulo produz veredito com evidência.
 *
 * REGRAS DE HONESTIDADE:
 *   - Fato ausente ⇒ `UNKNOWN` para aquele eixo, e o veredito global NÃO pode ser
 *     `HEALTHY`. Não medir nunca é "está tudo bem".
 *   - Versão instalada abaixo do mínimo recomendado (declarado em política) é
 *     `DEGRADED`, não `INVALID`: é risco de versão, não corrupção.
 *   - Nenhuma afirmação de CVE/CORRUPÇÃO é feita aqui; só o que foi medido.
 */

const { compareVersions } = require('./versionCore');

const VERDICTS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  INVALID: 'INVALID',
  UNKNOWN: 'UNKNOWN',
});

const SEVERITIES = Object.freeze(['BLOCKING', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

const HNSW_METHODS = Object.freeze(new Set(['hnsw', 'ivfflat']));

/**
 * Eixos ESSENCIAIS: sem eles medidos não existe conclusão de segurança possível.
 * Um eixo essencial não medido produz veredito `UNKNOWN` — nunca `HEALTHY`.
 * (Lacuna de evidência é registrada em `unmeasured`, e NÃO como achado: achado é
 * problema COMPROVADO; misturar os dois faria o relatório mentir sobre o que foi
 * demonstrado.)
 */
const ESSENTIAL_AXES = Object.freeze([
  'extension_version',
  'index',
  'index_catalog_flags',
  'embeddings',
  'planner',
]);

/** Normaliza o nome do método a partir do `indexdef` do PostgreSQL. */
function detectIndexMethod(indexDef) {
  if (typeof indexDef !== 'string') return null;
  const match = /\bUSING\s+([a-z_]+)/i.exec(indexDef);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Compara a versão instalada com o mínimo recomendado declarado em política.
 * @returns {'unknown'|'behind'|'ok'}
 */
function compareWithRecommended(installedVersion, recommendedMinVersion) {
  if (!installedVersion || !recommendedMinVersion) return 'unknown';
  const comparison = compareVersions(installedVersion, recommendedMinVersion, { ecosystem: 'generic' });
  if (comparison === null) return 'unknown';
  return comparison < 0 ? 'behind' : 'ok';
}

/**
 * Avalia a saúde do índice vetorial.
 *
 * @param {object} input
 * @param {object|null} input.extension    `{name, version}` (ex.: `vector 0.6.0`)
 * @param {object|null} input.index        `{name, method, opclass, isValid, isReady, isLive, sizeBytes, scans, definition}`
 * @param {object|null} input.embeddings   `{total, nulls, wrongDimensions, expectedDimensions}`
 * @param {object|null} input.plan         `{usesVectorIndex, detail}`
 * @param {object} [input.policy]          bloco `vectorIndex` da política declarativa
 * @returns {{verdict:string, findings:Array<object>, evidence:object, summary:string}}
 */
function evaluateVectorIndexHealth({
  extension = null,
  index = null,
  embeddings = null,
  plan = null,
  policy = {},
} = {}) {
  const findings = [];
  const add = (code, severity, message, detail = {}) => findings.push({ code, severity, message, detail });
  const unmeasured = [];

  const method = index ? (index.method || detectIndexMethod(index.definition)) : null;
  const extensionVersion = extension ? extension.version || null : null;
  const recommendedMinVersion = policy.recommendedMinVersion || null;

  // ── 1. Extensão e índice existem? ───────────────────────────────────────
  if (!extension) {
    unmeasured.push('extension_version');
  } else if (!extensionVersion) {
    unmeasured.push('extension_version');
    add('vector_extension_version_unknown', 'MEDIUM', `extensão ${extension.name || '?'} sem versão declarada no catálogo`);
  }

  if (!index) {
    unmeasured.push('index');
    add('vector_index_not_found', 'BLOCKING', 'nenhum índice vetorial encontrado — busca vetorial degrada para varredura sequencial');
  } else {
    if (!HNSW_METHODS.has(method)) {
      add('vector_index_method_unexpected', 'HIGH', `método de índice inesperado: ${method || 'desconhecido'}`, { method });
    }
    const invalidFlags = [];
    if (index.isValid === false) invalidFlags.push('isValid=false');
    if (index.isReady === false) invalidFlags.push('isReady=false');
    if (index.isLive === false) invalidFlags.push('isLive=false');
    if (invalidFlags.length > 0) {
      add('vector_index_invalid', 'BLOCKING',
        `índice vetorial INVÁLIDO no catálogo (${invalidFlags.join(', ')}) — é isto que "corrupção de índice" significa na prática`,
        { index: index.name, invalidFlags });
    } else if (index.isValid === undefined || index.isReady === undefined || index.isLive === undefined) {
      unmeasured.push('index_catalog_flags');
    }
  }

  // ── 2. Integridade dos embeddings ───────────────────────────────────────
  if (!embeddings) {
    unmeasured.push('embeddings');
  } else {
    const expected = embeddings.expectedDimensions ?? policy.expectedDimensions ?? null;
    if ((embeddings.nulls || 0) > (policy.maxNullEmbeddings ?? 0)) {
      add('embeddings_nulls', 'BLOCKING', `${embeddings.nulls} embedding(s) nulo(s) — a ordenação vetorial ignora/erro nessas linhas`,
        { nulls: embeddings.nulls, total: embeddings.total });
    }
    if (expected === null) {
      unmeasured.push('expected_dimensions');
      add('embeddings_expected_dimensions_unknown', 'MEDIUM', 'dimensão esperada do embedding não declarada — não é possível validar dimensão');
    } else if ((embeddings.wrongDimensions || 0) > 0) {
      add('embeddings_dimension_mismatch', 'BLOCKING',
        `${embeddings.wrongDimensions} embedding(s) com dimensão diferente de ${expected}`,
        { wrongDimensions: embeddings.wrongDimensions, expected });
    }
    if (!embeddings.total) {
      add('embeddings_empty', 'LOW', 'nenhum chunk vetorizado: o índice não tem o que ordenar (verificar indexação)');
    }
  }

  // ── 3. O planner usa o índice? ──────────────────────────────────────────
  if (!plan) {
    unmeasured.push('planner');
  } else if (plan.usesVectorIndex === false) {
    add('planner_ignores_vector_index', 'HIGH',
      'o planner NÃO usa o índice vetorial para ordenação por distância — o índice existe mas não serve à busca',
      { detail: plan.detail || null });
  }

  // ── 4. Risco de versão (declarado em política) ──────────────────────────
  const versionStatus = compareWithRecommended(extensionVersion, recommendedMinVersion);
  if (versionStatus === 'behind') {
    add('vector_extension_behind_recommended', 'MEDIUM',
      `extensão vetorial ${extensionVersion} abaixo do mínimo recomendado ${recommendedMinVersion}`,
      { installed: extensionVersion, recommendedMinVersion });
  } else if (versionStatus === 'unknown') {
    unmeasured.push('recommended_version_comparison');
  }

  // ── Verdicto ────────────────────────────────────────────────────────────
  // Precedência: problema PROVADO (BLOCKING) > evidência essencial FALTANDO
  // (UNKNOWN) > problema provado de menor severidade (DEGRADED) > HEALTHY.
  const essentialUnmeasured = unmeasured.filter((axis) => ESSENTIAL_AXES.includes(axis));
  const hasBlocking = findings.some((finding) => finding.severity === 'BLOCKING');
  let verdict;
  if (hasBlocking) verdict = VERDICTS.INVALID;
  else if (essentialUnmeasured.length > 0) verdict = VERDICTS.UNKNOWN;
  else if (findings.some((finding) => finding.severity === 'HIGH' || finding.severity === 'MEDIUM')) verdict = VERDICTS.DEGRADED;
  else verdict = VERDICTS.HEALTHY;

  return {
    verdict,
    findings: findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
    unmeasured,
    essentialUnmeasured,
    evidence: {
      extension: extension ? { name: extension.name || null, version: extensionVersion } : null,
      index: index
        ? {
          name: index.name || null,
          method,
          opclass: index.opclass || null,
          isValid: index.isValid ?? null,
          isReady: index.isReady ?? null,
          isLive: index.isLive ?? null,
          sizeBytes: index.sizeBytes ?? null,
          scans: index.scans ?? null,
        }
        : null,
      embeddings: embeddings || null,
      planner: plan || null,
      recommendedMinVersion,
      versionStatus,
    },
    summary: buildSummary(verdict, findings, unmeasured),
  };
}
function buildSummary(verdict, findings, unmeasured) {
  if (verdict === VERDICTS.HEALTHY) {
    return 'índice vetorial íntegro e utilizado: nenhum achado nos eixos medidos';
  }
  const parts = findings.map((finding) => `${finding.severity}:${finding.code}`);
  if (unmeasured.length > 0) parts.push(`não medido:${unmeasured.join(',')}`);
  return `${verdict} — ${parts.join(' | ')}`;
}

module.exports = {
  VERDICTS,
  SEVERITIES,
  HNSW_METHODS,
  ESSENTIAL_AXES,
  detectIndexMethod,
  compareWithRecommended,
  evaluateVectorIndexHealth,
};
