'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_PATH = process.env.PIPELINE_REPORT_PATH || path.join(ROOT, 'qa', 'pipeline-report.json');
const API_CONFIG_PATH = path.join(ROOT, 'api', 'data', 'config.json');
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function resolveDefaultApiUrl() {
  if (process.env.TEST_API_URL || process.env.API_URL) {
    return process.env.TEST_API_URL || process.env.API_URL;
  }

  try {
    const config = JSON.parse(fs.readFileSync(API_CONFIG_PATH, 'utf8'));
    const port = Number(config?.api?.port);
    if (Number.isFinite(port) && port > 0) {
      return `http://localhost:${port}`;
    }
  } catch {}

  return 'http://localhost:3000';
}

const DEFAULT_API_URL = resolveDefaultApiUrl();

function runStep(name, command, args, env = process.env) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...env,
      CI: process.env.CI || '1',
    },
  });

  return {
    name,
    command: [command, ...args].join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    success: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || '').slice(-4000),
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

function startManagedProcess(command, args, label, env = process.env, cwd = ROOT) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  child.unref();
  return {
    child,
    label,
  };
}

async function stopManagedProcess(managed) {
  if (!managed?.child) {
    return;
  }

  const child = managed.child;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const terminate = (signal) => {
    try {
      if (process.platform !== 'win32' && child.pid) {
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

  terminate('SIGTERM');
  await sleep(1500);
  if (child.exitCode === null && child.signalCode === null) {
    terminate('SIGKILL');
  }
}

async function ensureQaRuntime(env) {
  const managed = [];

  if (!(await canReach(`${DEFAULT_API_URL}/health`))) {
    const api = startManagedProcess('node', ['api/server.js'], 'api server', env, ROOT);
    managed.push(api);
    await waitForUrl(`${DEFAULT_API_URL}/health`, 60000, 'api');
  }

  if (!(await canReach(DEFAULT_FRONTEND_URL))) {
    const frontend = startManagedProcess(
      'npm',
      ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      'frontend preview',
      env,
      path.join(ROOT, 'frontend'),
    );
    managed.push(frontend);
    await waitForUrl(DEFAULT_FRONTEND_URL, 60000, 'frontend');
  }

  return managed;
}

async function main() {
  const env = {
    ...process.env,
    CI: process.env.CI || '1',
    FRONTEND_URL: DEFAULT_FRONTEND_URL,
    TEST_FRONTEND_URL: process.env.TEST_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    RPA_FRONTEND_URL: process.env.RPA_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    TEST_API_URL: DEFAULT_API_URL,
  };
  const managedChildren = [];
  const steps = [
    runStep('validate-invariants', 'npm', ['run', 'validate:invariants'], env),
    runStep('frontend-build', 'npm', ['run', 'frontend:build'], env),
    runStep('contracts', 'npm', ['run', 'test:contracts'], env),
  ];

  try {
    managedChildren.push(...await ensureQaRuntime(env));
    steps.push(runStep('qa-mesh', 'npm', ['run', 'qa:mesh'], env));
    steps.push(runStep('qa-final-report', 'node', ['qa/final-report.js'], env));
  } finally {
    for (const managed of managedChildren.reverse()) {
      await stopManagedProcess(managed);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    success: steps.every((step) => step.success),
    steps,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!report.success) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    const report = {
      generatedAt: new Date().toISOString(),
      success: false,
      steps: [],
      error: error.message || String(error),
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.exitCode = 1;
  });
}