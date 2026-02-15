#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SMOKE_EVIDENCE_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const OUTPUT_PATH = process.env.RELEASE_SUITE_CONFIRMATION_PATH || 'qa/release-suite-confirmation.json';

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function suiteStatus(ok, label, detail) {
  return {
    ok: !!ok,
    label,
    detail,
    status: ok ? 'pass' : 'fail',
  };
}

function main() {
  const smoke = readJson(SMOKE_EVIDENCE_PATH);
  const gate = readJson(RELEASE_GATE_REPORT_PATH);
  const smokes = smoke && smoke.smokes ? smoke.smokes : {};

  const report = {
    generatedAt: new Date().toISOString(),
    status: 'pass',
    sources: {
      smokeEvidence: SMOKE_EVIDENCE_PATH,
      releaseGate: RELEASE_GATE_REPORT_PATH,
    },
    suites: {
      fastService: suiteStatus(
        smokes.l01 && smokes.l01.status === 'pass',
        'Fast service (kiosk/panel/station)',
        'qa/l01-physical-queue-evidence.json'
      ),
      ordersDelivery: suiteStatus(
        smokes.l02 && smokes.l02.status === 'pass',
        'Orders/Delivery (create/order lifecycle/status)',
        'qa/l02-ura-publish-rollback-evidence.json'
      ),
      pbxVoice: suiteStatus(
        smokes.l03 && smokes.l03.status === 'pass' && smokes.l04 && smokes.l04.status === 'pass',
        'PBX/Voz (dialplan/runtime/eventos)',
        'qa/l03-pbx-voice-tts-asr-evidence.json + qa/l04-pbx-call-events-runtime-evidence.json'
      ),
      chatPro: suiteStatus(
        smokes.l05 && smokes.l05.status === 'pass',
        'ChatPro/omnichannel',
        'qa/l05-chatpro-omnichannel-evidence.json'
      ),
    },
    checks: {
      releaseGatePass: gate && gate.status === 'pass',
    },
    reasons: [],
  };

  if (!report.checks.releaseGatePass) report.reasons.push('release_gate_not_pass');
  Object.values(report.suites).forEach((suite) => {
    if (!suite.ok) report.reasons.push(`${suite.label}:not_pass`);
  });

  if (report.reasons.length > 0) report.status = 'fail';

  const abs = path.join(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.status === 'pass') {
    // eslint-disable-next-line no-console
    console.log(`[release-suite-confirm] PASS path=${OUTPUT_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[release-suite-confirm] FAIL reasons=${report.reasons.join(',')} path=${OUTPUT_PATH}`);
  process.exit(1);
}

main();
