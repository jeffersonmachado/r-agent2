'use strict';

/**
 * release-phase-policy.js — POLÍTICA de fase do release: quem exige qual fase.
 *
 * MOTIVAÇÃO (TAREFA 49/50 — eliminar a dupla autoridade legada)
 * O pipeline de release acumulou tolerâncias que reconheciam "o artefato ainda
 * não existe" por conta própria: `SEAL_PENDING`, `PASS_WITH_DEFERRED_PACKAGE_GATE`,
 * `scorecard-phase-deferral` e a lista HARDCODED `DELIVERED_PHASE_DIMS`
 * (`RAP-055`/`RAP-056`). Cada uma era uma autoridade PARALELA à máquina de
 * estados — podiam divergir dela em silêncio.
 *
 * Este módulo é a única declaração de política:
 *   - cada GATE do DAG tem `requiredPhase` (fonte única: `release-dag.js`);
 *   - cada DIMENSÃO do scorecard cuja mensurabilidade depende de fase declara
 *     sua `requiredPhase` aqui (nunca numa lista solta de consumidor);
 *   - a tolerância legada ("DEFERRED", "PENDING") é RESOLVIDA por
 *     `evaluateGate`/`checkPendingPastDue`: antes da fase é
 *     `PENDING_PHASE` (tolerável); na fase ou depois é `PENDING_PHASE_PAST_DUE`
 *     (FAIL). Não existe terceiro estado.
 *
 * Os rótulos históricos (`SEAL_PENDING`, `PASS_WITH_DEFERRED_PACKAGE_GATE`)
 * continuam existindo como PROJEÇÃO do status do gate — ver
 * `sealDecisionFromGateStatus` / `deferredDecisionForPhase`. Eles deixam de ser
 * autoridade: quem decide é a fase.
 *
 * Módulo PURO (sem fs/rede/relógio).
 */

const { RELEASE_DAG_NODES } = require('./release-dag');
const {
  GATE_STATUS,
  RELEASE_CODES,
  ReleaseStateError,
  evaluateGate,
  checkPendingPastDue,
  phaseAtLeast,
  isKnownPhase,
} = require('./release-state-machine');

/** Gate cujo output é o PACOTE validado (manifest/estrutura). */
const PACKAGE_GATE_ID = 'candidate_manifest';

/** Fase default quando o chamador legado não declara a fase corrente. */
const LEGACY_DEFAULT_PHASE = 'PRE_PACKAGE';

/** Rótulo histórico do estado DEFERRED de pacote (projeção de PENDING_PHASE). */
const DEFERRED_PACKAGE_DECISION = 'PASS_WITH_DEFERRED_PACKAGE_GATE';

/** `requiredPhase` por gate — derivada do DAG, nunca re-digitada. */
const RELEASE_GATE_PHASES = Object.freeze(
  Object.fromEntries(RELEASE_DAG_NODES.map((gate) => [gate.id, gate.requiredPhase])),
);

/**
 * Dimensões do scorecard cuja evidência só existe a partir de uma fase.
 * Declaração ÚNICA: `seal-time-gate`, `run-persisted-scorecard` e o runner de
 * fases leem daqui (antes cada um mantinha a própria cópia).
 */
const SCORECARD_DIMENSION_PHASES = Object.freeze({
  // Dimensões do artefato PACOTE (manifest/estrutura/integridade).
  'RAP-052': 'CANDIDATE_VALIDATED',
  'RAP-054': 'CANDIDATE_VALIDATED',
  // Dimensões que só são mensuráveis contra o artefato ENTREGUE.
  'RAP-055': 'DELIVERED',
  'RAP-056': 'DELIVERED',
});

/** Rótulos legados → status de gate. A string nunca é autoridade. */
const SEAL_DECISION_BY_GATE_STATUS = Object.freeze({
  [GATE_STATUS.PASS]: 'SEAL_GO',
  [GATE_STATUS.PENDING_PHASE]: 'SEAL_PENDING',
  [GATE_STATUS.FAIL]: 'SEAL_NO_GO',
});

/**
 * DINSTINÇÃO PAYLOAD vs ENVELOPE (TAREFA 58/59).
 *
 * O mesmo caminho `governance/*.json` carrega relatórios de fases DIFERENTES:
 * um relatório produzido ANTES do pacote (PRE_PACKAGE) NÃO é o relatório FINAL
 * do envelope. Sem lane explícita, um consumidor pode ler o snapshot pré-pack e
 * tratá-lo como decisão final. `phaseLane` é a única classificação autorizada.
 */
const PAYLOAD_LANE = 'PAYLOAD';
const ENVELOPE_LANE = 'ENVELOPE';

const RELEASE_PHASE_LANES = Object.freeze({
  SOURCE_VALIDATED: PAYLOAD_LANE,
  PRE_PACKAGE: PAYLOAD_LANE,
  CANDIDATE_BUILT: PAYLOAD_LANE,
  CANDIDATE_VALIDATED: PAYLOAD_LANE,
  SEALED: PAYLOAD_LANE,
  DELIVERED: PAYLOAD_LANE,
  FINAL_GOVERNANCE: ENVELOPE_LANE,
  PUBLISHED_VERIFIED: ENVELOPE_LANE,
});

function phaseLane(phase) {
  const lane = RELEASE_PHASE_LANES[phase];
  if (!lane) {
    throw new ReleaseStateError(RELEASE_CODES.UNKNOWN_PHASE, `fase sem lane declarada: ${phase}`, { phase });
  }
  return lane;
}

function isEnvelopePhase(phase) {
  return phaseLane(phase) === ENVELOPE_LANE;
}

/**
 * Um relatório/artefato de lane PAYLOAD nunca pode ser consumido como prova
 * FINAL do envelope. Divergência = erro de consumo, não aviso.
 */
function assertLaneMatches({ artifactLane, currentPhase } = {}) {
  const expected = phaseLane(currentPhase);
  if (artifactLane !== expected) {
    throw new ReleaseStateError(
      RELEASE_CODES.PHASE_ORDER_VIOLATION,
      `artefato de lane ${artifactLane} não pode compor a fase ${currentPhase} (lane ${expected})`,
      { artifactLane, currentPhase, expected },
    );
  }
  return true;
}

function gateRequiredPhase(gateId) {
  const phase = RELEASE_GATE_PHASES[gateId];
  if (!isKnownPhase(phase)) {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_REQUIRED_PHASE_MISSING,
      `gate ${gateId} não declara requiredPhase na política de fase`,
      { gateId },
    );
  }
  return phase;
}

function dimensionRequiredPhase(dimensionId) {
  return SCORECARD_DIMENSION_PHASES[dimensionId] || null;
}

/** Dimensões cuja fase exigida é DELIVERED (substitui a lista hardcoded). */
function deliveredPhaseDimensions() {
  return new Set(
    Object.entries(SCORECARD_DIMENSION_PHASES)
      .filter(([, phase]) => phase === 'DELIVERED')
      .map(([id]) => id),
  );
}

/**
 * Resolve a tolerância de fase de um gate.
 *
 * Duas respostas possíveis, nunca três:
 *   - `PENDING_PHASE` (tolerável): a fase exigida ainda não foi alcançada;
 *   - `FAIL` (`PENDING_PHASE_PAST_DUE`): a fase foi alcançada e o output do gate
 *     nunca foi produzido.
 *
 * `evaluate()` é opcional: quando fornecido, é chamado SOMENTE se a fase já foi
 * alcançada (um gate de fase futura não pode ser julgado por conteúdo).
 */
function resolveGatePhase({ gateId, currentPhase = LEGACY_DEFAULT_PHASE, evaluate = null, reason = null } = {}) {
  const requiredPhase = gateRequiredPhase(gateId);
  if (!isKnownPhase(currentPhase)) {
    throw new ReleaseStateError(RELEASE_CODES.UNKNOWN_PHASE, `fase corrente desconhecida: ${currentPhase}`, { currentPhase });
  }

  // Sem avaliador não há julgamento de conteúdo: a única pergunta respondível é
  // "a fase exigida já foi alcançada?". Antes dela = PENDING_PHASE (tolerável);
  // nela ou depois = PENDING_PHASE_PAST_DUE (FAIL) — nunca um PENDING eterno.
  if (typeof evaluate !== 'function') {
    if (!phaseAtLeast(currentPhase, requiredPhase)) {
      return Object.freeze({
        gateId,
        status: GATE_STATUS.PENDING_PHASE,
        code: RELEASE_CODES.PENDING_PHASE,
        requiredPhase,
        currentPhase,
        reason: reason || `gate ${gateId} só é avaliável em ${requiredPhase}`,
      });
    }
    const pastDue = checkPendingPastDue({ gateId, requiredPhase, currentPhase, status: GATE_STATUS.PENDING_PHASE });
    return Object.freeze({
      gateId,
      status: GATE_STATUS.FAIL,
      code: pastDue.code,
      requiredPhase,
      currentPhase,
      reason: pastDue.reason,
    });
  }

  return evaluateGate({ gateId, requiredPhase, currentPhase, reason, evaluate });
}

/**
 * A partir de QUAL fase a tolerância de pacote DEFERRED deixa de ser legítima?
 * O package gate declara isso; não há lista paralela.
 */
function packageDeferralDeadlinePhase() {
  return gateRequiredPhase(PACKAGE_GATE_ID);
}

/**
 * `PASS_WITH_DEFERRED_PACKAGE_GATE` só é um rótulo HONESTO enquanto o gate do
 * pacote estiver `PENDING_PHASE`. Alcançada a fase, este atalho não promove
 * nada: devolve `NO_GO` (fail-closed). Um resultado `GO` exige a avaliação REAL
 * do gate (`resolveGatePhase` com `evaluate`), nunca esta projeção.
 */
function deferredDecisionForPhase({ currentPhase = LEGACY_DEFAULT_PHASE, semanticGatesPass = true } = {}) {
  if (!semanticGatesPass) return 'NO_GO';
  const gate = resolveGatePhase({ gateId: PACKAGE_GATE_ID, currentPhase });
  if (gate.status === GATE_STATUS.PENDING_PHASE) return DEFERRED_PACKAGE_DECISION;
  return 'NO_GO';
}

function isDeferredDecisionAllowed({ currentPhase = LEGACY_DEFAULT_PHASE } = {}) {
  return resolveGatePhase({ gateId: PACKAGE_GATE_ID, currentPhase }).status === GATE_STATUS.PENDING_PHASE;
}

/** Projeção do status do gate para o vocabulário legado de selagem. */
function sealDecisionFromGateStatus(status) {
  const decision = SEAL_DECISION_BY_GATE_STATUS[status];
  if (!decision) {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_EVALUATION_MISSING,
      `status de gate inválido para selagem: ${JSON.stringify(status)}`,
      { status },
    );
  }
  return decision;
}

/** Projeção inversa: o rótulo legado volta a ser status de gate (equivalência). */
function gateStatusFromSealDecision(decision) {
  const entry = Object.entries(SEAL_DECISION_BY_GATE_STATUS).find(([, value]) => value === decision);
  if (!entry) {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_EVALUATION_MISSING,
      `decisão de selagem desconhecida: ${JSON.stringify(decision)}`,
      { decision },
    );
  }
  return entry[0];
}

/**
 * Uma dimensão DEFERRED do scorecard é tolerável apenas enquanto a fase exigida
 * pela dimensão não foi alcançada. `currentPhase` default = PRE_PACKAGE (o
 * chamador legado que não declara fase continua vendo o comportamento pré-pack).
 */
function dimensionPhaseTolerance({ dimensionId, currentPhase = LEGACY_DEFAULT_PHASE } = {}) {
  const requiredPhase = dimensionRequiredPhase(dimensionId);
  if (!requiredPhase) {
    return Object.freeze({ dimensionId, requiredPhase: null, tolerated: false, status: GATE_STATUS.FAIL, code: null, reason: 'dimensão sem fase declarada' });
  }
  if (!phaseAtLeast(currentPhase, requiredPhase)) {
    return Object.freeze({
      dimensionId,
      requiredPhase,
      tolerated: true,
      status: GATE_STATUS.PENDING_PHASE,
      code: RELEASE_CODES.PENDING_PHASE,
      reason: `dimensão ${dimensionId} só é mensurável em ${requiredPhase}`,
    });
  }
  return Object.freeze({
    dimensionId,
    requiredPhase,
    tolerated: false,
    status: GATE_STATUS.FAIL,
    code: RELEASE_CODES.PENDING_PHASE_PAST_DUE,
    reason: `dimensão ${dimensionId} alcançou a fase ${currentPhase} e continua sem evidência (${requiredPhase} exigida)`,
  });
}

module.exports = {
  PACKAGE_GATE_ID,
  LEGACY_DEFAULT_PHASE,
  DEFERRED_PACKAGE_DECISION,
  RELEASE_GATE_PHASES,
  SCORECARD_DIMENSION_PHASES,
  SEAL_DECISION_BY_GATE_STATUS,
  PAYLOAD_LANE,
  ENVELOPE_LANE,
  RELEASE_PHASE_LANES,
  gateRequiredPhase,
  dimensionRequiredPhase,
  deliveredPhaseDimensions,
  resolveGatePhase,
  packageDeferralDeadlinePhase,
  deferredDecisionForPhase,
  isDeferredDecisionAllowed,
  sealDecisionFromGateStatus,
  gateStatusFromSealDecision,
  dimensionPhaseTolerance,
  phaseLane,
  isEnvelopePhase,
  assertLaneMatches,
};
