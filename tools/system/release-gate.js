#!/usr/bin/env node
'use strict';

/**
 * Gate oficial de release (bloco 3/4).
 *
 * Consome apenas as evidências já produzidas pelo fluxo oficial:
 * 1) system-validate-report.json
 * 2) smoke-evidence.json
 * 3) runtime-governance-report.json
 * 4) artefato auditado em dist/
 */

const path = require('path');
const fs = require('fs');
const { evaluatePillars } = require('./lib/pillar-readiness');
const { findLatestReleaseArtifact } = require('./lib/release-artifact');

const ROOT = path.join(__dirname, '..', '..');
const SYSTEM_VALIDATE_REPORT_PATH = process.env.SYSTEM_VALIDATE_REPORT_PATH || 'qa/system-validate-report.json';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const RUNTIME_GOVERNANCE_REPORT_PATH = process.env.RUNTIME_GOVERNANCE_REPORT_PATH || 'qa/runtime-governance-report.json';

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

function readJsonStrict(relPath, label) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`${label}_missing:${relPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw new Error(`${label}_invalid:${relPath}:${error.message || error}`);
  }
}

function checkReleaseArtifact() {
  const artifact = findLatestReleaseArtifact({ requireAuditPassed: true });
  log(COLORS.green, `[release-gate] OK: artefato auditado — ${artifact.zip} (sha256: ${String(artifact.manifest.sha256 || 'n/a').slice(0, 16)}...)`);
  return {
    status: 'ok',
    artifact: artifact.zip,
    manifestPath: path.relative(ROOT, artifact.manifestPath),
    sha256: artifact.manifest.sha256,
    generatedAt: artifact.manifest.generated_at || artifact.manifest.generatedAt || null,
  };
}

function writeReport(report) {
  const relPath = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
  const absPath = path.join(ROOT, relPath);
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(COLORS.blue, `[release-gate] Report: ${relPath}`);
}

function validateMandatorySteps(validateReport) {
  const requiredLabels = ['backend unit', 'frontend unit', 'frontend build', 'frontend smoke', 'qa mesh'];
  const steps = Array.isArray(validateReport.steps) ? validateReport.steps : [];
  for (const label of requiredLabels) {
    const match = steps.find((step) => step && step.label === label);
    if (!match) {
      throw new Error(`validate_step_missing:${label}`);
    }
    if (match.status !== 'pass') {
      throw new Error(`validate_step_not_pass:${label}:${match.status}`);
    }
  }
}

function main() {
  log(COLORS.blue, '[release-gate] Iniciando gate de release...');

  const report = {
    startedAt: new Date().toISOString(),
    status: 'running',
    artifactCheck: null,
    validate: null,
    smokeEvidence: null,
    runtimeGovernance: null,
    error: null,
    finishedAt: null,
    durationMs: 0,
  };
  const gateStartedAt = Date.now();

  try {
    report.artifactCheck = checkReleaseArtifact();

    const validateReport = readJsonStrict(SYSTEM_VALIDATE_REPORT_PATH, 'system_validate_report');
    validateMandatorySteps(validateReport);
    report.validate = {
      path: SYSTEM_VALIDATE_REPORT_PATH,
      status: validateReport.status,
      result: validateReport.result,
    };
    if (!['pass', 'degraded'].includes(validateReport.status)) {
      throw new Error(`validate_status_not_releasable:${validateReport.status}`);
    }

    const smokeSummary = readJsonStrict(SMOKE_EVIDENCE_SUMMARY_PATH, 'smoke_evidence');
    const pillars = evaluatePillars(smokeSummary.smokes || {});
    report.smokeEvidence = {
      path: SMOKE_EVIDENCE_SUMMARY_PATH,
      ok: pillars.ok,
      reasons: pillars.reasons,
      pillars: pillars.pillars,
    };
    if (!pillars.ok) {
      throw new Error(`smoke_pillars_not_ready:${pillars.reasons.join(',')}`);
    }

    const runtimeGovernance = readJsonStrict(RUNTIME_GOVERNANCE_REPORT_PATH, 'runtime_governance_report');
    report.runtimeGovernance = {
      path: RUNTIME_GOVERNANCE_REPORT_PATH,
      classification: runtimeGovernance.classification,
      gateStatus: runtimeGovernance.gateStatus,
      issues: runtimeGovernance.issues || [],
    };
    if (runtimeGovernance.gateStatus === 'no_go') {
      throw new Error(`runtime_mode_blocked:${runtimeGovernance.classification}`);
    }
    if (runtimeGovernance.gateStatus === 'go_degraded' && String(process.env.RELEASE_GATE_ALLOW_DEGRADED || '1') !== '1') {
      throw new Error(`runtime_mode_degraded_not_allowed:${runtimeGovernance.classification}`);
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
