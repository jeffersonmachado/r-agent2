// Mapeamento dos endpoints REAIS da plataforma para os shapes consumidos pela UI.
// Cada mapper preserva exatamente os nomes de campo que os componentes leem
// (ver data/mockData.js). Entidades live carregam `_live: true` para que o hook
// não as descarte nos filtros que cruzam com workItems (domínio ainda mock).
import { apiGet } from './client.js';

const EXECUTIONS_LIMIT = 100;
const SCENARIOS_LIMIT = 200;
const REPLAY_DETAILS_LIMIT = 20;

// --- status helpers -------------------------------------------------------

function mapExecutionStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['done', 'passed', 'success', 'completed', 'finished'].includes(value)) return 'passed';
  if (['error', 'failed', 'failure'].includes(value)) return 'failed';
  if (['running', 'in_progress', 'processing', 'queued'].includes(value)) return 'running';
  return 'warning';
}

function mapReplayStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['success', 'passed', 'done'].includes(value)) return 'passed';
  if (['failed', 'error'].includes(value)) return 'failed';
  if (['running', 'in_progress'].includes(value)) return 'running';
  return 'warning';
}

function mapWaveStatus(wave) {
  const coverage = Number(wave.weightedCoverage ?? wave.validatedCoverage ?? 0);
  const success = Number(wave.successRate ?? 0);
  if (coverage >= 70 && success >= 90) return 'healthy';
  if (coverage >= 40) return 'warning';
  return 'critical';
}

// --- mappers --------------------------------------------------------------

// GET /api/qa-waves/waves -> { items: [{ id, domain, name, totalItems, criticalItems,
//   visitedCoverage, validatedCoverage, successRate, weightedCoverage, items: [...] }] }
// Falhas por domínio derivadas de GET /api/qa-waves/journey-status.
function mapWaves(wavesPayload, journeyPayload) {
  const failuresByDomain = {};
  for (const journey of journeyPayload?.items || []) {
    const domain = journey.domainId;
    const failures = Number(journey.failedScenarios || 0) + Number(journey.criticalFailures || 0);
    failuresByDomain[domain] = (failuresByDomain[domain] || 0) + failures;
  }
  return (wavesPayload?.items || []).map((wave) => ({
    id: wave.id,
    name: wave.name,
    status: mapWaveStatus(wave),
    coverage: Math.round(Number(wave.weightedCoverage ?? wave.validatedCoverage ?? 0)),
    failures: failuresByDomain[wave.domain] || 0,
    lastExecution: null, // endpoint não expõe timestamp da última execução da wave
    domain: wave.domain,
    projectId: null,
    _live: true,
  }));
}

// GET /system/status -> { services: { apiServer|ragService|redis|webSocket: {...} }, overall: {...} }
function mapHealthDomains(statusPayload) {
  const services = statusPayload?.services || {};
  return Object.entries(services).map(([key, service]) => {
    const healthy = String(service.status || '').toLowerCase() === 'healthy';
    return {
      id: `domain-${key}`,
      name: service.name || key,
      status: healthy ? 'healthy' : 'critical',
      latencyMs: 0, // /system/status não reporta latência por serviço
      availability: healthy ? 100 : 0,
      incidents: healthy ? 0 : 1,
      _live: true,
    };
  });
}

// GET /api/executions?limit=N -> { ok, total, items: [{ id, tenant_key, flow_id,
//   flow_version, session_id, correlation_id, subject_type, subject_id, status,
//   started_at, finished_at, meta: { mode, replayId, ... } }] }
function mapExecutions(payload) {
  return (payload?.items || []).map((item) => {
    const startedAt = item.started_at || item.createdAt || null;
    const finishedAt = item.finished_at || item.updatedAt || null;
    const duration = startedAt && finishedAt
      ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
      : 0;
    const status = mapExecutionStatus(item.status);
    return {
      id: item.id,
      workItemId: item.flow_id || item.subject_id || item.id,
      status,
      duration,
      timestamp: startedAt,
      environment: item.meta?.mode || 'runtime',
      tenant: item.tenant_key || '-',
      channel: item.subject_type || '-',
      score: null,
      logs: [
        `flow ${item.flow_id} v${item.flow_version}`,
        `session ${item.session_id}`,
        `correlation ${item.correlation_id}`,
        `status ${item.status} | finishedBy ${item.meta?.finishedBy || '-'}`,
      ],
      steps: [
        {
          id: `${item.id}-step-1`,
          action: item.subject_type || 'execution',
          input: item.session_id || '-',
          output: `${item.flow_id} v${item.flow_version} -> ${item.status}`,
          status,
        },
      ],
      _live: true,
    };
  });
}

// GET /api/qa-waves/replays -> { items: [{ id, executionId, scenarioId, waveId,
//   waveName, itemId, itemName, name, channel, status, startedAt, finishedAt,
//   durationMs, critical, domainId, ... }] }
// GET /api/qa-waves/replays/:id -> detalhe com steps[] (timeline real).
function mapReplaySummary(item, detail) {
  const status = mapReplayStatus(item.status);
  const steps = Array.isArray(detail?.steps) ? detail.steps : [];
  return {
    id: item.id,
    executionId: item.executionId || null,
    workItemId: item.scenarioId || item.itemId || null,
    status,
    createdAt: item.startedAt || null,
    summary: `${item.name} — ${item.waveName || item.waveId} (${item.domainName || item.domainId}), duração ${item.durationMs ?? 0}ms.`,
    timeline: steps.map((step, index) => ({
      id: step.id || `step-${index}`,
      label: step.title || step.stepName || `Step ${index + 1}`,
      status: mapReplayStatus(step.status),
      detail: Array.isArray(step.missingEvidence) && step.missingEvidence.length
        ? `Evidências ausentes: ${step.missingEvidence.join(', ')}`
        : `actionType: ${step.actionType || 'unknown'}`,
    })),
    _live: true,
  };
}

// GET /api/qa-waves/scenarios -> { items: [{ id, waveId, vertical, name, status,
//   executionStatus, channels: [], risk, priority, ... }] }
function mapQaScenarios(payload) {
  return (payload?.items || []).slice(0, SCENARIOS_LIMIT).map((scenario) => ({
    id: scenario.id,
    title: scenario.name || scenario.id,
    channel: Array.isArray(scenario.channels) && scenario.channels.length ? scenario.channels[0] : 'api',
    status: String(scenario.executionStatus || scenario.status || 'queued').toLowerCase(),
    durationMs: 0, // cenários ainda não executados (executionStatus=queued) não têm duração
    coverage: scenario.risk || scenario.priority || '-',
    workItemId: scenario.waveId || null,
    executionId: null,
    replayId: null,
    _live: true,
  }));
}

// --- fetch orquestrado ------------------------------------------------------

async function fetchReplays() {
  const list = await apiGet('/api/qa-waves/replays');
  const items = (list?.items || []).slice(0, REPLAY_DETAILS_LIMIT);
  const details = await Promise.all(
    items.map((item) =>
      apiGet(`/api/qa-waves/replays/${encodeURIComponent(item.id)}`).catch(() => null),
    ),
  );
  return items.map((item, index) => mapReplaySummary(item, details[index]));
}

// Busca todos os domínios LIVE em paralelo. Cada domínio é independente:
// se um falhar (403, 404, rede), ele NÃO derruba os demais — o orquestrador
// faz fallback para o mock daquele domínio e marca a fonte como 'mock'.
export async function fetchLiveDomains() {
  const [wavesResult, journeyResult, executionsResult, replaysResult, scenariosResult, statusResult] =
    await Promise.allSettled([
      apiGet('/api/qa-waves/waves'),
      apiGet('/api/qa-waves/journey-status'),
      apiGet(`/api/executions?limit=${EXECUTIONS_LIMIT}`),
      fetchReplays(),
      apiGet('/api/qa-waves/scenarios'),
      apiGet('/system/status'),
    ]);

  const domains = {};
  const sources = {};
  const errors = {};

  function settle(domain, result, build) {
    if (result.status === 'fulfilled') {
      try {
        domains[domain] = build(result.value);
        sources[domain] = 'live';
        return;
      } catch (buildError) {
        errors[domain] = buildError?.message || 'mapper_failed';
      }
    } else {
      errors[domain] = result.reason?.message || 'request_failed';
    }
    sources[domain] = 'mock'; // fallback explícito
  }

  // waves depende também do journey-status (falhas por domínio); se qualquer
  // um dos dois falhar, a wave cai para mock.
  if (wavesResult.status === 'fulfilled') {
    try {
      domains.operationWaves = mapWaves(
        wavesResult.value,
        journeyResult.status === 'fulfilled' ? journeyResult.value : null,
      );
      sources.operationWaves = 'live';
      if (journeyResult.status === 'rejected') {
        errors.journeyStatus = journeyResult.reason?.message || 'request_failed';
      }
    } catch (buildError) {
      sources.operationWaves = 'mock';
      errors.operationWaves = buildError?.message || 'mapper_failed';
    }
  } else {
    sources.operationWaves = 'mock';
    errors.operationWaves = wavesResult.reason?.message || 'request_failed';
  }

  settle('healthDomains', statusResult, mapHealthDomains);
  settle('executions', executionsResult, mapExecutions);
  settle('replays', replaysResult, (items) => items);
  settle('qaScenarios', scenariosResult, mapQaScenarios);

  return { domains, sources, errors };
}
