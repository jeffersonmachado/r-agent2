'use strict';

/**
 * scorecard-phase-deferral.js — classificação de dimensões DEFERIDAS POR FASE.
 *
 * Contexto (defeito real encontrado na convergência do run
 * rap-governed-20260911113009846): o modelo de fases do RAP só permite 10/10
 * após o pacote ser construído e verificado. O `proof-engine` já reconhece isso
 * explicitamente — `packageValidation.deferred` vira `deferredGates`
 * ("PRE_PACKAGE / DEFERRED / PACKAGE_NOT_CREATED_YET") e NÃO vira gap. O
 * `seal-time-gate` também já reconhece dimensões de fase DELIVERED
 * (RAP-055/056).
 *
 * O scorecard, porém, tratava `DEFERRED` do artefato canônico do pacote
 * (`governance/package-validation-report.json`) como FALHA real em RAP-052
 * ("Package Manifest") e RAP-054 ("Semantic Certification × Package Integrity").
 * Efeito: em PRE_PACKAGE — quando o pacote comprovadamente ainda não existe —
 * essas duas dimensões ficavam abaixo de 10, o que tornava o gate
 * `master_scorecard = FAIL`, derrubava a decisão para NO_GO, e o NO_GO era
 * projetado nos relatórios auto-referentes (final-proof/final-readiness), que
 * por sua vez reprovavam as outras 27 dimensões. Um deadlock em que a única
 * falha real era "o pacote ainda não foi construído".
 *
 * O que este módulo faz: identifica a dimensão cuja ÚNICA falha é a deferral do
 * artefato do pacote. Isso é uma classificação de FASE, não um afrouxamento: a
 * dimensão continua abaixo de 10, o gate continua DEFERRED (nunca PASS), e o
 * gate de selagem NÃO herda esta tolerância — no selo, o pacote existe e precisa
 * PASSAR de verdade.
 */

/** Artefatos cuja ausência/atraso é inerente à fase PRE_PACKAGE. */
const PRE_PACKAGE_DEFERRED_ARTIFACTS = Object.freeze([
  'governance/package-validation-report.json',
]);

/** Categorias derivadas: por construção dependem do resultado do próprio scorecard. */
const DERIVED_CATEGORIES = Object.freeze(['NO_KNOWN_GAP', 'NO_OPEN_BLOCKER']);

function failureReasonText(requirement) {
  const fromRequirement = String(requirement.reason || '');
  const fromEvidence = (requirement.evidence || [])
    .map((entry) => `${entry.reason || ''} ${entry.code || ''}`)
    .join(' ');
  return `${fromRequirement} ${fromEvidence}`.toUpperCase();
}

function requirementArtifacts(requirement) {
  const paths = new Set(requirement.validator || []);
  for (const entry of requirement.evidence || []) {
    if (entry.path) paths.add(entry.path);
  }
  return paths;
}

/**
 * Verdadeiro quando o requisito falhou EXCLUSIVAMENTE porque o artefato do
 * pacote está DEFERRED — isto é, "ainda não avaliável", não "reprovado".
 */
function isDeferredPackageRequirement(requirement) {
  if (!requirement || requirement.status === 'PASS') return false;
  if (String(requirement.code) !== 'ARTIFACT_DID_NOT_PASS') return false;
  const artifacts = requirementArtifacts(requirement);
  const onPackageArtifact = PRE_PACKAGE_DEFERRED_ARTIFACTS.some((path) => artifacts.has(path));
  if (!onPackageArtifact) return false;
  return failureReasonText(requirement).includes('DEFERRED');
}

/**
 * Requisitos obrigatórios reprovados que NÃO são derivados (gap/blocker).
 * São esses que decidem se a dimensão é uma falha real.
 */
function substantiveFailures(dimension) {
  return (dimension.requirements || []).filter((requirement) => (
    requirement.mandatory !== false
    && requirement.status !== 'PASS'
    && !DERIVED_CATEGORIES.includes(requirement.category)
  ));
}

/**
 * Classifica UM requisito reprovado como tolerável em PRE_PACKAGE.
 *
 * `isCircularRequirement` (opcional) identifica falha auto-referente: o
 * requisito lê um relatório PROJETADO pelo próprio scorecard. Uma dimensão pode
 * acumular as duas naturezas de tolerância (ex.: RAP-054 falha no pacote
 * DEFERRED *e* no final-proof-report NO_GO, que é auto-referente) — por isso a
 * decisão é tomada por REQUISITO, não por dimensão.
 */
function classifySubstantiveFailure(requirement, options = {}) {
  if (isDeferredPackageRequirement(requirement)) return 'PRE_PACKAGE_DEFERRED';
  if (typeof options.isCircularRequirement === 'function' && options.isCircularRequirement(requirement)) {
    return 'CIRCULAR_PROJECTION';
  }
  return null;
}

/**
 * Dimensão cuja única falha substantiva é a deferral do pacote em PRE_PACKAGE.
 * (Mantida para uso direto; o classificador abaixo aceita tolerâncias compostas.)
 */
function isPrePackageDeferredDimension(dimension) {
  const failures = substantiveFailures(dimension);
  if (failures.length === 0) return false;
  return failures.every(isDeferredPackageRequirement);
}

/**
 * Classifica as dimensões abaixo de 10 e decide o status do gate de scorecard
 * em PRE_PACKAGE. `PASS` exige 10/10 real; qualquer abaixo de 10 que não seja
 * integralmente tolerável (fase DELIVERED, circular ou pacote deferido) torna o
 * gate FAIL.
 */
function classifyBelow10Dimensions(dimensions, options = {}) {
  const deliveredPhaseDimensions = options.deliveredPhaseDimensions || new Set();
  const isCircularOnly = typeof options.isCircularOnly === 'function' ? options.isCircularOnly : () => false;

  const below10 = (dimensions || []).filter((dimension) => dimension.score < 10);
  const classified = below10.map((dimension) => {
    if (deliveredPhaseDimensions.has(dimension.id)) return { id: dimension.id, kind: 'DELIVERED_PHASE' };
    if (isCircularOnly(dimension)) return { id: dimension.id, kind: 'CIRCULAR_PROJECTION' };

    const failures = substantiveFailures(dimension);
    const tolerances = failures.map((requirement) => classifySubstantiveFailure(requirement, options));
    if (failures.length > 0 && tolerances.every(Boolean)) {
      return { id: dimension.id, kind: [...new Set(tolerances)].join('+') };
    }
    return { id: dimension.id, kind: 'REAL_FAILURE' };
  });

  const realFailures = classified.filter((entry) => entry.kind === 'REAL_FAILURE');
  let status = 'FAIL';
  if (below10.length === 0) status = 'PASS';
  else if (realFailures.length === 0) status = 'DEFERRED';

  return {
    status,
    below10: below10.map((dimension) => dimension.id),
    classified,
    realFailures,
    deferred: classified.filter((entry) => entry.kind !== 'REAL_FAILURE'),
  };
}

module.exports = {
  PRE_PACKAGE_DEFERRED_ARTIFACTS,
  DERIVED_CATEGORIES,
  isDeferredPackageRequirement,
  substantiveFailures,
  isPrePackageDeferredDimension,
  classifySubstantiveFailure,
  classifyBelow10Dimensions,
};
