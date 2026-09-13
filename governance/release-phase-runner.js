'use strict';

/**
 * release-phase-runner.js — a máquina de estados do release como AUTORIDADE de
 * runtime (TAREFA 47/48/51..54, 86..88).
 *
 * Antes deste módulo, `governance/release-state-machine.js` era uma biblioteca:
 * o pipeline real decidia por conta própria e a máquina de estados nunca era
 * consultada em runtime. Aqui a fase passa a ser ESTADO PERSISTIDO e toda
 * mutação de fase é uma TRANSIÇÃO VALIDADA:
 *
 *   - `advancePhase` chama `assertTransition` — um salto (ex.: para DELIVERED
 *     antes de SEALED) ABORTA com `RELEASE_FORBIDDEN_TRANSITION`;
 *   - a transição para `CANDIDATE_BUILT` (primeira mutação de pacote) exige o
 *     DAG comprovadamente acíclico — um ciclo injetado aborta ANTES de tocar
 *     qualquer ZIP (`RELEASE_DEPENDENCY_CYCLE`);
 *   - `recordGate` avalia o gate na fase corrente: antes da `requiredPhase` o
 *     resultado é `PENDING_PHASE` (tolerável), nunca PASS nem FAIL;
 *   - ao avançar, todo gate que ficou pendente e cuja fase já passou vira
 *     `PENDING_PHASE_PAST_DUE` = FAIL (`checkPendingPastDue`). PENDING não pode
 *     virar um limbo eterno;
 *   - o relatório declara a LANE (PAYLOAD vs ENVELOPE) para o consumidor não
 *     confundir um snapshot PRE_PACKAGE com a decisão FINAL.
 *
 * Estado: `reports/release-phase-state.json` (derivado, regenerável pelo
 * pipeline — nunca fonte de decisão de conteúdo).
 */

const fs = require('fs');
const path = require('path');

const {
  RELEASE_PHASES,
  GATE_STATUS,
  RELEASE_CODES,
  ReleaseStateError,
  assertTransition,
  evaluateGate,
  checkPendingPastDue,
  phaseAtLeast,
  phaseIsLater,
  isKnownPhase,
  describeState,
} = require('./release-state-machine');
const {
  gateRequiredPhase,
  phaseLane,
  isEnvelopePhase,
  RELEASE_GATE_PHASES,
} = require('./release-phase-policy');

const ARTIFACT_TYPE = 'release-phase-state';
const ARTIFACT_VERSION = '1.0.0';
const STATE_REL_PATH = path.join('reports', 'release-phase-state.json');
const REPORT_REL_PATH = path.join('reports', 'release-phase-report.json');

const INITIAL_PHASE = RELEASE_PHASES[0];

function statePath(rootDir) {
  return path.join(rootDir, STATE_REL_PATH);
}

function reportPath(rootDir) {
  return path.join(rootDir, REPORT_REL_PATH);
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function loadPhaseState(rootDir) {
  return readJsonSafe(statePath(rootDir));
}

function requirePhaseState(rootDir) {
  const state = loadPhaseState(rootDir);
  if (!state || !isKnownPhase(state.currentPhase)) {
    throw new ReleaseStateError(
      RELEASE_CODES.UNKNOWN_PHASE,
      `estado de fase do release ausente/inválido em ${STATE_REL_PATH} — rode release-phase start`,
      { statePath: STATE_REL_PATH },
    );
  }
  return state;
}

function emptyState({ release = null, lineage = {}, at = new Date().toISOString() } = {}) {
  return {
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    release,
    runId: lineage.runId || null,
    sourceFingerprint: lineage.sourceFingerprint || null,
    currentPhase: null,
    history: [],
    gates: {},
    startedAt: at,
    updatedAt: at,
  };
}

/**
 * Inicia (ou reinicia) o ciclo de fases em SOURCE_VALIDATED. Reiniciar é
 * explícito: o pipeline começa do zero a cada execução.
 */
function startPhaseRun({ rootDir, release = null, lineage = {}, at = new Date().toISOString() } = {}) {
  const state = emptyState({ release, lineage, at });
  state.currentPhase = INITIAL_PHASE;
  state.history.push({ from: null, to: INITIAL_PHASE, at, evidence: null });
  writeJson(statePath(rootDir), state);
  return state;
}

/**
 * Avança a fase com VALIDAÇÃO real da transição.
 *
 * Ordem das checagens (fail-closed):
 *   1. transição permitida (`assertTransition`);
 *   2. DAG acíclico antes de qualquer mutação de pacote (CANDIDATE_BUILT);
 *   3. nenhum gate registrado ficou pendente além da fase exigida.
 */
function advancePhase({ rootDir, to, evidence = null, at = new Date().toISOString(), checker = null } = {}) {
  const state = requirePhaseState(rootDir);
  const from = state.currentPhase;

  // 1. Transição REALMENTE validada — nenhum salto silencioso.
  assertTransition(from, to);

  // 2. Antes de mutar pacote, o grafo precisa ser acíclico. Um ciclo aqui é
  //    dependência impossível ("o pacote precisa do pacote"); abortar agora
  //    evita reescrever ZIPs assinados antes de descobrir o ciclo.
  if (to === 'CANDIDATE_BUILT') {
    const dagChecker = checker || require('./release-dag').assertReleaseDagAcyclic;
    dagChecker();
  }

  // 3. PENDING vencido é FAIL: a fase nova pode ter alcançado gates que ficaram
  //    pendentes e nunca produziram output.
  const pastDue = collectPastDueGates(state.gates, to);
  if (pastDue.length > 0) {
    throw new ReleaseStateError(
      RELEASE_CODES.PENDING_PHASE_PAST_DUE,
      `PENDING_PHASE_PAST_DUE ao avançar para ${to}: ${pastDue.map((g) => g.gateId).join(', ')}`,
      { to, gates: pastDue },
    );
  }

  const updated = {
    ...state,
    currentPhase: to,
    updatedAt: at,
    history: [...state.history, { from, to, at, evidence }],
  };
  writeJson(statePath(rootDir), updated);
  return updated;
}

/**
 * Gates registrados que continuam `PENDING_PHASE` ALÉM da fase que os exige.
 *
 * A comparação é ESTRITA (`phaseIsLater`): chegar na fase exigida ainda não é
 * violação — é exatamente onde o gate deve ser produzido. A violação é SAIR da
 * fase (avançar além dela) sem que o gate tenha produzido output. Sem essa
 * distinção, a própria transição para a fase do gate abortaria o pipeline.
 */
function collectPastDueGates(gates = {}, currentPhase) {
  const result = [];
  for (const [gateId, entry] of Object.entries(gates)) {
    if (!entry || entry.status !== GATE_STATUS.PENDING_PHASE) continue;
    const pastDue = checkPendingPastDue({
      gateId,
      requiredPhase: entry.requiredPhase,
      currentPhase,
      status: entry.status,
    });
    if (!pastDue.pastDue) continue;
    if (!phaseIsLater(currentPhase, entry.requiredPhase)) continue;
    result.push({ gateId, ...pastDue });
  }
  return result;
}

/**
 * Registra a avaliação de UM gate na fase corrente. Antes da `requiredPhase` o
 * status é `PENDING_PHASE` (e `evaluate` NEM é chamado); na fase, o resultado é
 * real (PASS/FAIL) — nunca convertido em espera.
 */
function recordGate({ rootDir, gateId, evaluate, at = new Date().toISOString(), state = null } = {}) {
  const current = state || requirePhaseState(rootDir);
  const requiredPhase = gateRequiredPhase(gateId);
  const result = evaluateGate({
    gateId,
    requiredPhase,
    currentPhase: current.currentPhase,
    evaluate,
  });
  const entry = {
    gateId,
    status: result.status,
    code: result.code || null,
    requiredPhase,
    evaluatedAtPhase: current.currentPhase,
    at,
    reason: result.reason || null,
  };
  if (state) {
    state.gates[gateId] = entry;
  } else {
    const updated = { ...current, gates: { ...current.gates, [gateId]: entry }, updatedAt: at };
    writeJson(statePath(rootDir), updated);
  }
  return Object.freeze(entry);
}

/** Exige que a fase corrente tenha alcançado `phase`. */
function assertPhaseAtLeast({ rootDir, phase } = {}) {
  const state = requirePhaseState(rootDir);
  if (!phaseAtLeast(state.currentPhase, phase)) {
    throw new ReleaseStateError(
      RELEASE_CODES.PHASE_ORDER_VIOLATION,
      `fase corrente ${state.currentPhase} é anterior a ${phase} — pré-condição não satisfeita`,
      { currentPhase: state.currentPhase, required: phase },
    );
  }
  return state;
}

/**
 * Relatório da fase corrente. Declara explicitamente a lane (PAYLOAD/ENVELOPE)
 * e o status de todos os gates conhecidos — incluindo PENDING vencido (FAIL).
 */
function buildPhaseReport({ rootDir } = {}) {
  const state = requirePhaseState(rootDir);
  const gates = Object.entries(state.gates).map(([gateId, entry]) => {
    const pastDue = entry.status === GATE_STATUS.PENDING_PHASE
      ? checkPendingPastDue({
        gateId,
        requiredPhase: entry.requiredPhase,
        currentPhase: state.currentPhase,
        status: entry.status,
      })
      : { pastDue: false };
    const status = pastDue.pastDue ? GATE_STATUS.FAIL : entry.status;
    return {
      gateId,
      requiredPhase: entry.requiredPhase,
      status,
      code: pastDue.pastDue ? pastDue.code : entry.code,
      evaluatedAtPhase: entry.evaluatedAtPhase,
    };
  });

  const failed = gates.filter((g) => g.status === GATE_STATUS.FAIL);
  const pending = gates.filter((g) => g.status === GATE_STATUS.PENDING_PHASE);

  return {
    artifactType: 'release-phase-report',
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: new Date().toISOString(),
    release: state.release,
    runId: state.runId,
    sourceFingerprint: state.sourceFingerprint,
    currentPhase: state.currentPhase,
    lane: phaseLane(state.currentPhase),
    isEnvelopePhase: isEnvelopePhase(state.currentPhase),
    state: describeState(state.currentPhase),
    declaredGatePhases: RELEASE_GATE_PHASES,
    gates,
    gateStatus: failed.length > 0
      ? GATE_STATUS.FAIL
      : pending.length > 0
        ? GATE_STATUS.PENDING_PHASE
        : GATE_STATUS.PASS,
    failedGates: failed.map((g) => g.gateId),
    pendingGates: pending.map((g) => g.gateId),
    history: state.history,
    // Um consumidor não pode confundir o snapshot de uma lane com a decisão da
    // outra: a prova do envelope é EXTERNA ao payload (paradoxo do auto-hash).
    phaseModel: {
      payloadLanePhases: RELEASE_PHASES.filter((phase) => !isEnvelopePhase(phase)),
      envelopeLanePhases: RELEASE_PHASES.filter((phase) => isEnvelopePhase(phase)),
      note: 'Relatórios da lane PAYLOAD (até DELIVERED) não são a decisão FINAL do envelope; a decisão final vive na lane ENVELOPE e é provada por artefato externo (lineage detached).',
    },
  };
}

function writePhaseReport({ rootDir } = {}) {
  const report = buildPhaseReport({ rootDir });
  writeJson(reportPath(rootDir), report);
  return report;
}

module.exports = {
  ARTIFACT_TYPE,
  ARTIFACT_VERSION,
  STATE_REL_PATH,
  REPORT_REL_PATH,
  INITIAL_PHASE,
  statePath,
  reportPath,
  loadPhaseState,
  requirePhaseState,
  startPhaseRun,
  advancePhase,
  collectPastDueGates,
  recordGate,
  assertPhaseAtLeast,
  buildPhaseReport,
  writePhaseReport,
};
