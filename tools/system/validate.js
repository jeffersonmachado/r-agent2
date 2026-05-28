#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { buildRuntimeGovernanceReport, writeRuntimeGovernanceReport, toBool } = require('./runtime-governance');
const { evaluatePillars } = require('./lib/pillar-readiness');
const { resolveEvidenceCandidates } = require('./lib/runtime-paths');

const ROOT_DIR = path.join(__dirname, '..', '..');
const RUNTIME_ROOT = process.env.RUNTIME_ROOT
  ? (path.isAbsolute(process.env.RUNTIME_ROOT)
    ? process.env.RUNTIME_ROOT
    : path.join(ROOT_DIR, process.env.RUNTIME_ROOT))
  : null;

function runtimeAwarePath(defaultRelPath, explicitEnvVar) {
  if (explicitEnvVar && process.env[explicitEnvVar]) {
    return process.env[explicitEnvVar];
  }
  if (!RUNTIME_ROOT) {
    return defaultRelPath;
  }
  return path.join(RUNTIME_ROOT, defaultRelPath);
}

const REPORT_PATH = runtimeAwarePath('qa/system-validate-report.json', 'SYSTEM_VALIDATE_REPORT_PATH');
const QA_MESH_REPORT_PATH = runtimeAwarePath('qa-mesh/meshReport.json', 'QA_MESH_REPORT_PATH');
const SMOKE_EVIDENCE_SUMMARY_PATH = runtimeAwarePath('qa/smoke-evidence.json', 'SMOKE_EVIDENCE_SUMMARY_PATH');
const OFFICIAL_QA_MESH_SCENARIOS = [
  'qa-core-auth-login',
  'qa-physical-queue-smoke',
  'qa-ura-publish-rollback-smoke',
  'qa-pbx-voice-tts-asr-smoke',
  'qa-pbx-call-events-runtime-smoke',
  'qa-chatpro-omnichannel-smoke',
];

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';

function resolveWorkspacePath(targetPath) {
  if (!targetPath) return ROOT_DIR;
  return path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
}

function log(message, color = RESET) {
  // eslint-disable-next-line no-console
  console.log(`${color}${message}${RESET}`);
}

function run(command, label, env = process.env) {
  log(`[system:validate] ${label}`, BLUE);
  const startedAt = Date.now();
  execSync(command, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env,
  });
  return {
    label,
    command,
    status: 'pass',
    durationMs: Date.now() - startedAt,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReach(url)) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${label}_not_ready:${url}`);
}

function startManagedProcess(command, args, label, env = process.env, cwd = ROOT_DIR, options = {}) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  log(`[system:validate] starting ${label}: ${[command, ...args].join(' ')}`, BLUE);
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: 'inherit',
    detached: options.detached === true && process.platform !== 'win32',
  });
  return child;
}

async function stopManagedProcess(child, label) {
  if (!child) {
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const terminateChild = (signal) => {
    try {
      if (process.platform !== 'win32' && child.spawnargs && child.pid) {
        process.kill(-child.pid, signal);
        return;
      }
      child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
  };

  const waitForExit = (timeoutMs, signal) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    }, timeoutMs);

    child.once('exit', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });

    terminateChild(signal);
  });

  const terminated = await waitForExit(5000, 'SIGTERM');
  if (terminated) {
    return;
  }

  log(`[system:validate] forcing ${label} shutdown`, YELLOW);
  await waitForExit(2000, 'SIGKILL');
}

async function ensureFrontendPreview(frontendUrl, env) {
  if (await canReach(frontendUrl)) {
    log(`[system:validate] frontend preview already reachable at ${frontendUrl}`, BLUE);
    return null;
  }

  const parsed = new URL(frontendUrl);
  const previewHost = parsed.hostname || '127.0.0.1';
  const previewPort = parsed.port || '5173';

  const child = startManagedProcess(
    'npm',
    ['run', 'preview', '--', '--host', previewHost, '--port', previewPort],
    'frontend preview',
    env,
    path.join(ROOT_DIR, 'frontend'),
    { detached: true },
  );
  try {
    await waitForUrl(frontendUrl, 60000, 'frontend_preview');
    return child;
  } catch (error) {
    try {
      child.kill('SIGTERM');
    } catch {}
    throw error;
  }
}

function getApiRuntimeConfig(apiUrl) {
  const parsedUrl = new URL(apiUrl);
  return {
    apiPort: parsedUrl.port ? String(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? '443' : '80'),
    readyUrl: new URL('/health/ready', parsedUrl).toString(),
  };
}

async function ensureApiServer(apiUrl, env) {
  const { apiPort, readyUrl } = getApiRuntimeConfig(apiUrl);

  if (await canReach(readyUrl)) {
    log(`[system:validate] api already reachable at ${readyUrl}`, BLUE);
    return null;
  }

  const child = startManagedProcess(
    'npm',
    ['run', 'start:api'],
    'api server',
    {
      ...env,
      API_PORT: env.API_PORT || apiPort,
    },
    ROOT_DIR,
    { detached: true },
  );

  try {
    await waitForUrl(readyUrl, 90000, 'api_server');
    return child;
  } catch (error) {
    try {
      child.kill('SIGTERM');
    } catch {}
    throw error;
  }
}

function validateContracts() {
  const contracts = [
    path.join(ROOT_DIR, 'contracts', 'generation.interface.json'),
    path.join(ROOT_DIR, 'contracts', 'qa', 'qa.contract.json'),
  ];

  for (const contractPath of contracts) {
    if (!fs.existsSync(contractPath)) {
      throw new Error(`contract_missing:${contractPath}`);
    }
    JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  }

  return {
    label: 'contracts',
    status: 'pass',
    files: contracts.map((f) => path.relative(ROOT_DIR, f)),
  };
}

function writeReport(report) {
  const absPath = resolveWorkspacePath(REPORT_PATH);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function resolveOfficialServiceUrls() {
  const frontendUrl = process.env.SYSTEM_VALIDATE_FRONTEND_URL || 'http://127.0.0.1:5173';
  const apiUrl = process.env.SYSTEM_VALIDATE_API_URL || 'http://127.0.0.1:3001';
  const baseUrl = process.env.SYSTEM_VALIDATE_BASE_URL || apiUrl;

  return {
    frontendUrl,
    apiUrl,
    baseUrl,
  };
}

function buildQaMeshRuntimePaths() {
  const executionId = `system-validate-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const baseDir = process.env.QA_MESH_SYSTEM_VALIDATE_DIR
    || (RUNTIME_ROOT
      ? path.join(RUNTIME_ROOT, 'qa-mesh', 'system-validate')
      : path.join('qa-mesh', 'system-validate'));
  return {
    executionId,
    reportPath: path.join(baseDir, 'meshReport.json'),
    repairPlanPath: path.join(baseDir, 'repairPlan.json'),
    metricsPath: path.join(baseDir, 'metrics.json'),
    historyDir: path.join(baseDir, 'meshHistory'),
    evidenceDir: path.join(baseDir, 'meshEvidence'),
  };
}

function readJsonStrict(relPath, label) {
  const absPath = resolveWorkspacePath(relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`${label}_missing:${relPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw new Error(`${label}_invalid:${relPath}:${error.message || error}`);
  }
}

function loadQaMeshReportWithFallback(qaMeshPaths) {
  try {
    return {
      report: readJsonStrict(qaMeshPaths.reportPath, 'qa_mesh_report'),
      source: 'report',
    };
  } catch (error) {
    if (!String(error?.message || '').startsWith('qa_mesh_report_missing:')) {
      throw error;
    }

    const summaryPath = path.join(qaMeshPaths.evidenceDir, qaMeshPaths.executionId, 'summary.json');
    const summaryAbsPath = resolveWorkspacePath(summaryPath);
    if (!fs.existsSync(summaryAbsPath)) {
      throw error;
    }

    const summary = readJsonStrict(summaryPath, 'qa_mesh_summary');
    const reportAbsPath = resolveWorkspacePath(qaMeshPaths.reportPath);
    fs.mkdirSync(path.dirname(reportAbsPath), { recursive: true });
    fs.writeFileSync(reportAbsPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return {
      report: summary,
      source: 'summary_fallback',
    };
  }
}

function loadEvidenceMaybe(relPath) {
  const candidates = resolveEvidenceCandidates(ROOT_DIR, relPath, null, process.env);
  for (const absPath of candidates) {
    if (!fs.existsSync(absPath)) {
      continue;
    }
    try {
      return JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch (error) {
      throw new Error(`smoke_evidence_invalid:${path.relative(ROOT_DIR, absPath)}:${error.message || error}`);
    }
  }
  return null;
}

function buildSmokeEvidenceSummary() {
  const smokeMap = {
    l01: {
      evidencePath: 'qa/l01-physical-queue-evidence.json',
      logPath: 'qa/smoke/l01-physical-queue.log',
    },
    l02: {
      evidencePath: 'qa/l02-ura-publish-rollback-evidence.json',
      logPath: 'qa/smoke/l02-ura-publish-rollback.log',
    },
    l03: {
      evidencePath: 'qa/l03-pbx-voice-tts-asr-evidence.json',
      logPath: 'qa/smoke/l03-pbx-voice-tts-asr.log',
    },
    l04: {
      evidencePath: 'qa/l04-pbx-call-events-runtime-evidence.json',
      logPath: 'qa/smoke/l04-pbx-call-events-runtime.log',
    },
    l05: {
      evidencePath: 'qa/l05-chatpro-omnichannel-evidence.json',
      logPath: 'qa/smoke/l05-chatpro-omnichannel.log',
    },
  };

  const smokes = {};
  Object.entries(smokeMap).forEach(([key, entry]) => {
    const evidence = loadEvidenceMaybe(entry.evidencePath);
    smokes[key] = {
      status: evidence && evidence.ok === true ? 'pass' : 'fail',
      evidencePath: entry.evidencePath,
      logPath: entry.logPath,
      evidence,
    };
    if (!evidence) {
      smokes[key].status = 'missing';
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    source: 'system:validate',
    smokes,
  };
  const absPath = resolveWorkspacePath(SMOKE_EVIDENCE_SUMMARY_PATH);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

async function main() {
  let exitCode = 0;
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    result: 'NO_GO',
    runtime: null,
    evidence: {},
    steps: [],
    errors: [],
  };

  const managedChildren = [];

  try {
    report.steps.push(validateContracts());

    const officialUrls = resolveOfficialServiceUrls();
    const qaMeshPaths = buildQaMeshRuntimePaths();

    const qaEnv = {
      ...process.env,
      SKIP_TENANT_SITE_INDEXING: 'true',
      RPA_SKIP_IF_FRONTEND_UNREACHABLE: 'true',
      RPA_SKIP_IF_API_UNREACHABLE: 'true',
      SCRAPING_ALLOW_DEGRADED: 'true',
      FRONTEND_URL: officialUrls.frontendUrl,
      TEST_FRONTEND_URL: officialUrls.frontendUrl,
      RPA_FRONTEND_URL: officialUrls.frontendUrl,
      TEST_API_URL: officialUrls.apiUrl,
      TEST_BASE_URL: officialUrls.baseUrl,
      TEST_USERNAME: process.env.TEST_USERNAME || 'admin',
      TEST_PASSWORD: process.env.TEST_PASSWORD || 'Admin123!',
      TEST_USER_USERNAME: process.env.TEST_USER_USERNAME || 'admin',
      TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD || 'Admin123!',
      TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME || 'admin',
      TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD || 'Admin123!',
      TEST_SUPERADMIN_USERNAME: process.env.TEST_SUPERADMIN_USERNAME || 'systemadmin',
      TEST_SUPERADMIN_PASSWORD: process.env.TEST_SUPERADMIN_PASSWORD || 'Admin123!',
      QA_MESH_REPORT_PATH: qaMeshPaths.reportPath,
      QA_MESH_REPAIR_PLAN_PATH: qaMeshPaths.repairPlanPath,
      QA_MESH_METRICS_PATH: qaMeshPaths.metricsPath,
      QA_MESH_HISTORY_DIR: qaMeshPaths.historyDir,
      QA_MESH_EVIDENCE_DIR: qaMeshPaths.evidenceDir,
      QA_MESH_EXECUTION_ID: qaMeshPaths.executionId,
      QA_MESH_SCENARIO_IDS: OFFICIAL_QA_MESH_SCENARIOS.join(','),
    };

    const apiServer = await ensureApiServer(officialUrls.apiUrl, qaEnv);
    if (apiServer) {
      managedChildren.push(apiServer);
    }

    const frontendPreview = await ensureFrontendPreview(officialUrls.frontendUrl, qaEnv);
    if (frontendPreview) {
      managedChildren.push(frontendPreview);
    }

    const mandatorySteps = [
      { label: 'backend unit', command: 'npm exec -- jest tests/unit --runInBand' },
      { label: 'frontend unit', command: 'npm run frontend:test:unit' },
      { label: 'frontend build', command: 'npm run frontend:build' },
      { label: 'frontend smoke', command: 'npm run frontend:smoke' },
      { label: 'email smoke', command: 'npm run test:email:smoke' },
      { label: 'qa mesh', command: 'PIPELINE_BYPASS=1 npm run qa:mesh' },
    ];

    for (const step of mandatorySteps) {
      report.steps.push(run(step.command, step.label, qaEnv));
    }

    const includeExtended = toBool(process.env.SYSTEM_VALIDATE_INCLUDE_EXTENDED, false);
    if (includeExtended) {
      const extendedSteps = [
        { label: 'backend flow', command: 'npm run test:flow' },
        { label: 'backend stress', command: 'npm run test:stress' },
        { label: 'seed rpa flows', command: 'node scripts/seed-rpa-flows.js' },
        { label: 'rpa suite', command: 'PIPELINE_BYPASS=1 npm run test:rpa' },
      ];
      for (const step of extendedSteps) {
        report.steps.push(run(step.command, `${step.label} (extended)`, qaEnv));
      }
    } else {
      report.steps.push({
        label: 'extended checks',
        command: 'SYSTEM_VALIDATE_INCLUDE_EXTENDED=1 npm run system:validate',
        status: 'skipped',
        reason: 'SYSTEM_VALIDATE_INCLUDE_EXTENDED!=1',
      });
      log('[system:validate] Extended checks desabilitados (use SYSTEM_VALIDATE_INCLUDE_EXTENDED=1 para habilitar).', YELLOW);
    }

    const qaMeshLoaded = loadQaMeshReportWithFallback(qaMeshPaths);
    const qaMeshReport = qaMeshLoaded.report;
    if (String(qaMeshReport.goNoGo || '').toUpperCase() === 'NO_GO') {
      throw new Error('qa_mesh_report_no_go');
    }
    report.evidence.qaMesh = {
      path: qaMeshPaths.reportPath,
      source: qaMeshLoaded.source,
      goNoGo: qaMeshReport.goNoGo || 'missing',
      attempted: qaMeshReport.attempted || qaMeshReport.total || null,
      executed: qaMeshReport.executed || null,
      executionId: qaMeshReport.executionId || qaMeshPaths.executionId,
    };

    const smokeSummary = buildSmokeEvidenceSummary();
    const pillars = evaluatePillars(smokeSummary.smokes);
    const skipSmokePillars = toBool(process.env.SYSTEM_VALIDATE_SKIP_SMOKE_PILLARS, false);
    if (!pillars.ok && !skipSmokePillars) {
      throw new Error(`smoke_pillars_not_ready:${pillars.reasons.join(',')}`);
    }
    if (!pillars.ok && skipSmokePillars) {
      log(`[system:validate] Smoke pillars em bypass por SYSTEM_VALIDATE_SKIP_SMOKE_PILLARS=1 (${pillars.reasons.join(',')})`, YELLOW);
    }
    report.evidence.smoke = {
      path: SMOKE_EVIDENCE_SUMMARY_PATH,
      pillars,
      skipped: !pillars.ok && skipSmokePillars,
    };

    const runtimeReport = buildRuntimeGovernanceReport({
      requireRealRuntime: toBool(process.env.RUNTIME_REQUIRE_REAL, false),
    });
    writeRuntimeGovernanceReport(
      runtimeReport,
      runtimeAwarePath('qa/runtime-governance-report.json', 'RUNTIME_GOVERNANCE_REPORT_PATH'),
    );
    report.runtime = runtimeReport;

    const fallbackThreshold = Number(process.env.SYSTEM_VALIDATE_FALLBACK_THRESHOLD || 0);
    if (runtimeReport.classification === 'REAL_FAILED_FALLBACK_USED' && runtimeReport.fallbackCount > fallbackThreshold) {
      throw new Error(`runtime_fallback_threshold_exceeded:${runtimeReport.fallbackCount}>${fallbackThreshold}`);
    }

    if (runtimeReport.gateStatus === 'no_go') {
      throw new Error(`runtime_mode_blocked:${runtimeReport.classification}`);
    }

    report.status = runtimeReport.gateStatus === 'go_degraded' ? 'degraded' : 'pass';
    report.result = runtimeReport.gateStatus === 'go_degraded' ? 'GO_DEGRADED' : 'GO';
    report.finishedAt = new Date().toISOString();

    writeReport(report);
    log(`[system:validate] PASS (${report.result}) report=${REPORT_PATH}`, GREEN);
  } catch (error) {
    report.status = 'fail';
    report.result = 'NO_GO';
    report.errors.push(error.message || String(error));
    report.finishedAt = new Date().toISOString();
    writeReport(report);
    log(`[system:validate] FAIL: ${error.message || error}`, RED);
    exitCode = 1;
  } finally {
    for (const child of managedChildren) {
      await stopManagedProcess(child, 'managed child');
    }
  }

  process.exitCode = exitCode;
}

if (require.main === module) {
  main();
}
