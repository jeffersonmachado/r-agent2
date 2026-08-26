'use strict';

const fs = require('fs');
const path = require('path');
const { executeRecording, getExecutionStatus, rpaExecutionEvents } = require('../../api/services/rpaService');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RPA_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function buildTerminalResult(status) {
  const results = status.results || {};
  const artifacts = [];
  if (results.replayPath) artifacts.push({ type: 'replay', path: path.resolve(results.replayPath) });
  if (Array.isArray(results.screenshots)) {
    results.screenshots.forEach((item) => artifacts.push({ type: 'screenshot', path: path.resolve(item) }));
  }
  // Vídeo de treinamento
  if (results.videoPath && fs.existsSync(results.videoPath)) {
    artifacts.push({ type: 'video', path: path.resolve(results.videoPath) });
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

// Orientado a evento (sem polling): acorda a cada mudança de estado emitida
// pelo rpaService; o orçamento de tempo é um único deadline.
async function waitForExecution(executionId, timeoutMs = 10 * 60 * 1000, context = {}) {
  const tenantId = context.tenantId || 'system';
  const notifyProgress = (status) => {
    if (!status || RPA_TERMINAL_STATUSES.includes(status.status)) return;
    context.onStepProgress?.({
      progress: status.progress ?? 0,
      currentStep: status.currentStep ?? null,
      totalSteps: status.totalSteps ?? 0,
    });
  };

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      rpaExecutionEvents.off('updated', handleUpdate);
      resolve(result);
    };

    const checkNow = () => {
      const status = getExecutionStatus(executionId, tenantId);
      if (!status) {
        finish({ success: false, logs: [], metrics: { status: 'missing' }, errors: ['Execução não encontrada'], artifacts: [] });
        return;
      }
      if (RPA_TERMINAL_STATUSES.includes(status.status)) {
        finish(buildTerminalResult(status));
        return;
      }
      notifyProgress(status);
    };

    const handleUpdate = (event) => {
      if (!event || event.id !== executionId || settled) return;
      checkNow();
    };

    const deadline = setTimeout(() => {
      finish({
        success: false,
        logs: [],
        metrics: { status: 'timeout' },
        errors: [{ error: 'Tempo limite excedido aguardando execução RPA' }],
        artifacts: [],
      });
    }, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();

    rpaExecutionEvents.on('updated', handleUpdate);
    // Primeira leitura síncrona: cobre execução já terminal antes da assinatura.
    checkNow();
  });
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
    text.includes('err_connection_refused') ||
    text.includes('net::err_connection_refused') ||
    (text.includes('locator(\'body\')') && text.includes('timeout')) ||
    (text.includes('locator(\'html\')') && text.includes('timeout'))
  );
}

async function executeScenario(scenario, adapterContext = {}) {
  const tenantId = adapterContext.tenantId || scenario.tenantId || scenario.tenant_id || 'system';
  // Configuração de vídeo para treinamento
  const recordVideo = scenario.recordVideo !== false && process.env.QA_MESH_RECORD_VIDEO !== '0';
  const videoDir = recordVideo
    ? path.join(adapterContext.repoRoot || process.cwd(), 'training', 'videos', scenario.id)
    : null;

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
        recordVideo,
        videoDir,
      },
      scenario.data || {},
      null,
      tenantId,
      'mesh',
    );

    const result = await waitForExecution(start.executionId, effectiveWaitTimeout, { ...adapterContext, tenantId });
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
