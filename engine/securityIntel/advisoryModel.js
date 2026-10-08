'use strict';

/**
 * advisoryModel — normalização e avaliação de advisories de vulnerabilidade.
 *
 * Módulo PURO. Normaliza registros OSV (o formato-ponte entre NVD, GHSA,
 * PyPA e os avisos de distro) para um formato canônico e decide se um
 * componente é afetado.
 *
 * REGRA DE HONESTIDADE (a razão de existir deste módulo):
 *   - `matchesComponent` devolve `true`, `false` ou `null`.
 *   - `null` significa DESCONHECIDO (versão não comparável, ecossistema não
 *     mapeado, faixa ambígua). `null` NUNCA é tratado como "não afetado".
 *   - Advisory retirado (`withdrawn`) nunca gera achado.
 *   - Advisory sem faixa e sem lista de versões é INCONCLUSIVO, não "seguro".
 */

const { isVersionInOsvRange, normalizeEcosystem } = require('./versionCore');
const { normalizeName } = require('./componentIdentity');
const { baseScore, severityFromScore } = require('./cvss');

const SEVERITY_ORDER = Object.freeze(['INFORMATIONAL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Ecossistemas OSV que sabemos comparar; qualquer outro é DESCONHECIDO. */
const SUPPORTED_ECOSYSTEMS = Object.freeze(new Set(['npm', 'PyPI', 'pypi', 'Docker', 'docker']));

/**
 * Normaliza a entrada `severity` do OSV, que pode ser
 * `[{type:'CVSS_V3', score:'CVSS:3.1/...'}]`, `[{type:'CVSS_V3', score:'9.8'}]`
 * ou `[{type:'Ubuntu', score:'High'}]`.
 *
 * Defeito corrigido (medido 2026-10-08): o GitHub Advisory Database publica o
 * score como VETOR. Antes, só número era aceito, então todo achado com vetor
 * caía para a severidade assumida (MEDIUM) — um CRITICAL/HIGH não bloqueava o
 * Release Security Gate. Subestimar severidade é a pior falha possível num gate
 * de segurança. Agora o vetor é convertido pelo cálculo oficial (módulo `cvss`).
 */
function normalizeSeverity(entries) {
  const result = { cvssVector: null, cvssScore: null, declaredSeverity: null, raw: [] };
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const type = String(entry.type || '');
    const score = entry.score === undefined || entry.score === null ? null : String(entry.score);
    result.raw.push({ type, score });
    if (type.startsWith('CVSS_V3') && score) {
      const numeric = Number(score);
      if (!Number.isNaN(numeric) && numeric > 0 && numeric <= 10) {
        result.cvssScore = numeric;
      } else {
        // Score veio como VETOR: converte para a base oficial.
        result.cvssVector = score;
        const computed = baseScore(score);
        if (computed !== null && computed > 0) result.cvssScore = computed;
      }
    } else if (!type.startsWith('CVSS') && score && /^[A-Z]+$/i.test(score)) {
      const upper = score.toUpperCase();
      if (SEVERITY_ORDER.includes(upper)) result.declaredSeverity = upper;
    }
  }
  // Sem score da fonte, a severidade derivada do vetor entra como declarada —
  // sempre rastreável a um cálculo publicado, nunca a um chute.
  if (!result.declaredSeverity && result.cvssScore !== null) {
    result.declaredSeverity = severityFromScore(result.cvssScore);
    result.declaredSeveritySource = 'computed_from_vector';
  }
  return result;
}

/**
 * Normaliza um registro OSV para o formato canônico interno.
 * @returns {object|null} `null` se não houver identificador (registro inútil).
 */
function normalizeAdvisory(raw, { source = 'osv', sourceUrl = null, fetchedAt = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || (Array.isArray(raw.aliases) && raw.aliases[0]) || null;
  if (!id) return null;

  const severity = normalizeSeverity(raw.severity);
  const affected = [];
  for (const entry of Array.isArray(raw.affected) ? raw.affected : []) {
    if (!entry || typeof entry !== 'object') continue;
    const pkg = entry.package || {};
    if (!pkg.name) continue;
    affected.push({
      ecosystem: pkg.ecosystem || null,
      ecosystemCanonical: normalizeEcosystem(pkg.ecosystem),
      name: pkg.name,
      normalizedName: normalizeName(pkg.name, pkg.ecosystem),
      purl: pkg.purl || null,
      ranges: Array.isArray(entry.ranges)
        ? entry.ranges.map((range) => ({
          type: range.type || null,
          events: Array.isArray(range.events) ? range.events : [],
          repo: range.repo || null,
        }))
        : [],
      versions: Array.isArray(entry.versions) ? entry.versions.map(String) : [],
      severity: normalizeSeverity(entry.severity),
      databaseSpecific: entry.database_specific || null,
      ecosystemSpecific: entry.ecosystem_specific || null,
    });
  }

  return {
    id,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    summary: raw.summary || null,
    details: raw.details || null,
    published: raw.published || null,
    modified: raw.modified || null,
    withdrawn: raw.withdrawn || null,
    severity,
    affected,
    references: Array.isArray(raw.references)
      ? raw.references.map((reference) => ({
        type: reference.type || null,
        url: reference.url || null,
      })).filter((reference) => reference.url)
      : [],
    databaseSpecific: raw.database_specific || null,
    source,
    sourceUrl,
    fetchedAt,
  };
}

/** Advisory retirado não gera achado (mas permanece no histórico). */
function isWithdrawn(advisory) {
  return Boolean(advisory && advisory.withdrawn);
}

/** Versões corrigidas conhecidas (`fixed`/`last_affected`/`limit`). */
function fixedVersionsOf(affectedEntry) {
  const fixed = new Set();
  for (const range of affectedEntry.ranges || []) {
    for (const event of range.events || []) {
      if (event && event.fixed) fixed.add(String(event.fixed));
    }
  }
  return [...fixed].sort();
}

/**
 * Avalia se um componente é afetado por um advisory.
 *
 * @returns {{matched: boolean|null, applicability: string, reason: string,
 *            affectedEntry: object|null, fixedVersions: string[]}}
 *  - `applicability`: 'CONFIRMED_APPLICABLE' | 'NOT_AFFECTED' | 'UNKNOWN'
 */
function matchesComponent(advisory, component) {
  const unknown = (reason, affectedEntry = null) => ({
    matched: null,
    applicability: 'UNKNOWN',
    reason,
    affectedEntry,
    fixedVersions: affectedEntry ? fixedVersionsOf(affectedEntry) : [],
  });

  if (!advisory || !component) return unknown('advisory_or_component_missing');
  if (isWithdrawn(advisory)) return unknown('advisory_withdrawn');

  const componentEcosystem = normalizeEcosystem(component.ecosystem);
  const componentName = normalizeName(component.name, component.ecosystem);

  const candidates = (advisory.affected || []).filter((entry) => {
    if (!entry.ecosystem) return false; // sem ecossistema não é comparável
    const entryEcosystem = normalizeEcosystem(entry.ecosystem);
    if (entryEcosystem !== componentEcosystem) return false;
    return entry.normalizedName === componentName;
  });

  if (candidates.length === 0) {
    // Pode ser "não afetado" legítimo OU não conseguir comparar. Só é
    // NOT_AFFECTED se o ecossistema do advisory é suportado (ou seja, sabemos
    // comparar) — caso contrário é DESCONHECIDO.
    const ecosystemsKnown = (advisory.affected || [])
      .every((entry) => entry.ecosystem && SUPPORTED_ECOSYSTEMS.has(entry.ecosystem));
    if ((advisory.affected || []).length > 0 && ecosystemsKnown) {
      return {
        matched: false,
        applicability: 'NOT_AFFECTED',
        reason: 'package_not_listed_for_ecosystem',
        affectedEntry: null,
        fixedVersions: [],
      };
    }
    return unknown('ecosystem_or_package_not_comparable');
  }

  if (!component.version || component.version === 'unknown') {
    return unknown('component_version_unknown', candidates[0]);
  }
  if (!SUPPORTED_ECOSYSTEMS.has(component.ecosystem) && !['npm', 'pypi'].includes(componentEcosystem)) {
    return unknown('component_ecosystem_unsupported_for_comparison', candidates[0]);
  }

  let sawUnknown = false;
  for (const entry of candidates) {
    // 1) Lista explícita de versões afetadas (comparação exata).
    if (entry.versions.length > 0) {
      const exact = entry.versions.some((version) => version === String(component.version));
      if (exact) {
        return {
          matched: true,
          applicability: 'CONFIRMED_APPLICABLE',
          reason: 'version_listed_as_affected',
          affectedEntry: entry,
          fixedVersions: fixedVersionsOf(entry),
        };
      }
    }
    // 2) Faixas (introduced/fixed/last_affected/limit).
    if (entry.ranges.length > 0) {
      let rangeUnknown = false;
      for (const range of entry.ranges) {
        if (range.type === 'GIT') continue; // faixa de commit: não é version comparison
        const result = isVersionInOsvRange(component.version, range, { ecosystem: componentEcosystem });
        if (result === true) {
          return {
            matched: true,
            applicability: 'CONFIRMED_APPLICABLE',
            reason: 'version_within_affected_range',
            affectedEntry: entry,
            fixedVersions: fixedVersionsOf(entry),
          };
        }
        if (result === null) rangeUnknown = true;
      }
      if (!rangeUnknown && entry.versions.length === 0) continue; // faixa avaliada: não afetado por este entry
      if (rangeUnknown) sawUnknown = true;
    }
    // Sem faixa e sem lista: inconclusivo.
    if (entry.ranges.length === 0 && entry.versions.length === 0) sawUnknown = true;
  }

  if (sawUnknown) return unknown('range_not_comparable', candidates[0]);
  return {
    matched: false,
    applicability: 'NOT_AFFECTED',
    reason: 'version_outside_affected_ranges',
    affectedEntry: candidates[0],
    fixedVersions: fixedVersionsOf(candidates[0]),
  };
}

/** Mapa índice `ecosystem:name-normalizado` → advisories (consulta O(1)). */
function indexAdvisoriesByPackage(advisories = []) {
  const index = new Map();
  for (const advisory of advisories) {
    for (const entry of advisory.affected || []) {
      if (!entry.ecosystem || !entry.normalizedName) continue;
      const key = `${normalizeEcosystem(entry.ecosystem)}:${entry.normalizedName}`;
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).includes(advisory)) index.get(key).push(advisory);
    }
  }
  return index;
}

function packageKeyOf(component) {
  return `${normalizeEcosystem(component.ecosystem)}:${normalizeName(component.name, component.ecosystem)}`;
}

module.exports = {
  SEVERITY_ORDER,
  SUPPORTED_ECOSYSTEMS,
  normalizeSeverity,
  normalizeAdvisory,
  isWithdrawn,
  fixedVersionsOf,
  matchesComponent,
  indexAdvisoriesByPackage,
  packageKeyOf,
};
