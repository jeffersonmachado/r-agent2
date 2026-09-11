'use strict';

/**
 * circular-projection.js — classificação PURA de requisitos auto-referentes.
 *
 * Contexto (defeito reproduzido): o fixpoint de governança projeta
 * `governance/final-{proof,readiness,governance,consistency}*.json` A PARTIR do
 * estado do scorecard. Se um requisito do próprio scorecard reprovar porque um
 * desses relatórios "reporta NO_GO", o sistema trava no fixpoint espúrio:
 *
 *   reports NO_GO → dimensões falham → gate FAIL → reports NO_GO → ...
 *
 * O guard existia embutido no runner (`run-persisted-scorecard.js`) e dependia
 * de `requirement.code === 'MANDATORY_GATE_NO_GO'`. Só que o requisito
 * PERSISTIDO carrega o código da evidência agregada e o caminho do relatório em
 * `evidence[].path` — não em `requirement.code` / `requirement.validator`. Com
 * isso o guard nunca casava e TODOS os 41 blockers circulares derrubavam o run
 * (RAP-064 incluído), produzindo NO_GO permanente.
 *
 * Aqui a classificação é explícita e testável:
 *   - é CIRCULAR quando a falha é do tipo "artifact reporta NO_GO" E o
 *     artefato citado é um dos relatórios de projeção canônicos;
 *   - qualquer outro NO_GO (artifact real, gate real) NÃO é circular e continua
 *     reprovando. O guard reduz auto-referência — nunca responsabilidade.
 */

/** Relatórios cujo conteúdo é DERIVADO do scorecard que os avalia. */
const CIRCULAR_PROJECTION_REPORTS = Object.freeze([
  'governance/final-proof-report.json',
  'governance/final-readiness-report.json',
  'governance/final-governance-report.json',
  'governance/final-consistency-gate-report.json',
]);

/** Códigos que representam "um artefato obrigatório reportou NO_GO". */
const ARTIFACT_NO_GO_CODES = Object.freeze(['MANDATORY_GATE_NO_GO']);

const CIRCULAR_SET = new Set(CIRCULAR_PROJECTION_REPORTS);

const ARTIFACT_NO_GO_REASON = /^Artifact reporta NO_GO:/;

/** Caminhos citados por um requisito — em `validator` e/ou em cada evidência. */
function referencedPaths(requirement) {
  if (!requirement || typeof requirement !== 'object') return [];
  const paths = [];
  if (Array.isArray(requirement.validator)) paths.push(...requirement.validator);
  for (const item of Array.isArray(requirement.evidence) ? requirement.evidence : []) {
    if (item && typeof item.path === 'string') paths.push(item.path);
  }
  return paths.filter((value) => typeof value === 'string' && value.length > 0);
}

/** O requisito é uma falha do tipo "artefato reporta NO_GO"? */
function isArtifactNoGoRequirement(requirement) {
  if (!requirement || typeof requirement !== 'object') return false;
  if (ARTIFACT_NO_GO_CODES.includes(requirement.code)) return true;
  const reason = String(requirement.reason || '');
  if (ARTIFACT_NO_GO_REASON.test(reason)) return true;
  return (Array.isArray(requirement.evidence) ? requirement.evidence : [])
    .some((item) => item && ARTIFACT_NO_GO_CODES.includes(item.code));
}

/**
 * Requisito AUTO-REFERENTE: falha por NO_GO de um relatório que o próprio run
 * projeta. Só then é circular — exige as duas condições.
 */
function isCircularRequirement(requirement) {
  if (!isArtifactNoGoRequirement(requirement)) return false;
  return referencedPaths(requirement).some((path) => CIRCULAR_SET.has(path));
}

/**
 * Dimensão cujas ÚNICAS falhas são auto-referentes (ou que não tem falha
 * própria, apenas gaps/blockers derivados).
 */
function isCircularOnlyDimension(dimension) {
  const failures = ((dimension && dimension.requirements) || []).filter((requirement) => (
    requirement.mandatory !== false
    && requirement.status !== 'PASS'
    && !['NO_KNOWN_GAP', 'NO_OPEN_BLOCKER'].includes(requirement.category)
  ));
  if (failures.length === 0) return true; // só falhas derivadas (gap/blocker dos circulares)
  return failures.every(isCircularRequirement);
}

module.exports = {
  CIRCULAR_PROJECTION_REPORTS,
  ARTIFACT_NO_GO_CODES,
  referencedPaths,
  isArtifactNoGoRequirement,
  isCircularRequirement,
  isCircularOnlyDimension,
};
