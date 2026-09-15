'use strict';

/**
 * independence — detecção de dependência corporativa entre candidatos.
 *
 * Diversidade falsa é o modo clássico de inflar uma amostra de mercado:
 * white-label do mesmo produto, fornecedores do mesmo grupo econômico,
 * suítes compartilhadas, produtos adquiridos. Duas observações do MESMO grupo
 * econômico efetivo são UMA observação para fins de diversidade.
 *
 * Lógica equivalente a `buildEffectiveGroupResolver`/`evaluateIndependence` de
 * `qa/benchmarks/benchmarkSufficiencyEngine.js` (motor puro, §29/§27/§43),
 * especializada para o registro de CANDIDATO (que não tem role/order de
 * sample): um clone herda o grupo do alvo declarado — receber um
 * `independenceGroup` próprio não o torna observação independente.
 *
 * Sinais de dependência (declarados em metadata ou confirmados por evidência):
 *   - cloneOf / baseProduct     → white-label, mesmo produto base;
 *   - independenceGroup igual   → mesmo grupo econômico declarado;
 *   - metadata.acquiredBy       → aquisição (grupo = adquirente);
 *   - metadata.parentGroup      → grupo controlador;
 *   - metadata.sharedSuite      → suíte compartilhada (ex.: "daxko-suite").
 *
 * Este módulo é PURO (zero I/O).
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function keyOf(candidate) {
  return String(candidate?.candidateKey || candidate?.id || candidate?.name || '');
}

/** Grupo econômico DECLARADO (antes de colapsar clones). */
function declaredGroupOf(candidate) {
  const metadata = candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  return String(
    candidate?.independenceGroup
    || metadata.acquiredBy
    || metadata.parentGroup
    || metadata.sharedSuite
    || keyOf(candidate),
  );
}

/**
 * Grupo econômico EFETIVO de um candidato. Um clone/white-label herda o grupo
 * do alvo declarado (recursivo, com proteção contra ciclos de declaração).
 */
function buildEffectiveGroupResolver(candidates) {
  const byKey = new Map(list(candidates).map((c) => [keyOf(c), c]));
  const groupByKey = new Map(list(candidates).map((c) => [keyOf(c), declaredGroupOf(c)]));

  return (candidate) => {
    const visited = new Set();
    let current = candidate;
    while (current) {
      const key = keyOf(current);
      if (visited.has(key)) break; // ciclo de declaração: para no grupo declarado
      visited.add(key);
      const parentKey = isNonEmptyString(current.cloneOf) ? String(current.cloneOf)
        : (isNonEmptyString(current.baseProduct) ? String(current.baseProduct) : null);
      if (!parentKey) break;
      const parent = byKey.get(parentKey);
      // Alvo fora do universo conhecido: o grupo efetivo é o PRÓPRIO alvo
      // declarado (equivalente a `cloneOf || baseProduct || group` do engine).
      if (!parent) return groupByKey.get(parentKey) || parentKey;
      current = parent;
    }
    const key = keyOf(current);
    return groupByKey.get(key) || String(key);
  };
}

/** Grupos econômicos efetivos distintos de uma coleção, colapsando clones. */
function effectiveGroupsOf(candidates) {
  const resolve = buildEffectiveGroupResolver(candidates);
  return new Set(list(candidates).map((c) => resolve(c)));
}

/**
 * Relatório de independência do universo de candidatos.
 *
 * @returns {{
 *   totalCandidates: number,
 *   independentGroups: string[],
 *   independentCount: number,
 *   independentShare: number|null,
 *   clones: Array<{candidateKey: string, cloneOf: string}>,
 *   sharedGroups: Array<{group: string, members: string[]}>,
 * }}
 */
function independenceReport(candidates) {
  const all = list(candidates);
  const resolve = buildEffectiveGroupResolver(all);
  const byGroup = new Map();
  const clones = [];

  for (const candidate of all) {
    const group = resolve(candidate);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(keyOf(candidate));
    if (isNonEmptyString(candidate?.cloneOf) || isNonEmptyString(candidate?.baseProduct)) {
      clones.push({ candidateKey: keyOf(candidate), cloneOf: String(candidate.cloneOf || candidate.baseProduct) });
    }
  }

  const independentGroups = [...byGroup.keys()].sort();
  return {
    totalCandidates: all.length,
    independentGroups,
    independentCount: independentGroups.length,
    independentShare: all.length > 0 ? independentGroups.length / all.length : null,
    clones,
    sharedGroups: [...byGroup.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([group, members]) => ({ group, members: [...members].sort() })),
  };
}

/**
 * Veredito de diversidade real: candidatos CLONES nunca contam como diversidade.
 *
 * @returns {{status: 'PASS'|'FAIL', violations: Array, report: object}}
 */
function evaluateDiversityIndependence(candidates, { minimumIndependentGroups = null, minimumIndependentShare = null } = {}) {
  const report = independenceReport(candidates);
  const violations = [];
  const minGroups = Number(minimumIndependentGroups);
  if (Number.isFinite(minGroups) && report.independentCount < minGroups) {
    violations.push({ reason: 'independent_groups_below_minimum', distinct: report.independentCount, required: minGroups });
  }
  const minShare = Number(minimumIndependentShare);
  if (Number.isFinite(minShare) && report.independentShare !== null && report.independentShare < minShare) {
    violations.push({ reason: 'independent_share_below_minimum', share: report.independentShare, required: minShare });
  }
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations, report };
}

module.exports = {
  declaredGroupOf,
  buildEffectiveGroupResolver,
  effectiveGroupsOf,
  independenceReport,
  evaluateDiversityIndependence,
};
