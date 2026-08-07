#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { evaluatePillars } = require('./lib/pillar-readiness');
const { runtimeAwarePath, resolveWorkspacePath, resolveEvidenceCandidates } = require('./lib/runtime-paths');
const { buildReport: buildPlatformReadinessReport, persistReport: persistPlatformReadinessReport } = require('./platform-readiness');
const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernanceWithMirror,
} = require('./lib/qa-waves-enterprise-governance-bridge');

const ROOT = path.join(__dirname, '..', '..');
const SYSTEM_VALIDATE_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/system-validate-report.json', 'SYSTEM_VALIDATE_REPORT_PATH');
const RELEASE_GATE_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/release-gate-report.json', 'RELEASE_GATE_REPORT_PATH');
const ROLLBACK_DRILL_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/rollback-drill-report.json', 'ROLLBACK_DRILL_REPORT_PATH');
const SMOKE_EVIDENCE_SUMMARY_PATH = runtimeAwarePath(ROOT, 'qa/smoke-evidence.json', 'SMOKE_EVIDENCE_SUMMARY_PATH');
const GO_NO_GO_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/go-no-go-report.json', 'GO_NO_GO_REPORT_PATH');
const RUNTIME_GOVERNANCE_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/runtime-governance-report.json', 'RUNTIME_GOVERNANCE_REPORT_PATH');
const DEPLOY_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/deploy-report.json', 'SYSTEM_DEPLOY_REPORT_PATH');
const PLATFORM_READINESS_REPORT_PATH = runtimeAwarePath(ROOT, 'governance/final-readiness-report.json', 'PLATFORM_READINESS_REPORT_PATH');
const QA_WAVES_ENTERPRISE_GOVERNANCE_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-enterprise-governance.json', 'QA_WAVES_ENTERPRISE_GOVERNANCE_PATH');
const QA_WAVES_GOVERNANCE_AUDIT_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-governance-audit.jsonl', 'QA_WAVES_GOVERNANCE_AUDIT_PATH');
const WORKSPACE_QA_WAVES_ENTERPRISE_GOVERNANCE_PATH = path.join(ROOT, 'qa', 'qa-waves-enterprise-governance.json');
const WORKSPACE_QA_WAVES_GOVERNANCE_AUDIT_PATH = path.join(ROOT, 'qa', 'qa-waves-governance-audit.jsonl');
const RUN_RELEASE_GATE = String(process.env.GO_NO_GO_RUN_RELEASE_GATE || '0') !== '0';
const RUN_ROLLBACK_DRILL = String(process.env.GO_NO_GO_RUN_ROLLBACK_DRILL || '0') !== '0';
const ROLLBACK_WITH_STACK = String(process.env.GO_NO_GO_ROLLBACK_WITH_STACK || '1') !== '0';

function readJsonState(relPath) {
  const candidates = resolveEvidenceCandidates(ROOT, relPath, null);
  const preferredPath = candidates[0] || resolveWorkspacePath(ROOT, relPath);

  for (const abs of candidates) {
    if (!fs.existsSync(abs)) {
      continue;
    }
    try {
      return {
        data: JSON.parse(fs.readFileSync(abs, 'utf8')),
        sourcePath: abs,
        preferredPath,
      };
    } catch (_) {
      return {
        data: null,
        sourcePath: abs,
        preferredPath,
      };
    }
  }

  return {
    data: null,
    sourcePath: null,
    preferredPath,
  };
}

function mirrorLoadedArtifact(state) {
  if (!state || !state.data || !state.sourcePath || !state.preferredPath) {
    return;
  }

  if (state.sourcePath === state.preferredPath || fs.existsSync(state.preferredPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(state.preferredPath), { recursive: true });
  fs.copyFileSync(state.sourcePath, state.preferredPath);
}

function runStep(command, label) {
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return { label, command, status: 'pass' };
}

function runRollbackDrillStep() {
  if (!ROLLBACK_WITH_STACK) {
    return runStep('node tools/system/rollback-drill.js', 'rollback-drill');
  }

  const command = [
    'bash -lc',
    '\'set -euo pipefail;',
    'cleanup(){ bash scripts/test-stack-down.sh || true; };',
    'trap cleanup EXIT;',
    'bash scripts/test-stack-up.sh;',
    'bash scripts/wait-ready.sh;',
    'ROLLBACK_DRILL_API_URL="${ROLLBACK_DRILL_API_URL:-http://localhost:13001}"',
    'TEST_TENANT_ID="${TEST_TENANT_ID:-system}"',
    'node tools/system/rollback-drill.js\'',
  ].join(' ');

  return runStep(command, 'rollback-drill');
}

function writeReport(report) {
  const abs = resolveWorkspacePath(ROOT, GO_NO_GO_REPORT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    decision: 'NO_GO',
    steps: [],
    checks: {
      validate: null,
      releaseGate: null,
      rollbackDrill: null,
      smoke: null,
      runtimeGovernance: null,
      deploy: null,
      platformReadiness: null,
      qaWavesGovernance: null,
    },
    reasons: [],
  };

  try {
    if (RUN_RELEASE_GATE) {
      report.steps.push(runStep('node tools/system/release-gate.js', 'release-gate'));
    } else {
      report.steps.push({ label: 'release-gate', command: 'node tools/system/release-gate.js', status: 'skipped' });
    }

    if (RUN_ROLLBACK_DRILL) {
      report.steps.push(runRollbackDrillStep());
    } else {
      report.steps.push({ label: 'rollback-drill', command: 'node tools/system/rollback-drill.js', status: 'skipped' });
    }

    const validateState = readJsonState(SYSTEM_VALIDATE_REPORT_PATH);
    const gateState = readJsonState(RELEASE_GATE_REPORT_PATH);
    const drillState = readJsonState(ROLLBACK_DRILL_REPORT_PATH);
    const smokeState = readJsonState(SMOKE_EVIDENCE_SUMMARY_PATH);
    const runtimeGovernanceState = readJsonState(RUNTIME_GOVERNANCE_REPORT_PATH);
    const deployState = readJsonState(DEPLOY_REPORT_PATH);
    const validateReport = validateState.data;
    const gate = gateState.data;
    const drill = drillState.data;
    const smokeSummary = smokeState.data;
    const runtimeGovernance = runtimeGovernanceState.data;
    const deployReport = deployState.data;

    mirrorLoadedArtifact(validateState);
    mirrorLoadedArtifact(gateState);
    mirrorLoadedArtifact(drillState);
    mirrorLoadedArtifact(smokeState);
    mirrorLoadedArtifact(runtimeGovernanceState);
    mirrorLoadedArtifact(deployState);
    const platformReadinessReport = buildPlatformReadinessReport();
    persistPlatformReadinessReport(platformReadinessReport);
    const qaWavesReport = writeQaWavesEnterpriseGovernanceWithMirror(
      buildQaWavesEnterpriseGovernance({ root: ROOT }),
      resolveWorkspacePath(ROOT, QA_WAVES_ENTERPRISE_GOVERNANCE_PATH),
      resolveWorkspacePath(ROOT, QA_WAVES_GOVERNANCE_AUDIT_PATH),
      {
        workspaceMirrorPath: WORKSPACE_QA_WAVES_ENTERPRISE_GOVERNANCE_PATH,
        workspaceAuditPath: WORKSPACE_QA_WAVES_GOVERNANCE_AUDIT_PATH,
      }
    );
    const qaWavesValidation = validateQaWavesEnterpriseGovernance(qaWavesReport);

    report.checks.validate = {
      path: SYSTEM_VALIDATE_REPORT_PATH,
      loaded: !!validateReport,
      status: validateReport?.status || 'missing',
      result: validateReport?.result || 'missing',
    };

    report.checks.releaseGate = {
      path: RELEASE_GATE_REPORT_PATH,
      loaded: !!gate,
      status: gate?.status || 'missing',
    };
    report.checks.rollbackDrill = {
      path: ROLLBACK_DRILL_REPORT_PATH,
      loaded: !!drill,
      status: drill?.status || 'missing',
    };
    report.checks.runtimeGovernance = {
      path: RUNTIME_GOVERNANCE_REPORT_PATH,
      loaded: !!runtimeGovernance,
      status: runtimeGovernance?.gateStatus || 'missing',
      classification: runtimeGovernance?.classification || 'missing',
    };
    report.checks.deploy = {
      path: DEPLOY_REPORT_PATH,
      loaded: !!deployReport,
      status: deployReport?.status || 'missing',
      artifact: deployReport?.artifact?.name || 'missing',
      portResolution: Array.isArray(deployReport?.portResolution) ? deployReport.portResolution : [],
      optional: true,
    };
    report.checks.platformReadiness = {
      path: PLATFORM_READINESS_REPORT_PATH,
      loaded: true,
      status: platformReadinessReport.finalDecision,
      platformMaturity: platformReadinessReport.platformMaturity,
      blockingGaps: platformReadinessReport.blockingGaps.length,
      missingProofs: platformReadinessReport.enterpriseReadiness?.missingProofs || [],
    };
    report.checks.qaWavesGovernance = {
      path: QA_WAVES_ENTERPRISE_GOVERNANCE_PATH,
      loaded: true,
      status: qaWavesReport.governanceStatus,
      operationalConfidence: qaWavesReport.operationalConfidence,
      confidenceGrade: qaWavesReport.confidenceGrade,
      riskLevel: qaWavesReport.riskLevel,
      valid: qaWavesValidation.valid,
      reasons: qaWavesValidation.reasons,
    };

    if (!validateReport || !['pass', 'degraded'].includes(validateReport.status)) report.reasons.push('system_validate_not_releasable');
    if (!gate || gate.status !== 'pass') report.reasons.push('release_gate_not_pass');
    if (!drill || drill.status !== 'pass') report.reasons.push('rollback_drill_not_pass');
    // O proof engine emite decisões granulares (GO, ENTERPRISE_READY_GO,
    // AUTONOMOUS_READY_GO, NO_GO:...). Bloqueia apenas NO_GO:/PENDING/ausente.
    const readinessDecision = String(platformReadinessReport.finalDecision || 'NO_GO:UNKNOWN');
    if (readinessDecision.startsWith('NO_GO') || readinessDecision === 'PENDING') {
      report.reasons.push(`platform_readiness_${String(platformReadinessReport.platformMaturity || 'unknown').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`);
      for (const gap of platformReadinessReport.blockingGaps.slice(0, 10)) {
        report.reasons.push(`platform_gap:${gap.id}`);
      }
    }

    if (!runtimeGovernance) {
      report.reasons.push('runtime_governance_missing');
    } else if (runtimeGovernance.gateStatus === 'no_go') {
      report.reasons.push(`runtime_mode_blocked:${runtimeGovernance.classification || 'unknown'}`);
    }

    if (!qaWavesValidation.valid) {
      report.reasons.push(...qaWavesValidation.reasons);
    }

    if (!smokeSummary || !smokeSummary.smokes) {
      report.checks.smoke = {
        path: SMOKE_EVIDENCE_SUMMARY_PATH,
        loaded: false,
        status: 'missing',
      };
      report.reasons.push('smoke_evidence_missing');
    } else {
      const smokeCheck = evaluatePillars(smokeSummary.smokes);
      report.checks.smoke = {
        path: SMOKE_EVIDENCE_SUMMARY_PATH,
        loaded: true,
        status: smokeCheck.ok ? 'pass' : 'fail',
        pbx: smokeCheck.pillars.pbx.l03,
        pillars: smokeCheck.pillars,
        reasons: smokeCheck.reasons,
      };
      if (!smokeCheck.ok) {
        report.reasons.push(...smokeCheck.reasons);
      }
    }

    if (!RUN_ROLLBACK_DRILL) {
      report.checks.rollbackDrill.optional = true;
      report.reasons = report.reasons.filter((reason) => reason !== 'rollback_drill_not_pass');
    }

    if (report.reasons.length === 0) {
      if ((runtimeGovernance && runtimeGovernance.gateStatus === 'go_degraded') || validateReport?.status === 'degraded') {
        report.status = 'degraded';
        report.decision = 'GO_DEGRADED';
      } else {
        report.status = 'pass';
        report.decision = 'GO';
      }
    } else {
      report.status = 'fail';
      report.decision = 'NO_GO';
    }
  } catch (err) {
    report.status = 'fail';
    report.decision = 'NO_GO';
    report.reasons.push(err && err.message ? err.message : String(err));
  }

  report.finishedAt = new Date().toISOString();
  writeReport(report);

  if (report.decision === 'GO' || report.decision === 'GO_DEGRADED') {
    // eslint-disable-next-line no-console
    console.log(`[go-no-go] GO report=${GO_NO_GO_REPORT_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[go-no-go] NO_GO reasons=${report.reasons.join(',')} report=${GO_NO_GO_REPORT_PATH}`);
  process.exit(1);
}

main();
