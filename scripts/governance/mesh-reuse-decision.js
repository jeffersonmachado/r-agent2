#!/usr/bin/env node
'use strict';

/**
 * mesh-reuse-decision.js — o mesh já foi provado NESTE run? Então não reexecute.
 *
 * MEDIÇÃO QUE ORIGINOU ESTE MÓDULO (2026-10-05): o mesh canônico é executado por
 * `converge-governance.sh` passo 8/12, e a convergência é invocada TRÊS vezes num
 * ciclo completo:
 *
 *   1. `seal-release.sh` fase `prepare`               (converge #1)
 *   2. `two-pass-release.sh` no PRE_PACKAGE do zip     (fase `candidate`)
 *   3. `two-pass-release.sh` no PRE_PACKAGE do zip     (fase `final`)
 *
 * Cada uma rodava `npm run qa:mesh` INCONDICIONALMENTE: ~35 min cada, ~105 min dos
 * ~150 min do ciclo. E as execuções 2 e 3 não acrescentavam prova NENHUMA, porque
 * `ensure-governed-run.js` REUTILIZA o run quando o fingerprint congelado é o mesmo
 * ("se o run congelado é do MESMO fingerprint e existe na persistência, reutiliza —
 * nada é recriado"). Mesmo runId + mesmo sourceFingerprint => a evidência das
 * execuções 2 e 3 pertence ao MESMO run da execução 1: reexecutar não a torna
 * "mais same-run". O custo era puro desperdício, e a contenção extra era a causa
 * medida da intermitência do cenário `/editor`.
 *
 * O QUE ESTE MÓDULO *NÃO* FAZ: não aceita prova de outro run, não aceita prova de
 * outro source, não aceita execução não-canônica (ex.: `qa:mesh` chamado à mão sem
 * `RUNNING_IN_PIPELINE=1`), não aceita decisão que não seja GO, não aceita prova
 * anterior ao início do run, e não aceita prova que não cubra o REGISTRY CORRENTE
 * (cenário novo sem execução = sem prova). Reutilizar só é possível quando a
 * evidência É deste run — exatamente a regra temporal da missão.
 */

const fs = require('fs');
const path = require('path');

const CURRENT_RUN = 'governance/.current-run.json';
const GO_NO_GO = 'qa-mesh/go-no-go-report.json';
const RELEASE_GATE = 'qa-mesh/release-gate-report.json';
const HISTORY_DIR = 'qa-mesh/meshHistory';
const REGISTRY = 'qa-mesh/meshRegistry.json';
const RECORD = 'qa-mesh/mesh-reuse-decision.json';

function readJson(root, rel) {
  try {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Ids do registry canônico corrente (fonte: o próprio arquivo que o runner usa). */
function currentRegistryIds(root) {
  const raw = readJson(root, REGISTRY);
  const list = Array.isArray(raw) ? raw : (raw && (raw.scenarios || raw.entries || raw.registry)) || [];
  return list.map((entry) => entry && entry.id).filter((id) => typeof id === 'string' && id.trim());
}

/** Histórico canônico mais recente do run informado (o registro durável da execução). */
function latestHistoryEntry(root, runId) {
  const dir = path.join(root, HISTORY_DIR);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const parsed = readJson(root, path.join(HISTORY_DIR, files[i]));
    if (parsed && parsed.runId === runId) return { file: files[i], ...parsed };
  }
  return null;
}

/**
 * Decisão PURA (testável sem tocar disco). Devolve `{ reuse, code, detail, checks }`.
 * Qualquer condição não satisfeita => `reuse: false` (roda o mesh). Nunca o inverso.
 */
function decideMeshReuse({ run, goNoGo, releaseGate, historyEntry, registryIds } = {}) {
  const checks = [];
  const ok = (code, detail) => checks.push({ code, ok: true, detail });
  const deny = (code, detail) => ({ reuse: false, code, detail, checks });

  if (!run || !run.runId || !run.sourceFingerprint || !run.startedAt) {
    return deny('RUN_CONTEXT_MISSING', 'governance/.current-run.json ausente ou incompleto');
  }
  if (!goNoGo) return deny('MESH_EVIDENCE_MISSING', `${GO_NO_GO} ausente`);
  if (!releaseGate) return deny('RELEASE_GATE_MISSING', `${RELEASE_GATE} ausente`);
  if (!historyEntry) return deny('CANONICAL_HISTORY_MISSING', `nenhuma execução de ${HISTORY_DIR} pertence a ${run.runId}`);

  // 1. A prova tem de ser DESTE run e DESTE source.
  if (goNoGo.runId !== run.runId) return deny('MESH_EVIDENCE_OTHER_RUN', `evidência do run ${goNoGo.runId || 'n/d'}; run corrente ${run.runId}`);
  ok('SAME_RUN_ID', `runId=${run.runId}`);
  if (goNoGo.sourceFingerprint !== run.sourceFingerprint) {
    return deny('MESH_EVIDENCE_OTHER_SOURCE', `fingerprint ${String(goNoGo.sourceFingerprint).slice(0, 12)}… != ${String(run.sourceFingerprint).slice(0, 12)}…`);
  }
  ok('SAME_SOURCE', `sourceFingerprint=${String(run.sourceFingerprint).slice(0, 12)}…`);
  if (releaseGate.runId !== run.runId) return deny('RELEASE_GATE_NOT_BOUND', `release-gate do run ${releaseGate.runId || 'n/d'}`);
  ok('RELEASE_GATE_BOUND', 'qa-mesh/release-gate-report.json do run corrente');

  // 2. Execução CANÔNICA de pipeline (qa:mesh à mão não é prova autoritativa).
  if (goNoGo.isCanonicalExecution !== true || String(goNoGo.executionOrigin) !== 'pipeline') {
    return deny('MESH_EVIDENCE_NOT_CANONICAL', `isCanonicalExecution=${goNoGo.isCanonicalExecution} executionOrigin=${goNoGo.executionOrigin}`);
  }
  ok('CANONICAL_EXECUTION', 'executionOrigin=pipeline');
  if (historyEntry.isCanonicalExecution !== true) {
    return deny('HISTORY_NOT_CANONICAL', `histórico ${historyEntry.file} não é execução canônica`);
  }
  ok('CANONICAL_HISTORY', `qa-mesh/meshHistory/${historyEntry.file}`);

  // 3. Veredito GO: reutilizar NO_GO seria reutilizar uma reprovação.
  if (String(goNoGo.status) !== 'GO') {
    return deny('MESH_EVIDENCE_NOT_GO', `status=${goNoGo.status} reasons=${JSON.stringify(goNoGo.reasons || []).slice(0, 120)}`);
  }
  ok('DECISION_GO', 'status=GO');

  // 4. Regra temporal da missão: a prova não pode ser ANTERIOR ao run.
  const generatedAtMs = Date.parse(goNoGo.generatedAt || '');
  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(startedAtMs) || generatedAtMs < startedAtMs) {
    return deny('MESH_EVIDENCE_PRE_RUN', `generatedAt=${goNoGo.generatedAt || 'n/d'} < run.startedAt=${run.startedAt}`);
  }
  ok('SAME_RUN_TIME', `generatedAt=${goNoGo.generatedAt}`);

  // 5. Cobertura do REGISTRY CORRENTE: cenário novo sem execução não tem prova.
  const ids = Array.isArray(registryIds) ? registryIds : [];
  if (ids.length === 0) return deny('REGISTRY_EMPTY', `${REGISTRY} sem cenários`);
  const executed = new Set((historyEntry.results || []).map((entry) => entry && entry.id).filter(Boolean));
  const missing = ids.filter((id) => !executed.has(id));
  if (missing.length > 0) {
    return deny('REGISTRY_NOT_COVERED', `${missing.length} cenário(s) do registry sem execução no run: ${missing.slice(0, 5).join(', ')}`);
  }
  ok('REGISTRY_COVERED', `${ids.length} cenários cobertos pelo run`);

  return {
    reuse: true,
    code: 'MESH_REUSE_OK',
    detail: 'execução canônica GO DESTE run cobre o registry corrente: reexecução suprimida',
    checks,
  };
}

function writeRecord(root, payload) {
  fs.writeFileSync(path.join(root, RECORD), `${JSON.stringify(payload, null, 2)}\n`);
  return RECORD;
}

function main() {
  const root = process.cwd();
  const runFile = readJson(root, CURRENT_RUN);
  const run = runFile
    ? { runId: runFile.runId, sourceFingerprint: runFile.sourceFingerprint, startedAt: runFile.startedAt }
    : null;
  const goNoGo = readJson(root, GO_NO_GO);
  const releaseGate = readJson(root, RELEASE_GATE);
  const historyEntry = run ? latestHistoryEntry(root, run.runId) : null;
  const registryIds = currentRegistryIds(root);

  const decision = decideMeshReuse({ run, goNoGo, releaseGate, historyEntry, registryIds });
  const record = {
    artifactType: 'mesh-reuse-decision',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run ? run.runId : null,
    sourceFingerprint: run ? run.sourceFingerprint : null,
    runStartedAt: run ? run.startedAt : null,
    decision: decision.reuse ? 'REUSE' : 'RERUN',
    code: decision.code,
    detail: decision.detail,
    registryScenarios: registryIds.length,
    evidence: {
      goNoGoGeneratedAt: goNoGo ? goNoGo.generatedAt : null,
      goNoGoStatus: goNoGo ? goNoGo.status : null,
      historyEntry: historyEntry ? historyEntry.file : null,
    },
    checks: decision.checks,
  };
  const out = writeRecord(root, record);
  console.log(`[mesh-reuse] ${record.decision} ${decision.code} — ${decision.detail}`);
  console.log(`[mesh-reuse] record=${out}`);
  process.exitCode = decision.reuse ? 0 : 1;
}

module.exports = { decideMeshReuse, currentRegistryIds, latestHistoryEntry };

if (require.main === module) main();
