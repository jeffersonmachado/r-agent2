'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
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

  return {
    success: result.success,
    logs: result.logs,
    metrics: result.metrics,
    errors: result.errors,
    artifacts: collectArtifacts(scenario.expectedArtifacts || []),
  };
}

module.exports = {
  executeScenario,
};
