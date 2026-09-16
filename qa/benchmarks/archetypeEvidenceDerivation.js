'use strict';

/**
 * archetypeEvidenceDerivation — deriva, de achados PERSISTIDOS, se um benchmark
 * tem evidência REAL para representar um arquétipo de mercado.
 *
 * Regra fundamental: DECLARAR que um benchmark cobre um arquétipo sem achado
 * VERIFICADO que aterrisse no vocabulário do arquétipo é ficção auditável. Um
 * mapeamento de arquétipo só é suportado quando existe finding com
 * `verified === true` cujo nome casa (termo contíguo declarado) com o
 * vocabulário versionado do arquétipo (`config/benchmark-normalization.json`,
 * seção `archetypeEvidenceTerms`).
 *
 * O módulo é PURO (zero I/O): recebe os achados e o vocabulário, devolve o
 * veredito com os findings que sustentam — ou a RECUSA nominal. Ausência de
 * evidência NUNCA vira cobertura: é `supported: false` com razão auditável.
 *
 * Nada aqui inventa equivalência: um termo que não está declarado no
 * vocabulário versionado não casa — mesma disciplina do longest-match-wins de
 * `benchmarkResearchSemantics` (sem stemming, sem aproximação).
 */

const REASONS = Object.freeze({
  ARCHETYPE_REQUIRED: 'archetype_required',
  VOCABULARY_MISSING: 'archetype_vocabulary_missing',
  NO_VERIFIED_FINDINGS: 'no_verified_findings_for_benchmark',
  NO_MATCH: 'no_verified_finding_matches_archetype_vocabulary',
  SUPPORTED: null,
});

/**
 * Normalização determinística de termo (mesma forma de
 * `benchmarkResearchSemantics.normalizeTerm`): caixa, acentos, pontuação.
 * Duplicada de propósito: `qa/` não pode depender de `api/` (camadas estritas).
 */
function normalizeTerm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value) {
  const normalized = normalizeTerm(value);
  return normalized ? normalized.split(' ') : [];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Casamento por FRASE INTEIRA: o termo precisa aparecer como sequência contígua de tokens. */
function containsTerm(tokens, termTokens) {
  if (termTokens.length === 0 || tokens.length < termTokens.length) return false;
  for (let start = 0; start <= tokens.length - termTokens.length; start += 1) {
    if (termTokens.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

/**
 * Vocabulário de evidência de UM arquétipo, lido da configuração versionada.
 *
 * @param {object} normalizationConfig conteúdo de config/benchmark-normalization.json
 * @param {string} archetypeId
 * @returns {string[]} termos normalizados (nunca inventados)
 */
function archetypeTerms(normalizationConfig, archetypeId) {
  const section = normalizationConfig && normalizationConfig.archetypeEvidenceTerms;
  const entry = section && section[archetypeId];
  const terms = Array.isArray(entry && entry.terms) ? entry.terms : [];
  return terms.map(normalizeTerm).filter(Boolean);
}

/**
 * Deriva o suporte de evidência de UM arquétipo nos achados de UM benchmark.
 *
 * @param {object} args
 * @param {string} args.archetype          id do arquétipo (ex.: 'financial-billing')
 * @param {Array}  args.findings           achados persistidos do benchmark
 * @param {object} args.normalizationConfig conteúdo de benchmark-normalization.json
 * @returns {{archetype: string, supported: boolean, reason: string|null,
 *            supportingFindings: Array, verifiedFindings: number, totalFindings: number}}
 */
function deriveArchetypeEvidence({ archetype, findings = [], normalizationConfig } = {}) {
  const list = Array.isArray(findings) ? findings : [];
  const verified = list.filter((finding) => finding && finding.verified === true);
  const base = {
    archetype: isNonEmptyString(archetype) ? String(archetype) : null,
    supported: false,
    supportingFindings: [],
    verifiedFindings: verified.length,
    totalFindings: list.length,
  };

  if (!isNonEmptyString(archetype)) {
    return { ...base, reason: REASONS.ARCHETYPE_REQUIRED };
  }
  const terms = archetypeTerms(normalizationConfig, archetype);
  if (terms.length === 0) {
    return { ...base, reason: REASONS.VOCABULARY_MISSING };
  }
  if (verified.length === 0) {
    return { ...base, reason: REASONS.NO_VERIFIED_FINDINGS };
  }

  const supporting = [];
  for (const finding of verified) {
    const name = finding.external_name || finding.externalName || finding.name || null;
    const tokens = tokenize(name);
    if (tokens.length === 0) continue;
    for (const term of terms) {
      const termTokens = term.split(' ');
      if (containsTerm(tokens, termTokens)) {
        supporting.push({
          id: finding.id || null,
          evidenceId: finding.evidence_id || finding.evidenceId || null,
          sourceId: finding.source_id || finding.sourceId || null,
          name,
          kind: finding.kind || null,
          matchedTerm: term,
        });
        break;
      }
    }
  }

  if (supporting.length === 0) {
    return { ...base, reason: REASONS.NO_MATCH };
  }
  return { ...base, supported: true, reason: REASONS.SUPPORTED, supportingFindings: supporting };
}

/**
 * Deriva a cobertura de TODOS os arquétipos relevantes a partir dos achados
 * persistidos, agrupados por benchmark. Cada entrada carrega o veredito e os
 * findings que sustentam — o consumidor nunca precisa confiar em declaração.
 *
 * @param {object} args
 * @param {Array}  args.archetypes   arquétipos do sample (`[{id, importance, status}]`)
 * @param {Array}  args.benchmarks   `[{ id, findings: [] }]`
 * @param {object} args.normalizationConfig
 * @returns {{results: Array, coverageSupported: Object}}
 */
function deriveSampleArchetypeEvidence({ archetypes = [], benchmarks = [], normalizationConfig } = {}) {
  const findingsByBenchmark = new Map(
    (Array.isArray(benchmarks) ? benchmarks : []).map((b) => [String(b && b.id), (b && b.findings) || []]),
  );
  const results = [];
  const coverageSupported = {};

  for (const archetype of Array.isArray(archetypes) ? archetypes : []) {
    const archetypeId = String(archetype && archetype.id || '');
    if (!archetypeId) continue;
    const perBenchmark = [];
    for (const [benchmarkId, findings] of findingsByBenchmark.entries()) {
      const derivation = deriveArchetypeEvidence({ archetype: archetypeId, findings, normalizationConfig });
      if (derivation.supported) perBenchmark.push({ benchmarkId, ...derivation });
    }
    coverageSupported[archetypeId] = perBenchmark.length > 0;
    results.push({
      archetype: archetypeId,
      supported: perBenchmark.length > 0,
      supportingBenchmarks: perBenchmark,
    });
  }

  return { results, coverageSupported };
}

module.exports = {
  REASONS,
  normalizeTerm,
  archetypeTerms,
  deriveArchetypeEvidence,
  deriveSampleArchetypeEvidence,
};
