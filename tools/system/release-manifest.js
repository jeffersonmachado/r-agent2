#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findLatestReleaseArtifact, updateArtifactManifest } = require('./lib/release-artifact');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_PATH = process.env.RELEASE_MANIFEST_PATH || 'qa/release-manifest.json';
const SYSTEM_VALIDATE_REPORT_PATH = process.env.SYSTEM_VALIDATE_REPORT_PATH || 'qa/system-validate-report.json';
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RUNTIME_GOVERNANCE_REPORT_PATH = process.env.RUNTIME_GOVERNANCE_REPORT_PATH || 'qa/runtime-governance-report.json';
const DEPLOY_REPORT_PATH = process.env.SYSTEM_DEPLOY_REPORT_PATH || 'qa/deploy-report.json';

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, error: 'missing', data: null };
  }
  try {
    return { ok: true, error: null, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message || String(error), data: null };
  }
}

function runGit(args, fallback = '') {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').trim();
  } catch (err) {
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return String(err.stdout || '').trim();
    }
    return fallback;
  }
}

function buildManifest() {
  const validate = readJson(SYSTEM_VALIDATE_REPORT_PATH);
  const releaseGate = readJson(RELEASE_GATE_REPORT_PATH);
  const rollbackDrill = readJson(ROLLBACK_DRILL_REPORT_PATH);
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const runtimeGovernance = readJson(RUNTIME_GOVERNANCE_REPORT_PATH);
  const deployReport = readJson(DEPLOY_REPORT_PATH);
  const artifact = findLatestReleaseArtifact({ requireAuditPassed: true });

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
  const commit = runGit(['rev-parse', 'HEAD'], 'unknown');
  const shortCommit = runGit(['rev-parse', '--short', 'HEAD'], 'unknown');
  const tag = runGit(['describe', '--tags', '--exact-match'], '');
  const dirty = runGit(['status', '--porcelain'], '') !== '';

  const gatePass = releaseGate.ok && releaseGate.data.status === 'pass';
  const drillPass = rollbackDrill.ok && rollbackDrill.data.status === 'pass';
  const go = goNoGo.ok && goNoGo.data.decision === 'GO';
  const goDegraded = goNoGo.ok && goNoGo.data.decision === 'GO_DEGRADED';
  const validatePass = validate.ok && ['pass', 'degraded'].includes(validate.data.status);
  const runtimeStatus = runtimeGovernance.ok ? runtimeGovernance.data.gateStatus : 'missing';

  const decision = gatePass && validatePass && (go || goDegraded)
    ? (goDegraded ? 'READY_DEGRADED' : 'READY')
    : 'BLOCKED';

  updateArtifactManifest(artifact.zip, {
    goNoGo: goNoGo.ok ? goNoGo.data.decision : 'MISSING',
    releaseGate: releaseGate.ok ? releaseGate.data.status : 'missing',
    validateResult: validate.ok ? validate.data.result : 'missing',
    runtimeGovernance: runtimeGovernance.ok ? runtimeGovernance.data.classification : 'missing',
    approvedForDeploy: decision === 'READY' && (goNoGo.ok && goNoGo.data.decision === 'GO'),
    releaseManifestPath: OUTPUT_PATH,
  });

  return {
    generatedAt: new Date().toISOString(),
    candidate: {
      branch,
      commit,
      shortCommit,
      tag: tag || null,
      dirty,
    },
    artifact: {
      name: artifact.zip,
      manifestPath: path.relative(ROOT, artifact.manifestPath),
      sha256: artifact.manifest.sha256 || null,
      audit: artifact.manifest.audit || 'missing',
    },
    checks: {
      validate: {
        path: SYSTEM_VALIDATE_REPORT_PATH,
        status: validate.ok ? validate.data.status : validate.error,
        result: validate.ok ? validate.data.result : 'missing',
      },
      releaseGate: {
        path: RELEASE_GATE_REPORT_PATH,
        status: releaseGate.ok ? releaseGate.data.status : 'missing',
      },
      rollbackDrill: {
        path: ROLLBACK_DRILL_REPORT_PATH,
        status: rollbackDrill.ok ? rollbackDrill.data.status : 'missing',
      },
      goNoGo: {
        path: GO_NO_GO_REPORT_PATH,
        decision: goNoGo.ok ? goNoGo.data.decision : 'missing',
      },
      runtimeGovernance: {
        path: RUNTIME_GOVERNANCE_REPORT_PATH,
        status: runtimeGovernance.ok ? runtimeStatus : 'missing',
        classification: runtimeGovernance.ok ? runtimeGovernance.data.classification : 'missing',
      },
      deploy: {
        path: DEPLOY_REPORT_PATH,
        status: deployReport.ok ? deployReport.data.status : 'missing',
        artifact: deployReport.ok ? deployReport.data.artifact?.name || null : null,
        portResolution: deployReport.ok && Array.isArray(deployReport.data.portResolution)
          ? deployReport.data.portResolution
          : [],
      },
    },
    optionalChecks: {
      rollbackDrill: drillPass ? 'pass' : 'missing_or_fail',
    },
    decision,
  };
}

function main() {
  const manifest = buildManifest();
  const abs = path.join(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[release-manifest] decision=${manifest.decision} commit=${manifest.candidate.shortCommit} path=${OUTPUT_PATH}`);
  process.exit(manifest.decision === 'READY' || manifest.decision === 'READY_DEGRADED' ? 0 : 1);
}

main();
