#!/usr/bin/env node
'use strict';

/**
 * Gate oficial de release (bloco 3/4).
 *
 * Modo padrão (RELEASE_GATE_MODE=stack):
 * 1) bash scripts/system-autotest-stack.sh
 *    (já inclui validação oficial + selftest read-only dentro da stack)
 *
 * Modo legado (RELEASE_GATE_MODE=legacy):
 * 1) npm run test:unit
 * 2) node tools/system/validate.js
 * 3) node scripts/autotest.js
 * 4) bash scripts/system-autotest-stack.sh
 * 5) GET /health/selftest (não pode FAIL; checks obrigatórios sem unhealthy)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(color, msg) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

function runStep(command, label) {
  log(COLORS.blue, `[release-gate] ${label}`);
  const startedAt = Date.now();
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  log(COLORS.green, `[release-gate] OK: ${label}`);
  return { label, command, status: 'pass', durationMs };
}

function parseRequiredChecks() {
  const raw = process.env.RELEASE_GATE_REQUIRED_CHECKS || 'eventDispatchRuntime,pbxEventRuntime,voiceRuntime';
  return raw
    .split(',')
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

async function verifySelftest() {
  const selftestUrl = process.env.SELFTEST_URL || 'http://localhost:3000/health/selftest';
  const requiredChecks = parseRequiredChecks();

  log(COLORS.blue, `[release-gate] Verificando selftest em ${selftestUrl}`);
  const res = await fetch(selftestUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`selftest_http_${res.status}`);
  }
  const body = await res.json();
  const status = String(body?.status || '').toUpperCase();
  if (status === 'FAIL') {
    throw new Error('selftest_status_fail');
  }

  const checks = body?.checks && typeof body.checks === 'object' ? body.checks : {};
  for (const key of requiredChecks) {
    const item = checks[key];
    if (!item || typeof item !== 'object') {
      throw new Error(`selftest_missing_check:${key}`);
    }
    const cStatus = String(item.status || '').toLowerCase();
    if (cStatus === 'unhealthy') {
      throw new Error(`selftest_unhealthy_check:${key}`);
    }
  }
  log(COLORS.green, `[release-gate] OK: selftest=${status}, checks=${requiredChecks.join(',')}`);
  return { url: selftestUrl, status, requiredChecks };
}

function writeReport(report) {
  const relPath = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
  const absPath = path.join(ROOT, relPath);
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(COLORS.blue, `[release-gate] Report: ${relPath}`);
}

function loadSmokeEvidenceSummary() {
  const relPath = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    return { path: relPath, found: false, data: null };
  }
  try {
    const data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    return { path: relPath, found: true, data };
  } catch (err) {
    return { path: relPath, found: true, parseError: err.message || String(err), data: null };
  }
}

function assertCriticalSmokeEvidence(evidence) {
  if (!evidence?.found || !evidence?.data?.smokes) {
    throw new Error('smoke_evidence_missing');
  }
  const l02 = evidence.data.smokes.l02 || null;
  const l03 = evidence.data.smokes.l03 || null;
  const l04 = evidence.data.smokes.l04 || null;
  const l05 = evidence.data.smokes.l05 || null;
  if (!l02 || l02.status !== 'pass') {
    throw new Error('smoke_l02_not_pass');
  }
  if (!l03 || l03.status !== 'pass') {
    throw new Error('smoke_l03_not_pass');
  }
  if (
    !l03.evidence
    || l03.evidence.ok !== true
    || !l03.evidence.realCall
    || l03.evidence.realCall.attempted !== true
    || String(l03.evidence.realCall.click2callStatus || '').toLowerCase() !== 'originated'
  ) {
    throw new Error('smoke_l03_real_call_evidence_missing');
  }
  if (!l04 || l04.status !== 'pass') {
    throw new Error('smoke_l04_not_pass');
  }
  if (
    !l04.evidence
    || l04.evidence.ok !== true
    || !l04.evidence.flow
    || !String(l04.evidence.flow.executionId || '').trim()
    || Number(l04.evidence.flow.nodesCount || 0) <= 0
  ) {
    throw new Error('smoke_l04_runtime_evidence_missing');
  }
  if (
    !l04.evidence.pipeline
    || !l04.evidence.pipeline.queue
    || Number(l04.evidence.pipeline.queue.jobsDone || 0) <= 0
    || Number(l04.evidence.pipeline.queue.jobsDead || 0) !== 0
  ) {
    throw new Error('smoke_l04_queue_evidence_missing');
  }
  if (!l05 || l05.status !== 'pass') {
    throw new Error('smoke_l05_not_pass');
  }
  if (
    !l05.evidence
    || l05.evidence.ok !== true
    || !l05.evidence.ticket
    || !String(l05.evidence.ticket.id || '').trim()
    || !l05.evidence.operations
    || l05.evidence.operations.assign !== true
    || l05.evidence.operations.transfer !== true
    || l05.evidence.operations.note !== true
    || l05.evidence.operations.addTag !== true
    || l05.evidence.operations.removeTag !== true
    || l05.evidence.operations.quickReplyCreate !== true
    || l05.evidence.operations.quickReplyUse !== true
    || l05.evidence.operations.quickReplyList !== true
  ) {
    throw new Error('smoke_l05_omnichannel_evidence_missing');
  }
}

async function main() {
  log(COLORS.blue, '[release-gate] Iniciando gate de release...');

  const gateMode = String(process.env.RELEASE_GATE_MODE || 'stack').trim().toLowerCase();
  const skipStack = process.env.RELEASE_GATE_SKIP_STACK === '1';
  const report = {
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: [],
    selftest: null,
    smokeEvidence: null,
    error: null,
    finishedAt: null,
    durationMs: 0,
  };
  const gateStartedAt = Date.now();

  try {
    if (gateMode === 'stack') {
      if (skipStack) {
        throw new Error('invalid_gate_config: RELEASE_GATE_MODE=stack requer RELEASE_GATE_SKIP_STACK!=1');
      }
      report.steps.push(runStep('bash scripts/system-autotest-stack.sh', 'autotest de stack (validação completa)'));
      report.smokeEvidence = loadSmokeEvidenceSummary();
      assertCriticalSmokeEvidence(report.smokeEvidence);
      report.selftest = {
        status: 'validated_in_stack',
        info: 'Selftest já validado dentro de scripts/system-autotest-stack.sh',
      };
    } else if (gateMode === 'legacy') {
      report.steps.push(runStep('npm run test:unit', 'testes unitários'));
      report.steps.push(runStep('node tools/system/validate.js', 'validação oficial do sistema'));
      report.steps.push(runStep('node scripts/autotest.js', 'autotest com veredito'));
      if (!skipStack) {
        report.steps.push(runStep('bash scripts/system-autotest-stack.sh', 'autotest de stack'));
        report.smokeEvidence = loadSmokeEvidenceSummary();
        assertCriticalSmokeEvidence(report.smokeEvidence);
      } else {
        log(COLORS.yellow, '[release-gate] RELEASE_GATE_SKIP_STACK=1 -> pulando system-autotest-stack');
        report.steps.push({
          label: 'autotest de stack',
          command: 'bash scripts/system-autotest-stack.sh',
          status: 'skipped',
          durationMs: 0,
          reason: 'RELEASE_GATE_SKIP_STACK=1',
        });
        report.smokeEvidence = { status: 'skipped', reason: 'stack_skipped' };
      }
      report.selftest = await verifySelftest();
    } else {
      throw new Error(`invalid_gate_mode:${gateMode}`);
    }

    report.status = 'pass';
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - gateStartedAt;
    writeReport(report);
    log(COLORS.green, '[release-gate] ✅ RELEASE GATE PASS');
    process.exit(0);
  } catch (err) {
    report.status = 'fail';
    report.error = err.message || String(err);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - gateStartedAt;
    writeReport(report);
    log(COLORS.red, `[release-gate] ❌ RELEASE GATE FAIL: ${err.message || err}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
