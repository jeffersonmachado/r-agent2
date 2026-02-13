#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const OUTPUT_JSON_PATH = process.env.LAUNCH_PLAN_STATUS_PATH || 'qa/launch-plan-status.json';
const OUTPUT_MD_PATH = process.env.LAUNCH_PLAN_STATUS_MD_PATH || 'qa/launch-plan-status.md';

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
  const smokeOk = smokePasses(smoke);

  const d7 = [
    makeItem(!!gate && gate.status === 'pass', 'Executar gate completo', RELEASE_GATE_REPORT_PATH),
    makeItem(smokeOk, 'Validar L-01..L-05 em pass', SMOKE_EVIDENCE_SUMMARY_PATH),
  ];

  const d1 = [
    makeItem(!!goNoGo && goNoGo.decision === 'GO', 'Executar decisão consolidada', GO_NO_GO_REPORT_PATH),
    makeItem(!!drill && drill.status === 'pass', 'Executar rollback drill', ROLLBACK_DRILL_REPORT_PATH),
    makeItem(!!gate && gate.status === 'pass', 'Revalidar release gate', RELEASE_GATE_REPORT_PATH),
  ];

  const d0 = [
    makeItem(!!gate && gate.status === 'pass', 'Smoke pós-release em pass', RELEASE_GATE_REPORT_PATH),
    makeItem(smokeOk, 'Operação mínima por suíte (L-01..L-05)', SMOKE_EVIDENCE_SUMMARY_PATH),
    makeItem(!!goNoGo && goNoGo.decision === 'GO', 'Evidência final de GO', GO_NO_GO_REPORT_PATH),
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
    sources: {
      releaseGate: RELEASE_GATE_REPORT_PATH,
      rollbackDrill: ROLLBACK_DRILL_REPORT_PATH,
      smokeEvidence: SMOKE_EVIDENCE_SUMMARY_PATH,
      goNoGo: GO_NO_GO_REPORT_PATH,
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
