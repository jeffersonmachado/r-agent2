'use strict';

/**
 * Semantic Clustering — agrupa candidatos semanticamente EQUIVALENTES e recusa
 * fusão quando a equivalência não está provada.
 *
 * O problema que resolve: "online booking", "class booking", "book classes
 * online" e "mobile booking" são a MESMA capacidade e não podem inflar a
 * curva de novidade como quatro. O problema que ele NUNCA cria: fundir
 * "freeze", "cancel", "pause", "suspend" e "expire" — semânticas distintas de
 * ciclo de vida do contrato (`BENCHMARK_OVER_MERGE_REFUSED`, mesma política de
 * `normalizeFindingName`).
 *
 * Chave de cluster (determinística, por kind):
 *   1. se a política declara equivalência (termo casa via longest-match) → o
 *      `canonicalId` É a chave;
 *   2. senão, a forma estruturada `object.verb` (já em vocabulário canônico);
 *   3. senão, a assinatura de tokens significativos ordenados.
 *
 * Anti-over-merge (duro): candidatos cujos tokens carregam `exclusiveTokens`
 * de regras DIFERENTES da política nunca dividem o mesmo cluster. Quando a
 * assinatura genérica colidiria, o cluster é PARTIDO e a recusa é contada em
 * `overMergeRejected`.
 */

const { normalizeTerm, tokenize, NORMALIZATION_POLICY } = require('../benchmarkResearchSemantics');
const { VERB_CANONICAL_MAP, OBJECT_CANONICAL_MAP } = require('./semanticExtractor');

const STOPWORDS = Object.freeze([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'o', 'a', 'os', 'as',
  'um', 'uma', 'para', 'por', 'com', 'sem', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for',
  'and', 'or', 'with', 'your', 'you', 'seu', 'sua', 'seus', 'suas', 'from', 'online',
]);

/** exclusiveTokens → universo de tokens que NUNCA podem ser fundidos entre si. */
function exclusiveTokenUniverse(policy = NORMALIZATION_POLICY) {
  const universe = new Set();
  for (const rule of Array.isArray(policy.rules) ? policy.rules : []) {
    for (const token of Array.isArray(rule.exclusiveTokens) ? rule.exclusiveTokens : []) {
      const normalized = normalizeTerm(token);
      if (normalized) universe.add(normalized);
    }
  }
  return universe;
}

/** Tokens exclusivos presentes no candidato (frase contígua, como a política). */
function exclusiveTokensOf(text, universe) {
  const tokens = tokenize(text);
  const found = new Set();
  for (const exclusive of universe) {
    const exclusiveTokens = exclusive.split(' ').filter(Boolean);
    if (exclusiveTokens.length === 0 || tokens.length < exclusiveTokens.length) continue;
    for (let start = 0; start <= tokens.length - exclusiveTokens.length; start += 1) {
      if (exclusiveTokens.every((token, offset) => tokens[start + offset] === token)) {
        found.add(exclusive);
        break;
      }
    }
  }
  return [...found].sort();
}

/** Assinatura de tokens significativos, já mapeados ao vocabulário canônico. */
function tokenSignature(text) {
  return tokenize(text)
    .filter((token) => !STOPWORDS.includes(token))
    .map((token) => OBJECT_CANONICAL_MAP[token] || VERB_CANONICAL_MAP[token] || token)
    .sort()
    .join(' ');
}

/**
 * Chave de cluster de UM candidato. `canonicalId` declarado vence; depois a
 * forma estruturada; por fim a assinatura de tokens.
 */
function clusterKeyOf(candidate) {
  if (candidate.canonicalId) return `canonical:${candidate.kind}:${candidate.canonicalId}`;
  if (candidate.form) return `form:${candidate.kind}:${candidate.form}`;
  return `signature:${candidate.kind}:${tokenSignature(candidate.externalName)}`;
}

/**
 * Agrupa candidatos NORMALIZADOS em clusters de equivalência.
 *
 * @param {Array} candidates candidatos com `kind`, `externalName`, `form`,
 *   `canonicalId` (canonicalId aqui é o da POLÍTICA de normalização, já
 *   resolvido pela pipeline ou null)
 * @param {object} [policy]  política de normalização (default: config canônico)
 * @returns {{clusters: Array, overMergeRejected: number, assignments: Map}}
 */
function clusterCandidates(candidates, policy = NORMALIZATION_POLICY) {
  const universe = exclusiveTokenUniverse(policy);
  const buckets = new Map();
  let overMergeRejected = 0;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = clusterKeyOf(candidate);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }

  const clusters = [];
  for (const [key, members] of buckets.entries()) {
    // Anti-over-merge: dentro do bucket, partir por conjunto de exclusiveTokens.
    const byExclusive = new Map();
    for (const member of members) {
      const exclusive = exclusiveTokensOf(member.externalName, universe).join('|');
      if (!byExclusive.has(exclusive)) byExclusive.set(exclusive, []);
      byExclusive.get(exclusive).push(member);
    }
    if (byExclusive.size > 1) overMergeRejected += byExclusive.size - 1;
    for (const [exclusive, group] of [...byExclusive.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const representative = group[0];
      clusters.push({
        clusterId: `${key}${exclusive ? `#exclusive:${exclusive}` : ''}`,
        kind: representative.kind,
        canonicalId: representative.canonicalId || null,
        representativeName: representative.externalName,
        exclusiveTokens: exclusive ? exclusive.split('|') : [],
        members: group,
        size: group.length,
      });
    }
  }

  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  return { clusters, overMergeRejected };
}

module.exports = {
  STOPWORDS,
  exclusiveTokenUniverse,
  exclusiveTokensOf,
  tokenSignature,
  clusterKeyOf,
  clusterCandidates,
};
