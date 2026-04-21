#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/runtime-governance-report.json', 'RUNTIME_GOVERNANCE_REPORT_PATH');

function toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function loadJsonState(relPath) {
  if (!relPath) {
    return {
      path: null,
      found: false,
      data: null,
      parseError: null,
    };
  }
  const abs = resolveWorkspacePath(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return {
      path: relPath,
      found: false,
      data: null,
      parseError: null,
    };
  }
  try {
    return {
      path: relPath,
      found: true,
      data: JSON.parse(fs.readFileSync(abs, 'utf8')),
      parseError: null,
    };
  } catch (error) {
    return {
      path: relPath,
      found: true,
      data: null,
      parseError: error.message || String(error),
    };
  }
}

function classifyRuntime(options = {}) {
  const requireRealRuntime = !!options.requireRealRuntime;
  const fallbackUsed = !!options.fallbackUsed;
  const realRuntimeConfirmed = !!options.realRuntimeConfirmed;

  if (requireRealRuntime && realRuntimeConfirmed && !fallbackUsed) {
    return { classification: 'REAL_OK', gateStatus: 'go' };
  }

  if (requireRealRuntime && fallbackUsed) {
    return { classification: 'REAL_FAILED_FALLBACK_USED', gateStatus: 'no_go' };
  }

  if (requireRealRuntime && !realRuntimeConfirmed) {
    return { classification: 'BLOCKED', gateStatus: 'no_go' };
  }

  if (realRuntimeConfirmed && !fallbackUsed) {
    return { classification: 'REAL_OK', gateStatus: 'go' };
  }

  return { classification: 'SYNTHETIC_OK', gateStatus: 'go_degraded' };
}

function buildRuntimeGovernanceReport(options = {}) {
  const smokeEvidencePath = options.smokeEvidencePath
    || runtimeAwarePath(ROOT, 'qa/smoke-evidence.json', 'SMOKE_EVIDENCE_SUMMARY_PATH');
  const runtimeReportPath = options.runtimeReportPath
    || runtimeAwarePath(ROOT, 'qa/runtime-report.json', 'RUNTIME_REPORT_PATH');
  const smokeEvidenceState = loadJsonState(smokeEvidencePath);
  const runtimeReportState = loadJsonState(runtimeReportPath);
  const smokeEvidence = smokeEvidenceState.data;
  const runtimeReport = runtimeReportState.data;

  const requireRealRuntime = options.requireRealRuntime != null
    ? !!options.requireRealRuntime
    : toBool(process.env.RUNTIME_REQUIRE_REAL, false);

  const envRealConfirmed = toBool(process.env.RUNTIME_REAL_CONFIRMED, false);
  const envFallbackUsed = toBool(process.env.RUNTIME_FALLBACK_USED, false);

  const smokeRealConfirmed = !!(
    smokeEvidence
    && smokeEvidence.smokes
    && smokeEvidence.smokes.l03
    && smokeEvidence.smokes.l03.status === 'pass'
    && smokeEvidence.smokes.l03.evidence
    && smokeEvidence.smokes.l03.evidence.realCall
    && smokeEvidence.smokes.l03.evidence.realCall.attempted === true
    && String(smokeEvidence.smokes.l03.evidence.realCall.click2callStatus || '').toLowerCase() === 'originated'
  );

  const reportFallbackUsed = !!(
    runtimeReport
    && runtimeReport.summary
    && Number(runtimeReport.summary.fallbackCount || 0) > 0
  );

  const realRuntimeConfirmed = envRealConfirmed || smokeRealConfirmed;
  const fallbackUsed = envFallbackUsed || reportFallbackUsed;
  const issues = [];

  if (smokeEvidenceState.parseError) {
    issues.push(`smoke_evidence_parse_error:${smokeEvidenceState.parseError}`);
  }
  if (runtimeReportState.parseError) {
    issues.push(`runtime_report_parse_error:${runtimeReportState.parseError}`);
  }

  const result = classifyRuntime({
    requireRealRuntime,
    fallbackUsed,
    realRuntimeConfirmed,
  });

  return {
    generatedAt: new Date().toISOString(),
    requireRealRuntime,
    signals: {
      envRealConfirmed,
      smokeRealConfirmed,
      envFallbackUsed,
      reportFallbackUsed,
    },
    evidence: {
      smokeEvidencePath,
      runtimeReportPath,
      smokeEvidenceFound: smokeEvidenceState.found,
      smokeEvidenceParseError: smokeEvidenceState.parseError,
      runtimeReportFound: runtimeReportState.found,
      runtimeReportParseError: runtimeReportState.parseError,
    },
    fallbackCount: fallbackUsed ? 1 : 0,
    issues,
    classification: result.classification,
    gateStatus: result.gateStatus,
  };
}

function writeRuntimeGovernanceReport(report, relPath = DEFAULT_REPORT_PATH) {
  const abs = resolveWorkspacePath(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return relPath;
}

if (require.main === module) {
  const report = buildRuntimeGovernanceReport();
  const outputPath = runtimeAwarePath(ROOT, 'qa/runtime-governance-report.json', 'RUNTIME_GOVERNANCE_REPORT_PATH');
  writeRuntimeGovernanceReport(report, outputPath);

  // eslint-disable-next-line no-console
  console.log(`[runtime-governance] classification=${report.classification} gateStatus=${report.gateStatus} report=${outputPath}`);

  if (report.gateStatus === 'no_go') {
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  classifyRuntime,
  buildRuntimeGovernanceReport,
  writeRuntimeGovernanceReport,
  loadJsonState,
  toBool,
};
