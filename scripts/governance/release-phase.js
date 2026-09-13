#!/usr/bin/env node
'use strict';

/**
 * release-phase.js — CLI da AUTHORITY de fase do release (TAREFA 47/48).
 *
 * O `scripts/two-pass-release.sh` chama este CLI nos pontos de fase. A fase
 * deixa de ser comentário e passa a ser transição validada:
 *
 *   node scripts/governance/release-phase.js start --release <nome>
 *   node scripts/governance/release-phase.js assert --phase PRE_PACKAGE
 *   node scripts/governance/release-phase.js advance --to PRE_PACKAGE
 *   node scripts/governance/release-phase.js gate --id candidate_manifest \
 *        --from-report governance/package-validation-report.json
 *   node scripts/governance/release-phase.js report
 *
 * O status de um gate NUNCA é digitado à mão: vem do relatório real
 * (`--from-report`) e é mapeado para PASS/FAIL. Relatório ausente na fase
 * exigida = FAIL (fail-closed). Antes da fase exigida, o gate é PENDING_PHASE
 * (tolerável, nunca PASS).
 *
 * Exit codes: 0 = ok/PENDING dentro do prazo; 1 = FAIL, transição inválida,
 * ciclo no DAG ou PENDING vencido.
 */

const fs = require('fs');
const path = require('path');

const {
  RELEASE_PHASES,
  GATE_STATUS,
  RELEASE_CODES,
  ReleaseStateError,
} = require('../../governance/release-state-machine');
const {
  STATE_REL_PATH,
  REPORT_REL_PATH,
  startPhaseRun,
  advancePhase,
  assertPhaseAtLeast,
  recordGate,
  buildPhaseReport,
  writePhaseReport,
} = require('../../governance/release-phase-runner');
const { RELEASE_GATE_PHASES } = require('../../governance/release-phase-policy');

const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  return out;
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readByPath(object, dotPath) {
  return String(dotPath || '').split('.').reduce(
    (acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined),
    object,
  );
}

function currentRunLineage() {
  const ctx = readJsonSafe(path.join(ROOT, 'governance', '.current-run.json'));
  return {
    runId: (ctx && ctx.runId) || null,
    sourceFingerprint: (ctx && ctx.sourceFingerprint) || null,
  };
}

function fail(message, code = null) {
  console.error(`[release-phase] FAIL${code ? ` ${code}` : ''}: ${message}`);
  process.exit(1);
}

/**
 * Constrói o avaliador do gate a partir do relatório REAL. Nada é assumido:
 * o valor observado precisa estar na lista de valores aceitos (`--accept`).
 */
function buildEvaluatorFromReport({ reportRelPath, statusField, acceptedValues }) {
  return () => {
    if (!reportRelPath) {
      return { status: GATE_STATUS.FAIL, code: 'GATE_STATUS_SOURCE_MISSING', reason: 'nenhuma fonte de status declarada (--from-report)' };
    }
    const absPath = path.isAbsolute(reportRelPath) ? reportRelPath : path.join(ROOT, reportRelPath);
    const report = readJsonSafe(absPath);
    if (!report || typeof report !== 'object') {
      return {
        status: GATE_STATUS.FAIL,
        code: 'GATE_STATUS_SOURCE_UNREADABLE',
        reason: `relatório de status ausente/ilegível: ${reportRelPath}`,
      };
    }
    const observed = readByPath(report, statusField);
    const observedText = observed == null ? 'null' : String(observed);
    const accepted = acceptedValues && acceptedValues.length > 0 ? acceptedValues : ['PASS'];
    if (accepted.includes(observedText)) {
      return { status: GATE_STATUS.PASS, reason: `${statusField}=${observedText}` };
    }
    return {
      status: GATE_STATUS.FAIL,
      code: 'GATE_STATUS_NOT_ACCEPTED',
      reason: `${reportRelPath}:${statusField}=${observedText} fora de [${accepted.join(',')}]`,
    };
  };
}

function commandStart(args) {
  const lineage = currentRunLineage();
  const state = startPhaseRun({
    rootDir: ROOT,
    release: args.release || null,
    lineage,
  });
  console.log(`[release-phase] start: fase=${state.currentPhase} runId=${state.runId || '-'}`);
  process.exit(0);
}

function commandAdvance(args) {
  const to = args.to;
  if (!to) fail('--to é obrigatório');
  let evidence = null;
  if (args.evidence) {
    const abs = path.isAbsolute(args.evidence) ? args.evidence : path.join(ROOT, args.evidence);
    evidence = readJsonSafe(abs) || { path: args.evidence, note: 'evidência declarada sem JSON legível' };
  }
  const state = advancePhase({ rootDir: ROOT, to, evidence });
  console.log(`[release-phase] advance: -> ${state.currentPhase} (histórico=${state.history.length})`);
  process.exit(0);
}

function commandAssert(args) {
  const phase = args.phase;
  if (!phase) fail('--phase é obrigatório');
  const state = assertPhaseAtLeast({ rootDir: ROOT, phase });
  console.log(`[release-phase] assert: ${state.currentPhase} >= ${phase}`);
  process.exit(0);
}

function commandGate(args) {
  const gateId = args.id;
  if (!gateId) fail('--id é obrigatório');
  if (!Object.prototype.hasOwnProperty.call(RELEASE_GATE_PHASES, gateId)) {
    fail(`gate não declarado no DAG: ${gateId}`, RELEASE_CODES.GATE_REQUIRED_PHASE_MISSING);
  }
  const acceptedValues = args.accept ? String(args.accept).split(',').map((v) => v.trim()).filter(Boolean) : null;
  const evaluate = buildEvaluatorFromReport({
    reportRelPath: args['from-report'] || null,
    statusField: args['status-field'] || 'status',
    acceptedValues,
  });
  const entry = recordGate({ rootDir: ROOT, gateId, evaluate });
  if (entry.status === GATE_STATUS.PENDING_PHASE) {
    console.log(`[release-phase] gate ${gateId}: PENDING_PHASE (exigido em ${entry.requiredPhase}; fase ${entry.evaluatedAtPhase})`);
    process.exit(0);
  }
  if (entry.status === GATE_STATUS.FAIL) {
    fail(`gate ${gateId}: ${entry.code || 'FAIL'} — ${entry.reason || 'sem motivo'}`, entry.code || null);
  }
  console.log(`[release-phase] gate ${gateId}: PASS (${entry.reason || ''})`);
  process.exit(0);
}

function commandReport() {
  const report = writePhaseReport({ rootDir: ROOT });
  console.log(`[release-phase] fase=${report.currentPhase} lane=${report.lane} gateStatus=${report.gateStatus} → ${REPORT_REL_PATH}`);
  if (report.gateStatus === GATE_STATUS.FAIL) {
    fail(`gates reprovados: ${report.failedGates.join(', ')}`, RELEASE_CODES.PENDING_PHASE_PAST_DUE);
  }
  process.exit(0);
}

function usage() {
  console.log([
    'uso: release-phase <comando> [opções]',
    '',
    '  start   [--release <nome>]',
    '  advance --to <FASE> [--evidence <json>]',
    '  assert  --phase <FASE>',
    '  gate    --id <gateId> --from-report <relatório> [--status-field status] [--accept PASS,GO]',
    '  report',
    '',
    `fases: ${RELEASE_PHASES.join(' -> ')}`,
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    switch (command) {
      case 'start': return commandStart(args);
      case 'advance': return commandAdvance(args);
      case 'assert': return commandAssert(args);
      case 'gate': return commandGate(args);
      case 'report': return commandReport();
      case 'help':
      case undefined:
        usage();
        process.exit(command === undefined ? 1 : 0);
        break;
      default:
        fail(`comando desconhecido: ${command}`);
    }
  } catch (error) {
    if (error instanceof ReleaseStateError || error?.code) {
      fail(error.message, error.code || null);
    }
    throw error;
  }
}

main();
