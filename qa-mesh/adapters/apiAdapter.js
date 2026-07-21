'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runCommand(command, args, options = {}) {
  const meshAuthEnv = {
    TEST_TENANT_ID: process.env.TEST_TENANT_ID || 'system',
    TEST_SUPERADMIN_USERNAME: process.env.TEST_SUPERADMIN_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
    TEST_SUPERADMIN_PASSWORD: process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
    TEST_USERNAME: process.env.TEST_USERNAME || process.env.TEST_SUPERADMIN_USERNAME || 'systemadmin',
    TEST_PASSWORD: process.env.TEST_PASSWORD || process.env.TEST_SUPERADMIN_PASSWORD || 'Admin123!',
    TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME || process.env.TEST_SUPERADMIN_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
    TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD || process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
    TEST_USER_USERNAME: process.env.TEST_USER_USERNAME || process.env.TEST_SUPERADMIN_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
    TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD || process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
  };

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...meshAuthEnv, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs = [];
    const errors = [];

    const capture = (level) => (chunk) => {
      const text = String(chunk || '').trimEnd();
      if (!text) return;
      text.split('\n').forEach((line) => {
        logs.push({ level, message: line, timestamp: new Date().toISOString() });
        if (level === 'stderr') errors.push(line);
      });
    };

    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', (error) => errors.push(error.message));
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        logs,
        metrics: {
          command: [command, ...args].join(' '),
        },
        errors: code === 0 ? [] : errors,
      });
    });
  });
}

function collectArtifacts(files = []) {
  return files
    .map((filePath) => path.resolve(filePath))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      type: path.extname(filePath).slice(1) || 'file',
      path: filePath,
    }));
}

async function executeScenario(scenario, context = {}) {
  const result = await runCommand(
    scenario.command || 'node',
    Array.isArray(scenario.commandArgs) ? scenario.commandArgs : [],
    {
      cwd: context.repoRoot || process.cwd(),
      env: scenario.env || {},
    }
  );

  const artifacts = collectArtifacts(scenario.expectedArtifacts || []);

  // Enriquecer steps com training metadata
  const trainingSteps = Array.isArray(scenario.trainingSteps) && scenario.trainingSteps.length > 0
    ? scenario.trainingSteps
    : null;

  // Construir steps narrativos a partir dos logs quando possível
  const enrichedSteps = (result.logs || [])
    .filter((l) => l.level === 'stdout')
    .slice(0, 50)
    .map((l, i) => ({
      index: i + 1,
      name: l.message.substring(0, 200),
      actor: 'api',
      category: 'API_CALL',
    }));

  return {
    success: result.success,
    logs: result.logs,
    metrics: result.metrics,
    errors: result.errors,
    artifacts,
    trainingSteps,
    enrichedSteps: enrichedSteps.length > 0 ? enrichedSteps : null,
  };
}

module.exports = {
  executeScenario,
};
