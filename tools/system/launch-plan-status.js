#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { evaluatePillars } = require('./lib/pillar-readiness');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RELEASE_DECISION_PATH = process.env.RELEASE_DECISION_PATH || 'qa/release-decision.json';
const RELEASE_WINDOW_REPORT_PATH = process.env.RELEASE_WINDOW_REPORT_PATH || 'qa/release-window-report.json';
const OUTPUT_JSON_PATH = process.env.LAUNCH_PLAN_STATUS_PATH || 'qa/launch-plan-status.json';
const OUTPUT_MD_PATH = process.env.LAUNCH_PLAN_STATUS_MD_PATH || 'qa/launch-plan-status.md';
const ALLOW_PENDING_RELEASE_WINDOW = String(process.env.LAUNCH_PLAN_ALLOW_PENDING_RELEASE_WINDOW || '0') === '1';

function readJson(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function smokePasses(smokeData) {
  const smokes = smokeData && smokeData.smokes ? smokeData.smokes : {};
  const keys = ['l01', 'l02', 'l03', 'l04', 'l05'];
  return keys.every((k) => smokes[k] && smokes[k].status === 'pass');
}

function makeItem(done, label, detail) {
  return { done, label, detail };
}

function buildStatus() {
  const gate = readJson(RELEASE_GATE_REPORT_PATH);
  const drill = readJson(ROLLBACK_DRILL_REPORT_PATH);
  const smoke = readJson(SMOKE_EVIDENCE_SUMMARY_PATH);
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const releaseDecision = readJson(RELEASE_DECISION_PATH);
  const releaseWindow = readJson(RELEASE_WINDOW_REPORT_PATH);
  const smokeOk = smokePasses(smoke);
  const pillars = smoke && smoke.smokes ? evaluatePillars(smoke.smokes) : null;
  const chatproOk = pillars?.pillars?.chatpro?.ok === true;
  const queueOk = pillars?.pillars?.queue?.ok === true;
  const pbxOk = pillars?.pillars?.pbx?.ok === true;
  const rollbackOk = !!drill && drill.status === 'pass';
  const goNoGoOk = !!goNoGo && goNoGo.decision === 'GO';
  const releaseDecisionOk = !!releaseDecision && releaseDecision.status === 'pass' && releaseDecision.decision === 'GO';
  const releaseScopeFrozen = !!releaseDecision && releaseDecision.scope && releaseDecision.scope.frozen === true;
  const releaseOwnersConfirmed = !!releaseDecision
    && !!releaseDecision.candidate
    && !!releaseDecision.candidate.branch
    && !!releaseDecision.candidate.tag
    && !!releaseDecision.owners
    && !!releaseDecision.owners.engineering
    && !!releaseDecision.owners.operations;
  const gateOk = !!gate && gate.status === 'pass';
  const releaseWindowOk = ALLOW_PENDING_RELEASE_WINDOW
    ? !!releaseWindow
    : !!releaseWindow && releaseWindow.status === 'pass';

  const d7 = [
    makeItem(gateOk, 'Executar gate completo', RELEASE_GATE_REPORT_PATH),
    makeItem(smokeOk, 'Validar L-01..L-05 em pass', SMOKE_EVIDENCE_SUMMARY_PATH),
    makeItem(releaseScopeFrozen, 'Congelar escopo da release', `${RELEASE_DECISION_PATH}#scope`),
    makeItem(releaseOwnersConfirmed, 'Confirmar branch/tag candidata e owners de plantao', `${RELEASE_DECISION_PATH}#candidate-owners`),
    makeItem(chatproOk, 'ChatPro com evidência operacional', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l05`),
    makeItem(queueOk, 'Fila física com jornada completa', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l01`),
    makeItem(pbxOk, 'PBX TTS/ASR + call events com runtime', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l03-l04`),
  ];

  const d1 = [
    makeItem(goNoGoOk, 'Executar decisão consolidada', GO_NO_GO_REPORT_PATH),
    makeItem(releaseDecisionOk, 'Formalizar decisão go/no-go (data/hora/responsáveis)', RELEASE_DECISION_PATH),
    makeItem(rollbackOk, 'Executar rollback drill', ROLLBACK_DRILL_REPORT_PATH),
    makeItem(gateOk, 'Revalidar release gate', RELEASE_GATE_REPORT_PATH),
    makeItem(chatproOk, 'ChatPro sem divergência mensagem/ticket/SLA', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l05`),
    makeItem(queueOk, 'Fila física (call/start/pause/resume/finish/skip/transfer)', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l01`),
    makeItem(pbxOk, 'PBX com originated + trigger de runtime', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l03-l04`),
  ];

  const d0 = [
    makeItem(gateOk, 'Smoke pós-release em pass', RELEASE_GATE_REPORT_PATH),
    makeItem(smokeOk, 'Operação mínima por suíte (L-01..L-05)', SMOKE_EVIDENCE_SUMMARY_PATH),
    makeItem(goNoGoOk, 'Evidência final de GO', GO_NO_GO_REPORT_PATH),
    makeItem(releaseWindowOk, 'Janela de release executada', RELEASE_WINDOW_REPORT_PATH),
    makeItem(chatproOk, 'ChatPro pós-release em pass', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l05`),
    makeItem(queueOk, 'Fila física pós-release em pass', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l01`),
    makeItem(pbxOk, 'PBX TTS/ASR pós-release em pass', `${SMOKE_EVIDENCE_SUMMARY_PATH}#l03-l04`),
  ];

  const doneCount = [...d7, ...d1, ...d0].filter((i) => i.done).length;
  const totalCount = d7.length + d1.length + d0.length;
  const overall = doneCount === totalCount ? 'ready' : 'pending';

  return {
    generatedAt: new Date().toISOString(),
    overall,
    summary: {
      done: doneCount,
      total: totalCount,
      progressPct: Math.round((doneCount / totalCount) * 100),
    },
    milestones: {
      d7,
      d1,
      d0,
    },
    pillars: pillars ? pillars.pillars : null,
    sources: {
      releaseGate: RELEASE_GATE_REPORT_PATH,
      rollbackDrill: ROLLBACK_DRILL_REPORT_PATH,
      smokeEvidence: SMOKE_EVIDENCE_SUMMARY_PATH,
      goNoGo: GO_NO_GO_REPORT_PATH,
      releaseDecision: RELEASE_DECISION_PATH,
      releaseWindow: RELEASE_WINDOW_REPORT_PATH,
    },
  };
}

function toMarkdown(status) {
  const title = '# Launch Plan Status (D-7 / D-1 / D0)';
  const summary = `- Generated at: ${status.generatedAt}
- Overall: ${status.overall.toUpperCase()}
- Progress: ${status.summary.done}/${status.summary.total} (${status.summary.progressPct}%)`;

  function section(name, items) {
    const lines = [`## ${name}`];
    for (const item of items) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.label} (${item.detail})`);
    }
    return lines.join('\n');
  }

  return [
    title,
    '',
    summary,
    '',
    section('D-7', status.milestones.d7),
    '',
    section('D-1', status.milestones.d1),
    '',
    section('D0', status.milestones.d0),
    '',
  ].join('\n');
}

function writeOutputs(status) {
  const jsonAbs = path.join(ROOT, OUTPUT_JSON_PATH);
  const mdAbs = path.join(ROOT, OUTPUT_MD_PATH);
  fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
  fs.mkdirSync(path.dirname(mdAbs), { recursive: true });
  fs.writeFileSync(jsonAbs, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdAbs, toMarkdown(status), 'utf8');
}

function main() {
  const status = buildStatus();
  writeOutputs(status);
  // eslint-disable-next-line no-console
  console.log(`[launch-plan-status] overall=${status.overall} progress=${status.summary.done}/${status.summary.total}`);
  process.exit(status.overall === 'ready' ? 0 : 1);
}

main();
