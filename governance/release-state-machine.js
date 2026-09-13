'use strict';

/**
 * release-state-machine.js — máquina de estados FORMAL do ciclo de release.
 *
 * MOTIVAÇÃO (deadlock real, 2026-09-12/13)
 * O pipeline de release era governado por tolerâncias AD HOC espalhadas
 * (`scorecard-phase-deferral`, `seal-release`, `two-pass`, `verify-payload`,
 * master scorecard). Cada uma reconhecia "o pacote ainda não existe" de um
 * jeito diferente. Consequência medida: com `dist/release/` vazio, os gates da
 * fase DELIVERED eram avaliados como FALHA REAL (não como "ainda não
 * avaliável"), o scorecard caía para ~29 dimensões abaixo de 10, o
 * `final-governance-report` virava NO_GO, `platform-readiness` bloqueava e o
 * `zip:release` abortava — SEM nunca materializar o payload que provaria o
 * contrário. Deadlock circular: "para selar você precisa do selo".
 *
 * O QUE ESTE MÓDULO FAZ
 * Torna a fase do release um dado de primeira classe:
 *   - fases ordenadas e imutáveis;
 *   - estados com precondições, inputs exigidos, outputs produzidos,
 *     transições permitidas e PROIBIDAS, gates e terminalidade;
 *   - `requiredPhase` por gate, com resolução de status em três valores:
 *     PASS | FAIL | PENDING_PHASE;
 *   - `PENDING_PHASE` significa "pré-condições ainda não existem" — NUNCA
 *     PASS, NUNCA FAIL, NUNCA gap aceito para sempre;
 *   - PENDING vencido (currentPhase >= requiredPhase e ainda pendente) = FAIL.
 *
 * SEMÂNTICA DE SCORE (R18)
 * O score da fase corrente não pode ser contaminado por dimensões que ainda
 * não são mensuráveis, e o score final não pode ser inferido antes das fases
 * finais: `FINAL_RELEASE_SCORE = NOT_YET_MEASURABLE` enquanto o release não
 * alcançar a fase que torna a medição possível.
 *
 * Este módulo é PURO (sem fs/rede/relógio). É a autoridade semântica única:
 * scorecard, seal gate, verificadores e o empacotador devem consultá-lo em vez
 * de reimplementar tolerâncias.
 */

/** Fases ordenadas. O índice é a autoridade de ordenação — nunca comparar strings. */
const RELEASE_PHASES = Object.freeze([
  'SOURCE_VALIDATED',
  'PRE_PACKAGE',
  'CANDIDATE_BUILT',
  'CANDIDATE_VALIDATED',
  'SEALED',
  'DELIVERED',
  'FINAL_GOVERNANCE',
  'PUBLISHED_VERIFIED',
]);

const RELEASE_PHASE_INDEX = Object.freeze(
  Object.fromEntries(RELEASE_PHASES.map((phase, index) => [phase, index])),
);

/** Status possíveis de um gate avaliado sob o modelo de fases. */
const GATE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PENDING_PHASE: 'PENDING_PHASE',
});

/** Códigos de diagnóstico (estáveis — consumidos por relatórios). */
const RELEASE_CODES = Object.freeze({
  UNKNOWN_PHASE: 'RELEASE_UNKNOWN_PHASE',
  INVALID_TRANSITION: 'RELEASE_INVALID_TRANSITION',
  GATE_REQUIRED_PHASE_MISSING: 'RELEASE_GATE_REQUIRED_PHASE_MISSING',
  GATE_EVALUATION_MISSING: 'RELEASE_GATE_EVALUATION_MISSING',
  PENDING_PHASE: 'PENDING_PHASE',
  PENDING_PHASE_PAST_DUE: 'PENDING_PHASE_PAST_DUE',
  FORBIDDEN_TRANSITION: 'RELEASE_FORBIDDEN_TRANSITION',
  DEPENDENCY_CYCLE: 'RELEASE_DEPENDENCY_CYCLE',
  PHASE_ORDER_VIOLATION: 'RELEASE_PHASE_ORDER_VIOLATION',
  SELF_REFERENTIAL_ARTIFACT: 'RELEASE_SELF_REFERENTIAL_ARTIFACT',
});

class ReleaseStateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReleaseStateError';
    this.code = code;
    this.details = details;
  }
}

function isKnownPhase(phase) {
  return Object.prototype.hasOwnProperty.call(RELEASE_PHASE_INDEX, String(phase || ''));
}

function phaseIndex(phase) {
  if (!isKnownPhase(phase)) {
    throw new ReleaseStateError(
      RELEASE_CODES.UNKNOWN_PHASE,
      `fase desconhecida: ${JSON.stringify(phase)}`,
      { phase, known: RELEASE_PHASES },
    );
  }
  return RELEASE_PHASE_INDEX[phase];
}

function nextPhase(phase) {
  const index = phaseIndex(phase);
  return index + 1 < RELEASE_PHASES.length ? RELEASE_PHASES[index + 1] : null;
}

/**
 * `current` alcançou ou passou de `required`?
 * Esta é a ÚNICA comparação de fase autorizada no sistema.
 */
function phaseAtLeast(current, required) {
  return phaseIndex(current) >= phaseIndex(required);
}

/** `required` é estritamente posterior a `current`? */
function phaseIsLater(required, current) {
  return phaseIndex(required) > phaseIndex(current);
}

/**
 * Tabela de estados. Cada estado declara o contrato da fase:
 * preconditions, requiredInputs, producedOutputs, gates, allowedForbidden.
 */
const RELEASE_STATES = Object.freeze({
  SOURCE_VALIDATED: Object.freeze({
    id: 'SOURCE_VALIDATED',
    label: 'Fonte validada (source fingerprint + proveniência remota)',
    preconditions: [
      'worktree limpo (git status --porcelain vazio)',
      'commit/tree existem no remote (ancestro ou tip de branch)',
    ],
    requiredInputs: ['sourceFingerprint', 'gitCommit', 'gitTree', 'governanceRunId'],
    producedOutputs: ['sourceFingerprint', 'governanceRun', 'sourceProvenanceReport'],
    gates: ['source_security', 'remote_provenance', 'experience_segregation', 'experience_api_segregation'],
    allowedTransitions: ['PRE_PACKAGE'],
    forbiddenTransitions: ['CANDIDATE_BUILT', 'CANDIDATE_VALIDATED', 'SEALED', 'DELIVERED', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  PRE_PACKAGE: Object.freeze({
    id: 'PRE_PACKAGE',
    label: 'Pré-pacote (nenhum artefato de pacote existe ainda)',
    preconditions: ['fase SOURCE_VALIDATED concluída'],
    requiredInputs: ['sourceFingerprint', 'gitCommit'],
    producedOutputs: ['masterScorecardSource', 'sealTimeDecisionPrePackage'],
    gates: ['master_scorecard', 'seal_time_gate'],
    allowedTransitions: ['CANDIDATE_BUILT'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'CANDIDATE_VALIDATED', 'SEALED', 'DELIVERED', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  CANDIDATE_BUILT: Object.freeze({
    id: 'CANDIDATE_BUILT',
    label: 'Candidato materializado (artefato de primeira classe)',
    preconditions: ['fase PRE_PACKAGE concluída'],
    requiredInputs: ['sourceFingerprint', 'gitCommit', 'gitTree'],
    producedOutputs: ['candidateZip', 'candidateManifest'],
    gates: ['candidate_artifact', 'package_structure'],
    allowedTransitions: ['CANDIDATE_VALIDATED'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'SEALED', 'DELIVERED', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  CANDIDATE_VALIDATED: Object.freeze({
    id: 'CANDIDATE_VALIDATED',
    label: 'Candidato validado (integridade, assinatura, tamper, self-proof)',
    preconditions: ['fase CANDIDATE_BUILT concluída'],
    requiredInputs: ['candidateHash', 'candidateManifest'],
    producedOutputs: ['candidateValidationReport', 'signatures', 'candidateTamperReport'],
    gates: [
      'candidate_manifest',
      'candidate_integrity',
      'candidate_signature',
      'candidate_tamper_detection',
      'candidate_self_proof',
      'clean_release_start',
    ],
    allowedTransitions: ['SEALED'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'CANDIDATE_BUILT', 'DELIVERED', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  SEALED: Object.freeze({
    id: 'SEALED',
    label: 'Decisão de selagem emitida para o candidato validado',
    preconditions: ['fase CANDIDATE_VALIDATED concluída'],
    requiredInputs: ['candidateHash', 'candidateValidationReport'],
    producedOutputs: ['sealDecision'],
    gates: ['seal_time_gate', 'candidate_validation_report'],
    allowedTransitions: ['DELIVERED'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'CANDIDATE_BUILT', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  DELIVERED: Object.freeze({
    id: 'DELIVERED',
    label: 'Payload final entregue (artefato derivado do candidato)',
    preconditions: ['fase SEALED concluída com decisão permitida'],
    requiredInputs: ['candidateHash', 'sealDecision'],
    producedOutputs: ['deliveredPayload', 'deliveredManifest', 'lineage'],
    gates: [
      'delivered_payload',
      'delivered_hash',
      'delivered_manifest',
      'exact_payload_verification',
      'delivered_release_hygiene',
    ],
    allowedTransitions: ['FINAL_GOVERNANCE'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'CANDIDATE_BUILT', 'PUBLISHED_VERIFIED'],
    terminal: false,
  }),
  FINAL_GOVERNANCE: Object.freeze({
    id: 'FINAL_GOVERNANCE',
    label: 'Governança final sobre o payload entregue',
    preconditions: ['fase DELIVERED concluída'],
    requiredInputs: ['finalPayloadHash', 'deliveredManifest'],
    producedOutputs: ['finalConsistencyReport', 'finalGovernanceReport', 'platformReadiness', 'finalStatusProjection'],
    gates: ['final_consistency', 'master_scorecard', 'final_governance', 'platform_readiness', 'final_status_projection'],
    allowedTransitions: ['PUBLISHED_VERIFIED'],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'CANDIDATE_BUILT'],
    terminal: false,
  }),
  PUBLISHED_VERIFIED: Object.freeze({
    id: 'PUBLISHED_VERIFIED',
    label: 'Release publicado e verificado (tag imutável + recibo)',
    preconditions: ['fase FINAL_GOVERNANCE concluída'],
    requiredInputs: ['finalPayloadHash', 'gitCommit'],
    producedOutputs: ['releaseTag', 'publicationReceipt', 'deliveredReleaseVerification'],
    gates: ['release_tag_provenance', 'release_publication', 'delivered_release_verified'],
    allowedTransitions: [],
    forbiddenTransitions: ['SOURCE_VALIDATED', 'PRE_PACKAGE', 'CANDIDATE_BUILT', 'CANDIDATE_VALIDATED', 'SEALED', 'DELIVERED'],
    terminal: true,
  }),
});

const TERMINAL_PHASES = Object.freeze(
  RELEASE_PHASES.filter((phase) => RELEASE_STATES[phase].terminal === true),
);

function describeState(phase) {
  phaseIndex(phase);
  return RELEASE_STATES[phase];
}

function canTransition(from, to) {
  return RELEASE_STATES[from].allowedTransitions.includes(to);
}

/**
 * Transição válida = está em allowedTransitions. Qualquer salto silencioso
 * (ex.: SOURCE_VALIDATED -> DELIVERED) é erro, não aviso.
 */
function assertTransition(from, to) {
  phaseIndex(from);
  phaseIndex(to);
  if (canTransition(from, to)) return true;
  const forbidden = RELEASE_STATES[from].forbiddenTransitions.includes(to);
  throw new ReleaseStateError(
    forbidden ? RELEASE_CODES.FORBIDDEN_TRANSITION : RELEASE_CODES.INVALID_TRANSITION,
    `transição de release inválida: ${from} -> ${to}`,
    { from, to, allowed: RELEASE_STATES[from].allowedTransitions },
  );
}

/** Menor fase (em ordem) que produz um artefato. */
function requiredPhaseForArtifact(artifacts, artifactId) {
  const entry = artifacts[artifactId];
  if (!entry) {
    throw new ReleaseStateError(
      RELEASE_CODES.PHASE_ORDER_VIOLATION,
      `artefato não declarado: ${artifactId}`,
      { artifactId },
    );
  }
  return entry.producedInPhase;
}

/**
 * Avalia UM gate sob o modelo de fases.
 *
 * - `requiredPhase` é obrigatório: um gate sem fase declarada é um defeito de
 *   configuração, não um gate tolerável.
 * - `evaluate()` só é chamado quando a fase corrente alcançou a fase exigida.
 *   Avaliar antes seria julgar um artefato que não pode existir.
 * - Se a fase corrente já alcançou a fase exigida, o resultado de `evaluate()`
 *   é terminal (PASS ou FAIL) — nunca é convertido em espera.
 */
function evaluateGate({
  gateId,
  requiredPhase,
  currentPhase,
  evaluate,
  reason,
} = {}) {
  if (!gateId) {
    throw new ReleaseStateError(RELEASE_CODES.GATE_EVALUATION_MISSING, 'gateId é obrigatório');
  }
  if (!isKnownPhase(requiredPhase)) {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_REQUIRED_PHASE_MISSING,
      `gate ${gateId} não declarou requiredPhase válida`,
      { gateId, requiredPhase },
    );
  }
  phaseIndex(currentPhase);

  if (!phaseAtLeast(currentPhase, requiredPhase)) {
    return Object.freeze({
      gateId,
      status: GATE_STATUS.PENDING_PHASE,
      code: RELEASE_CODES.PENDING_PHASE,
      requiredPhase,
      currentPhase,
      reason: reason || 'pré-condições da fase ainda não existem',
    });
  }

  if (typeof evaluate !== 'function') {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_EVALUATION_MISSING,
      `gate ${gateId} alcançou a fase ${requiredPhase} mas não tem avaliação`,
      { gateId, requiredPhase, currentPhase },
    );
  }

  const raw = evaluate();
  const rawStatus = raw && typeof raw === 'object' ? raw.status : raw;
  if (rawStatus !== GATE_STATUS.PASS && rawStatus !== GATE_STATUS.FAIL) {
    throw new ReleaseStateError(
      RELEASE_CODES.GATE_EVALUATION_MISSING,
      `gate ${gateId} devolveu status inválido: ${JSON.stringify(rawStatus)}`,
      { gateId, rawStatus },
    );
  }

  return Object.freeze({
    gateId,
    status: rawStatus,
    code: rawStatus === GATE_STATUS.PASS ? null : (raw && raw.code) || null,
    requiredPhase,
    currentPhase,
    reason: (raw && raw.reason) || null,
  });
}

/**
 * PENDING vencido é FAIL (R14). Um gate que devia estar avaliável e continua
 * "pendente" significa que o pipeline não produziu o output da fase — e isso
 * não pode ser aceito como sucesso nem como gap eternamente tolerado.
 */
function checkPendingPastDue({ gateId, requiredPhase, currentPhase, status }) {
  if (status !== GATE_STATUS.PENDING_PHASE) {
    return Object.freeze({ pastDue: false });
  }
  if (phaseAtLeast(currentPhase, requiredPhase)) {
    return Object.freeze({
      pastDue: true,
      gateId,
      code: RELEASE_CODES.PENDING_PHASE_PAST_DUE,
      status: GATE_STATUS.FAIL,
      requiredPhase,
      currentPhase,
      reason: `gate ${gateId} alcançou a fase ${currentPhase} e continua PENDING_PHASE (output da fase nunca foi produzido)`,
    });
  }
  return Object.freeze({ pastDue: false });
}

/**
 * Agrega um conjunto de gates JÁ avaliados. PENDING vencido vira FAIL aqui —
 * é o único lugar onde isso pode acontecer, de propósito.
 */
function aggregateGates(gates = [], { currentPhase } = {}) {
  const results = gates.map((gate) => {
    const pastDue = checkPendingPastDue({ ...gate, currentPhase });
    if (pastDue.pastDue) {
      return Object.freeze({ ...gate, status: GATE_STATUS.FAIL, code: pastDue.code, reason: pastDue.reason });
    }
    return Object.freeze({ ...gate });
  });

  const failed = results.filter((g) => g.status === GATE_STATUS.FAIL);
  const pending = results.filter((g) => g.status === GATE_STATUS.PENDING_PHASE);
  const passed = results.filter((g) => g.status === GATE_STATUS.PASS);

  return Object.freeze({
    currentPhase,
    gates: results,
    passed: passed.length,
    failed: failed.length,
    pending: pending.length,
    status: failed.length > 0
      ? GATE_STATUS.FAIL
      : pending.length > 0
        ? GATE_STATUS.PENDING_PHASE
        : GATE_STATUS.PASS,
    failedGates: failed.map((g) => g.gateId),
    pendingGates: pending.map((g) => g.gateId),
  });
}

/**
 * Scorecards por fase (R17/R18).
 *
 * `source` é mensurável desde SOURCE_VALIDATED; `candidate` só depois de
 * CANDIDATE_BUILT; `delivered` só depois de DELIVERED. O score da fase corrente
 * NUNCA é inventado a partir de dimensões ainda não mensuráveis.
 */
function summarizeScorecards({
  currentPhase,
  source = null,
  candidate = null,
  delivered = null,
} = {}) {
  phaseIndex(currentPhase);

  function view(scorecard, phase) {
    if (!scorecard) {
      return Object.freeze({ status: GATE_STATUS.PENDING_PHASE, phase, score: null, below10: null });
    }
    if (!phaseAtLeast(currentPhase, phase)) {
      return Object.freeze({ status: GATE_STATUS.PENDING_PHASE, phase, score: null, below10: null });
    }
    return Object.freeze({
      status: scorecard.status || null,
      phase,
      score: scorecard.score ?? null,
      below10: scorecard.below10 ?? null,
    });
  }

  const sourceView = view(source, 'SOURCE_VALIDATED');
  const candidateView = view(candidate, 'CANDIDATE_BUILT');
  const deliveredView = view(delivered, 'DELIVERED');

  const measurable = [
    { phase: 'SOURCE_VALIDATED', view: sourceView },
    { phase: 'CANDIDATE_BUILT', view: candidateView },
    { phase: 'DELIVERED', view: deliveredView },
  ];

  // Score da fase corrente: só dimensões mensuráveis na fase corrente, com os
  // valores REAIS. Nunca uma fração inventada.
  const currentPhaseScore = measurable
    .filter((entry) => phaseAtLeast(currentPhase, entry.phase))
    .map((entry) => ({ phase: entry.phase, score: entry.view.score, below10: entry.view.below10 }));

  const everyPhaseMeasured = measurable.every((entry) => phaseAtLeast(currentPhase, entry.phase));
  const anyFailure = measurable.some(
    (entry) => entry.view.status === GATE_STATUS.FAIL,
  );

  return Object.freeze({
    currentPhase,
    source: sourceView,
    candidate: candidateView,
    delivered: deliveredView,
    currentPhaseScore: Object.freeze(currentPhaseScore),
    // FINAL_RELEASE_SCORE só existe depois das fases finais (R18/G2).
    finalReleaseScore: everyPhaseMeasured
      ? (anyFailure ? 'BELOW_THRESHOLD' : 'MEASURED')
      : 'NOT_YET_MEASURABLE',
  });
}

/**
 * Invariantes da própria máquina de estados. Um modelo inconsistente é um
 * defeito de governança — falhar aqui é mais barato que falhar no selo.
 */
function validateStateMachine() {
  const problems = [];

  RELEASE_PHASES.forEach((phase, index) => {
    const state = RELEASE_STATES[phase];
    if (!state) {
      problems.push({ code: 'STATE_MISSING', phase });
      return;
    }
    if (state.id !== phase) problems.push({ code: 'STATE_ID_MISMATCH', phase, id: state.id });
    const terminal = index === RELEASE_PHASES.length - 1;
    if (state.terminal !== terminal) {
      problems.push({ code: 'TERMINAL_FLAG_MISMATCH', phase, terminal: state.terminal, expected: terminal });
    }
    for (const transition of state.allowedTransitions) {
      if (!isKnownPhase(transition)) {
        problems.push({ code: 'TRANSITION_TARGET_UNKNOWN', phase, transition });
        continue;
      }
      // Só o salto para a fase imediatamente seguinte é permitido: máquina de
      // estados de release não tem atalhos.
      if (RELEASE_PHASE_INDEX[transition] !== index + 1) {
        problems.push({ code: 'TRANSITION_NOT_SEQUENTIAL', phase, transition });
      }
      if (state.forbiddenTransitions.includes(transition)) {
        problems.push({ code: 'TRANSITION_SELF_CONTRADICTORY', phase, transition });
      }
    }
    for (const forbidden of state.forbiddenTransitions) {
      if (!isKnownPhase(forbidden)) {
        problems.push({ code: 'FORBIDDEN_TARGET_UNKNOWN', phase, forbidden });
      }
    }
    // Completude: todo salto para a FRENTE que não seja o passo imediatamente
    // seguinte precisa estar declarado como proibido. Sem isso, "não há salto
    // silencioso" seria apenas prosa.
    RELEASE_PHASES.forEach((candidate, candidateIndex) => {
      if (candidateIndex <= index + 1) return;
      if (!state.forbiddenTransitions.includes(candidate)) {
        problems.push({ code: 'FORWARD_JUMP_NOT_DECLARED', phase, candidate });
      }
    });
    if (!state.requiredInputs.length) problems.push({ code: 'STATE_WITHOUT_INPUTS', phase });
    if (!state.producedOutputs.length) problems.push({ code: 'STATE_WITHOUT_OUTPUTS', phase });
    if (!terminal && !state.gates.length) problems.push({ code: 'STATE_WITHOUT_GATES', phase });
  });

  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    phases: RELEASE_PHASES,
    terminalPhases: TERMINAL_PHASES,
  });
}

module.exports = {
  RELEASE_PHASES,
  RELEASE_PHASE_INDEX,
  RELEASE_STATES,
  RELEASE_CODES,
  GATE_STATUS,
  TERMINAL_PHASES,
  ReleaseStateError,
  isKnownPhase,
  phaseIndex,
  nextPhase,
  phaseAtLeast,
  phaseIsLater,
  describeState,
  canTransition,
  assertTransition,
  requiredPhaseForArtifact,
  evaluateGate,
  checkPendingPastDue,
  aggregateGates,
  summarizeScorecards,
  validateStateMachine,
};
