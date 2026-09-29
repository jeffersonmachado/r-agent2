'use strict';

/**
 * engine/engineeringMission/bugFinding/selfModification.js
 *
 * PROTEÇÃO DE SELF-MODIFICATION. Um bug que afeta o Engineer Router, o selo V2, aprovação, policy,
 * lease/fencing, governança, anti-greenwashing ou o pipeline de release é um bug no sistema que
 * ESTÁ JULGANDO o sistema. Corrigi-lo autonomamente com autoaprovação permitiria que o próprio
 * corrigido enfraquecesse o critério que o reprovava.
 *
 * Regra: detectado ⇒ `selfModification=true`, `humanApprovalRequired=true` e, por padrão,
 * `autoApprovalForbidden=true` (BUG-19, BUG-20). O aval só pode vir de uma política explícita que
 * AUTORIZE autoaprovação para self-modification de severidade não crítica — nunca por omissão.
 *
 * Módulo PURO.
 */

const {
  SELF_MODIFICATION_PATH_PREFIXES,
  SELF_MODIFICATION_SUBSYSTEMS,
  SELF_MODIFICATION_CATEGORIES,
} = require('./constants');
const { SEVERITY_RANK } = require('./constants');

/** Normaliza um caminho para comparação por prefixo (barras, sem `./`). */
function normalizePath(p) {
  return String(p || '')
    .replace(/\\+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

/** Caminhos que caracterizam self-modification, com o prefixo que casou. */
function matchPaths(paths = []) {
  const list = Array.isArray(paths) ? paths : [];
  const matches = [];
  for (const raw of list) {
    const path = normalizePath(raw);
    if (path === '') continue;
    const prefix = SELF_MODIFICATION_PATH_PREFIXES.find((candidate) => path === candidate || path.startsWith(candidate));
    if (prefix) matches.push({ path, prefix });
  }
  return matches;
}

/**
 * O QUE CONTA COMO SELF-MODIFICATION (e o que NÃO conta).
 *
 * O risco que esta proteção existe para cobrir é UM só: o fix alterar as regras que julgam o
 * sistema. Três evidências o caracterizam, e a precisão importa nos dois sentidos — um detector
 * excessivo bloqueia correções legítimas e um detector frouxo deixa o sistema se auto-afrouxar:
 *
 *   1. CAMINHOS tocados (evidência mais forte): o patch mexe em `governance/`, `scripts/governance/`,
 *      `pipeline/`, router/missão, lease/fencing, policy, release, anti-greenwashing.
 *   2. SUBSISTEMA que É a própria maquinaria de julgamento (POLICY/GOVERNANCE/ANTI_GREENWASHING/
 *      APPROVAL/LEASE_FENCING/RELEASE_PIPELINE/QA_GATE/ENGINEER_ROUTER/ENGINEERING_MISSION) —
 *      porém apenas quando NÃO há caminhos declarados: com caminhos explícitos, quem decide é o
 *      raio de impacto REAL do fix, não onde o sintoma apareceu.
 *   3. CATEGORIA GOVERNANCE: um bug de governança é, por definição, nas regras de julgamento.
 *
 * DELIBERADAMENTE FORA: SECURITY e CONCURRENCY não caracterizam self-modification por si sós — a
 * missão exige revisor de segurança dedicado e revisor independente para esses casos, o que é um
 * controle adequado e NÃO deve impedir a correção autônoma. Já um finding cujo fix toca lease/
 * fencing (caminho ou subsistema) É self-modification, porque ali vive a posse e o fence.
 */
function isSensitiveSubsystem(subsystem) {
  return SELF_MODIFICATION_SUBSYSTEMS.includes(subsystem);
}

/**
 * Avalia self-modification.
 *
 * @param {object} params
 * @param {string[]} [params.paths]      caminhos que o FIX vai tocar (raio de impacto real)
 * @param {string[]} [params.subsystems] subsistemas afetados declarados no finding
 * @param {string}   [params.category]   categoria do finding
 * @param {string}   [params.severity]   severidade derivada
 * @param {object}   [params.policy]     política efetiva (autoridade única, nunca default amplo)
 */
function assessSelfModification({ paths = [], subsystems = [], category = null, severity = null, policy = null } = {}) {
  const declaredPaths = (Array.isArray(paths) ? paths : []).map(normalizePath).filter((p) => p !== '');
  const pathMatches = matchPaths(declaredPaths);
  const subsystemList = (Array.isArray(subsystems) ? subsystems : []).map((s) => String(s || '').toUpperCase());
  const subsystemMatches = subsystemList.filter(isSensitiveSubsystem);
  const categoryMatch = SELF_MODIFICATION_CATEGORIES.includes(String(category || '').toUpperCase());

  const selfModification = pathMatches.length > 0
    || categoryMatch
    || (declaredPaths.length === 0 && subsystemMatches.length > 0);

  // AUTOAPROVAÇÃO: proibida por padrão. A política pode autorizar apenas quando
  // `allowSelfModificationAutoApproval === true` E a severidade NÃO for HIGH/CRITICAL.
  const criticalSeverity = SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH;
  const policyAllows = policy && policy.allowSelfModificationAutoApproval === true;
  const autoApprovalForbidden = !(policyAllows && !criticalSeverity);

  return {
    selfModification,
    humanApprovalRequired: selfModification && autoApprovalForbidden,
    autoApprovalForbidden: selfModification ? autoApprovalForbidden : false,
    criticalSeverity,
    matched: {
      paths: pathMatches,
      subsystems: declaredPaths.length === 0 ? subsystemMatches : [],
      subsystemsWithoutImpact: declaredPaths.length > 0 ? subsystemMatches : [],
      category: categoryMatch ? String(category).toUpperCase() : null,
    },
    rationale: selfModification
      ? 'finding afeta as próprias regras de julgamento (router/governança/lease/policy/release) — autoaprovação não é autoridade legítima'
      : 'finding não toca as regras que julgam o sistema',
  };
}

/**
 * Baseline de REGRAS antes de uma missão de self-engineering. Se o fix alterar o próprio critério,
 * a alteração precisa ser EXPLÍCITA e comparável — nunca silenciosa.
 */
function captureRuleBaseline({ mandatoryGates = [], testManifest = [], thresholds = {}, policies = {}, requirements = [] } = {}) {
  return {
    capturedAt: null, // preenchido pelo chamador (engine é puro)
    mandatoryGates: [...mandatoryGates].sort(),
    testManifest: [...testManifest].sort(),
    thresholds: { ...thresholds },
    policies: { ...policies },
    requirements: [...requirements].sort(),
  };
}

/** Diferença entre baseline e estado atual das regras, nas duas direções. */
function diffRuleBaseline(baseline = {}, current = {}) {
  const diffList = (before = [], after = []) => ({
    removed: (Array.isArray(before) ? before : []).filter((x) => !(Array.isArray(after) ? after : []).includes(x)),
    added: (Array.isArray(after) ? after : []).filter((x) => !(Array.isArray(before) ? before : []).includes(x)),
  });
  const thresholdChanges = [];
  const before = baseline.thresholds || {};
  const after = current.thresholds || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) thresholdChanges.push({ key, from: before[key], to: after[key] });
  }
  return {
    mandatoryGates: diffList(baseline.mandatoryGates, current.mandatoryGates),
    testManifest: diffList(baseline.testManifest, current.testManifest),
    requirements: diffList(baseline.requirements, current.requirements),
    thresholdChanges,
    changed: Boolean(
      diffList(baseline.mandatoryGates, current.mandatoryGates).removed.length
      || diffList(baseline.testManifest, current.testManifest).removed.length
      || diffList(baseline.requirements, current.requirements).removed.length
      || thresholdChanges.some((c) => typeof c.to === 'number' && typeof c.from === 'number' && c.to < c.from),
    ),
  };
}

module.exports = {
  normalizePath,
  matchPaths,
  assessSelfModification,
  captureRuleBaseline,
  diffRuleBaseline,
};
