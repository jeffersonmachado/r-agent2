'use strict';

const path = require('path');
const { executeRecording, getExecutionStatus } = require('../../api/services/rpaService');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExecution(executionId, timeoutMs = 10 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = getExecutionStatus(executionId);
    if (!status) {
      return { success: false, logs: [], metrics: { status: 'missing' }, errors: ['Execução não encontrada'], artifacts: [] };
    }
    if (['completed', 'failed', 'cancelled'].includes(status.status)) {
      const results = status.results || {};
      const artifacts = [];
      if (results.replayPath) artifacts.push({ type: 'replay', path: path.resolve(results.replayPath) });
      if (Array.isArray(results.screenshots)) {
        results.screenshots.forEach((item) => artifacts.push({ type: 'screenshot', path: path.resolve(item) }));
      }

      const firstFailedStep = Array.isArray(results.steps)
        ? results.steps.find((step) => step && step.success === false)
        : null;
      const diagnostics = firstFailedStep?.debug?.diagnostics || null;
      const stepSpecific = diagnostics?.stepSpecific || diagnostics || null;
      const maintenanceClassification = stepSpecific?.classification || null;
      const maintenanceArtifactPath = stepSpecific?.maintenance?.artifactPath || null;

      if (maintenanceArtifactPath) {
        artifacts.push({ type: 'diagnostic', path: path.resolve(maintenanceArtifactPath) });
      }

      const normalizedErrors = Array.isArray(results.errors) ? [...results.errors] : [];
      if (maintenanceClassification) {
        normalizedErrors.push({ error: `maintenance_classification:${maintenanceClassification}` });
      }

      return {
        success: status.status === 'completed' && results.success !== false,
        logs: status.logs || [],
        metrics: {
          status: status.status,
          progress: status.progress,
          totalSteps: status.totalSteps,
        },
        errors: normalizedErrors.length > 0 ? normalizedErrors : (status.error ? [{ error: status.error }] : []),
        artifacts,
        rawStatus: status,
      };
    }
    await sleep(1000);
  }
  return {
    success: false,
    logs: [],
    metrics: { status: 'timeout' },
    errors: [{ error: 'Tempo limite excedido aguardando execução RPA' }],
    artifacts: [],
  };
}

async function executeScenario(scenario) {
  const start = await executeRecording(
    scenario.rpaRecordingId,
    {
      headless: scenario.headless !== false,
      slowMo: scenario.slowMo || 0,
      timeout: scenario.timeout || 30000,
      screenshotOnFailure: true,
    },
    scenario.data || {}
  );
  return waitForExecution(start.executionId, scenario.timeoutMs);
}

module.exports = {
  executeScenario,
};
