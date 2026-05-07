'use strict';

const path = require('path');
const { executeRecording, getExecutionStatus } = require('../../api/services/rpaService');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function compactErrorText(entry) {
  return String(entry?.error || entry?.message || entry || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isTransientRpaFailure(result) {
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const text = errors.map(compactErrorText).join(' | ');
  const status = String(result?.metrics?.status || '').toLowerCase();
  return (
    status === 'timeout' ||
    text.includes('tempo limite excedido aguardando execução rpa') ||
    text.includes('target page, context or browser has been closed') ||
    (text.includes('locator(\'body\')') && text.includes('timeout')) ||
    (text.includes('locator(\'html\')') && text.includes('timeout'))
  );
}

async function waitForExecution(executionId, timeoutMs = 10 * 60 * 1000, context = {}) {
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
    context.onStepProgress?.({
      progress: status.progress ?? 0,
      currentStep: status.currentStep ?? null,
      totalSteps: status.totalSteps ?? 0,
    });
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

async function executeScenario(scenario, adapterContext = {}) {
  const maxAttempt = Number(process.env.QA_MESH_RPA_MAX_ATTEMPTS || 2);
  const effectiveAttempts = Number.isFinite(maxAttempt) && maxAttempt > 0 ? maxAttempt : 2;
  const requestedWaitTimeout = Number(scenario.timeoutMs);
  const maxWaitTimeout = Number(process.env.QA_MESH_RPA_MAX_WAIT_MS || (10 * 60 * 1000));
  const effectiveWaitTimeout = Number.isFinite(requestedWaitTimeout) && requestedWaitTimeout > 0
    ? Math.min(requestedWaitTimeout, maxWaitTimeout)
    : maxWaitTimeout;

  let lastResult = null;

  for (let attempt = 1; attempt <= effectiveAttempts; attempt += 1) {
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

    const result = await waitForExecution(start.executionId, effectiveWaitTimeout, adapterContext);
    if (result?.success) {
      if (attempt > 1) {
        result.logs = [
          ...(result.logs || []),
          { message: `[qa-mesh:rpa-adapter] sucesso após retry (tentativa ${attempt}/${effectiveAttempts})` },
        ];
      }
      return result;
    }

    lastResult = result;
    if (attempt < effectiveAttempts && isTransientRpaFailure(result)) {
      await sleep(1000);
      continue;
    }
    break;
  }

  return lastResult || {
    success: false,
    logs: [],
    metrics: { status: 'failed' },
    errors: [{ error: 'Falha desconhecida na execução RPA' }],
    artifacts: [],
  };
}

module.exports = {
  executeScenario,
};
