'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('./qaMeshService');
const { getRpaReplayDir } = require('../../lib/rpaPathResolver');
const { clearExecutions } = require('../../qa-mesh/executionQueue');
const logger = require('../utils/logger');
const qaWavesLogger = require('../utils/qaWavesLogger');
const { emitEvent } = require('./websocketService');
const qaWavesReplayAdapter = require('./qaWavesReplayAdapter');
const qaWavesExecutionEngine = require('./qaWavesExecutionEngine');
const stateSnapshotService = require('./qa/stateSnapshotService');
const operationalReplayValidator = require('./qa/operationalReplayValidator');
const operationalStepExecutor = require('./qa/operationalStepExecutor');
const browserOperationalRunner = require('./qa/browserOperationalRunner');
const { computeRealSnapshotDiff } = require('../../qa/evidence/evidenceProofValidator');
const {
  deriveStepScopedMutations,
  POST_STATE_MUTATION_CONTRACTS,
} = require('../../qa/evidence/postStateProofValidator');
const { buildSupportTicketFlowSteps } = require('./qa/journeyStepDefinitions/supportTicketFlowSteps');
const { buildFitnessCheckinFlowSteps } = require('./qa/journeyStepDefinitions/fitnessCheckinFlowSteps');
const {
  buildSupportOperationalSeedSpec,
  provisionSupportSeed,
  validateSupportSeedPostExecution,
} = require('./qa/seeds/supportOperationalSeed');
const {
  buildFitnessOperationalSeedSpec,
  provisionFitnessSeed,
  validateFitnessSeedPostExecution,
} = require('./qa/seeds/fitnessOperationalSeed');

const ROOT_DIR = path.join(__dirname, '..', '..');
const EVIDENCE_ROOT = path.join(ROOT_DIR, 'qa-mesh', 'meshEvidence');
const MESH_REGISTRY_PATH = path.join(ROOT_DIR, 'qa-mesh', 'meshRegistry.json');

let _meshRegistryCache = null;
function getMeshRegistry() {
  if (_meshRegistryCache) return _meshRegistryCache;
  try {
    _meshRegistryCache = JSON.parse(fs.readFileSync(MESH_REGISTRY_PATH, 'utf8'));
  } catch (_) {
    _meshRegistryCache = [];
  }
  return _meshRegistryCache;
}

function resolvePlatformAdapter(platformScenarioIds = []) {
  if (platformScenarioIds.length === 0) return 'unknown';
  const registry = getMeshRegistry();
  const adapters = platformScenarioIds.map((id) => {
    const entry = registry.find((r) => r.id === id);
    if (!entry) {
      logger.error('[QaWavesExecutionService] Cenário não encontrado no mesh registry', {
        scenarioId: id,
        registryIds: registry.map((r) => r.id),
      });
      const error = new Error(`Cenário "${id}" não encontrado no mesh registry. Verifique platformScenarioIds.`);
      error.code = 'INVALID_PLATFORM_SCENARIO_ID';
      throw error;
    }
    return entry.adapter || 'api';
  });
  // Se qualquer cenário usa rpa, considera rpa; senão api
  return adapters.includes('rpa') ? 'rpa' : (adapters[0] || 'api');
}
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLLS = 120;

// Cache do índice de replays com validação por mtime
let replayArtifactsIndexCache = null;
let replayArtifactsIndexCacheMtime = null;
const REPLAY_ARTIFACT_PREFIX_BYTES = 16 * 1024;
const replayArtifactMetaCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readFilePrefix(filePath, maxBytes = REPLAY_ARTIFACT_PREFIX_BYTES) {
  let fd;
  try {
    const stats = fs.statSync(filePath);
    const bytesToRead = Math.max(0, Math.min(Number(stats.size) || 0, maxBytes));
    if (bytesToRead === 0) return '';
    const buffer = Buffer.alloc(bytesToRead);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // noop
      }
    }
  }
}

function extractJsonStringField(prefix, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = pattern.exec(prefix);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (_) {
    return match[1];
  }
}

function buildReplayArtifactMeta(replay) {
  if (!replay || typeof replay !== 'object') return null;
  const executionId = replay.executionId || null;
  if (!executionId) return null;
  return {
    executionId,
    replayId: replay.replayId || replay.id || null,
    waveId: replay.waveId || null,
    journeyId: replay.journeyId || null,
    journeyStep: replay.journeyStep || null,
    scenarioId: replay.scenarioId || null,
    seedId: replay.seedId || null,
    status: replay.status || null,
    finishedAt: replay.finishedAt || null,
    platformAdapter: replay.platformAdapter || null,
  };
}

function extractReplayArtifactMeta(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (_) {
    return null;
  }

  const cacheKey = `${filePath}:${stats.mtimeMs}:${stats.size}`;
  const cached = replayArtifactMetaCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const prefix = readFilePrefix(filePath);
  const fastMeta = buildReplayArtifactMeta({
    executionId: extractJsonStringField(prefix, 'executionId'),
    replayId: extractJsonStringField(prefix, 'replayId') || extractJsonStringField(prefix, 'id'),
    waveId: extractJsonStringField(prefix, 'waveId'),
    journeyId: extractJsonStringField(prefix, 'journeyId'),
    journeyStep: extractJsonStringField(prefix, 'journeyStep'),
    scenarioId: extractJsonStringField(prefix, 'scenarioId'),
    seedId: extractJsonStringField(prefix, 'seedId'),
    status: extractJsonStringField(prefix, 'status'),
    finishedAt: extractJsonStringField(prefix, 'finishedAt'),
    platformAdapter: extractJsonStringField(prefix, 'platformAdapter'),
  });

  const meta = fastMeta || buildReplayArtifactMeta(safeReadJson(filePath, null));
  replayArtifactMetaCache.clear();
  replayArtifactMetaCache.set(cacheKey, meta);
  return meta;
}

function safeWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeReplayArtifact({ executionId, replayId, scenario, seed, status = 'running', platformScenarioIds = [] }) {
  const replayDir = getRpaReplayDir();
  ensureDir(replayDir);
  const startedAt = nowIso();
  const scenarioName = scenario.name || scenario.title || scenario.id;
  const journeyId = scenario.journeyId || scenario.journey || null;
  const journeySteps = Array.isArray(scenario.journeySteps) ? scenario.journeySteps : [];
  const payload = {
    id: replayId,
    replayId,
    recordingId: scenario.id,
    type: 'qa_wave_rpa_replay',
    executionId,
    executionStatus: 'running',
    waveId: scenario.waveId,
    journeyId,
    journeySteps,
    journeyStep: journeySteps[0] || null,
    scenarioId: scenario.id,
    platformScenarioIds,
    platformAdapter: resolvePlatformAdapter(platformScenarioIds),
    scenarioName,
    stepId: scenario.steps?.[0]?.id || null,
    seedId: seed?.id || null,
    seedEvidence: seed?.seedEvidence || null,
    operationalSeedStatus: seed?.operationalSeedStatus || null,
    source: scenario.source,
    status,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    latency: null,
    timeline: [],
    actions: [],
    logs: [],
    errors: [],
    steps: [],
    assertions: Array.isArray(scenario.validators)
      ? scenario.validators.map((validator, index) => ({
        id: validator.id || `assertion_${index + 1}`,
        type: validator.type || 'validator',
        expected: validator.expected || null,
        status: 'pending',
      }))
      : [],
    screenshots: [],
    beforeSnapshot: null,
    afterSnapshot: null,
    stateSnapshotContract: null,
    stateMutation: null,
    operationalTimeline: [],
    semanticSteps: Array.isArray(scenario.semanticSteps) ? scenario.semanticSteps : (scenario.steps || []),
    tags: {
      waveId: scenario.waveId,
      journey: journeyId,
      scenario: scenario.id,
      seed: seed?.id || null,
      source: scenario.source,
      vertical: scenario.vertical,
    },
    mode: 'qa_waves_real',
    startTime: startedAt,
    endTime: null,
    result: status,
  };

  const fullPath = path.join(replayDir, `${replayId}.json`);
  safeWriteJson(fullPath, payload);
  return { replayId, path: fullPath, payload, scenario, seed };
}

function buildSnapshotContext(replayArtifact, phase, replay = {}) {
  const scenario = replayArtifact?.scenario || {};
  const seed = replayArtifact?.seed || {};
  const data = seed?.data || {};
  const seedEvidence = replayArtifact?.payload?.seedEvidence || seed?.seedEvidence || {};
  const seedProvision = seedEvidence?.provision || {};
  const inferredJourney = stateSnapshotService.normalizeJourneyId(
    scenario.journeyId || scenario.journey || scenario.journeySlug || scenario.id || replay.journeyId || ''
  );

  return {
    phase,
    tenantId: replay?.tenantId || data.tenantId || data.tenant_key || process.env.DEFAULT_TENANT_ID || 'system',
    journeyId: inferredJourney,
    scenario,
    seed,
    seedEvidence,
    replay,
    replayId: replayArtifact?.replayId || replay.replayId || replay.id || null,
    executionId: replayArtifact?.payload?.executionId || replay.executionId || null,
    ticketId: seedProvision.ticketId || data.ticketId || data.ticket_id || scenario.ticketId || null,
    conversationId: seedProvision.conversationId || data.conversationId || data.conversation_id || scenario.conversationId || null,
    contactId: seedProvision.contactId || data.contactId || data.customerId || data.customer_id || null,
    subjectId: seedProvision.subjectId || data.subjectId || data.subject_id || null,
    membershipId: seedProvision.membershipId || data.membershipId || data.membership_id || null,
    credentialId: seedProvision.credentialId || data.credentialId || data.credential_id || null,
    deviceId: seedProvision.deviceId || data.deviceId || data.device_id || null,
    deviceMode: seedProvision.deviceMode || data.deviceMode || data.device_mode || null,
    bookingId: data.bookingId || data.booking_id || null,
  };
}

function normalizeOperationalJourneyId(value = '') {
  return stateSnapshotService.normalizeJourneyId(value);
}

function isBlockingOperationalJourney(journeyId = '') {
  return ['support_ticket_flow', 'fitness_customer_checkin'].includes(normalizeOperationalJourneyId(journeyId));
}

function createInternalHttpClient() {
  if (typeof fetch !== 'function') return null;

  const baseUrl = process.env.INTERNAL_API_BASE_URL
    || process.env.API_BASE_URL
    || `http://127.0.0.1:${process.env.PORT || 3000}`;

  return async function httpClient(request = {}) {
    const method = request.method || 'GET';
    const target = new URL(request.url || '/', baseUrl).toString();
    const headers = {
      'content-type': 'application/json',
      ...(request.headers || {}),
    };
    const response = await fetch(target, {
      method,
      headers,
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  };
}

async function prepareOperationalSeedEntry(entry = {}, tenantId = null, httpClient = null) {
  const scenario = entry?.scenario || {};
  const rawSeed = entry?.seed || null;
  const journeyId = normalizeOperationalJourneyId(scenario.journeyId || scenario.journey || scenario.id || '');

  if (!isBlockingOperationalJourney(journeyId)) {
    return {
      ...entry,
      seed: rawSeed,
      preExecutionBlockers: [],
    };
  }

  const baseSeed = rawSeed || {
    id: `${journeyId}_operational_seed`,
    status: 'pending',
    data: {},
  };
  const mergedData = {
    ...(baseSeed.data || {}),
    tenantId: tenantId || baseSeed?.data?.tenantId || null,
  };

  if (!httpClient) {
    return {
      ...entry,
      seed: {
        ...baseSeed,
        data: mergedData,
        operationalSeedStatus: 'missing',
        seedEvidence: null,
      },
      preExecutionBlockers: [{ reason: 'operational_seed_http_client_unavailable', journeyId }],
    };
  }

  try {
    if (journeyId === 'support_ticket_flow') {
      const seedSpec = buildSupportOperationalSeedSpec({ ...mergedData, tenantId });
      const provision = await provisionSupportSeed(seedSpec, httpClient);
      if (!provision.ok) {
        return {
          ...entry,
          seed: {
            ...baseSeed,
            data: mergedData,
            operationalSeedStatus: 'missing',
            seedEvidence: { journeyId, status: 'missing', provision },
          },
          preExecutionBlockers: [{ reason: 'support_operational_seed_missing', journeyId, details: provision.reason || null }],
        };
      }

      return {
        ...entry,
        seed: {
          ...baseSeed,
          status: 'approved',
          data: {
            ...mergedData,
            ticketId: provision.ticketId,
            conversationId: provision.conversationId,
            contactId: provision.contactId,
          },
          operationalSeedStatus: 'ready',
          seedEvidence: {
            journeyId,
            status: 'ready',
            ticketId: provision.ticketId,
            conversationId: provision.conversationId,
            contactId: provision.contactId,
            beforeSnapshot: provision.beforeSnapshot || null,
            provision,
          },
        },
        preExecutionBlockers: [],
      };
    }

    if (journeyId === 'fitness_customer_checkin') {
      const seedSpec = buildFitnessOperationalSeedSpec({ ...mergedData, tenantId });
      const provision = await provisionFitnessSeed(seedSpec, httpClient);
      if (!provision.ok) {
        return {
          ...entry,
          seed: {
            ...baseSeed,
            data: mergedData,
            operationalSeedStatus: 'missing',
            seedEvidence: { journeyId, status: 'missing', provision },
          },
          preExecutionBlockers: [{ reason: 'fitness_operational_seed_missing', journeyId, details: provision.reason || null }],
        };
      }

      return {
        ...entry,
        seed: {
          ...baseSeed,
          status: 'approved',
          data: {
            ...mergedData,
            subjectId: provision.subjectId,
            membershipId: provision.membershipId,
            credentialId: provision.credentialId,
            deviceId: provision.deviceId,
            deviceMode: provision.deviceMode,
          },
          operationalSeedStatus: 'ready',
          seedEvidence: {
            journeyId,
            status: 'ready',
            subjectId: provision.subjectId,
            membershipId: provision.membershipId,
            credentialId: provision.credentialId,
            deviceId: provision.deviceId,
            deviceMode: provision.deviceMode,
            beforeSnapshot: provision.beforeSnapshot || null,
            provision,
          },
        },
        preExecutionBlockers: [],
      };
    }
  } catch (error) {
    return {
      ...entry,
      seed: {
        ...baseSeed,
        data: mergedData,
        operationalSeedStatus: 'missing',
        seedEvidence: {
          journeyId,
          status: 'missing',
          error: error.message,
        },
      },
      preExecutionBlockers: [{ reason: 'operational_seed_provision_failed', journeyId, details: error.message }],
    };
  }

  return {
    ...entry,
    seed: {
      ...baseSeed,
      data: mergedData,
      operationalSeedStatus: 'missing',
      seedEvidence: null,
    },
    preExecutionBlockers: [{ reason: 'operational_seed_missing', journeyId }],
  };
}

async function hydrateOperationalSeeds(expanded = [], tenantId = null, options = {}) {
  const httpClient = options.httpClient || createInternalHttpClient();
  const prepared = [];

  for (const entry of expanded) {
    prepared.push(await prepareOperationalSeedEntry(entry, tenantId, httpClient));
  }

  return prepared;
}

/**
 * Resolve os step specs para uma jornada.
 * Para jornadas blocking (support/fitness), usa step definitions reais com execute(page).
 * Para outras jornadas, usa os steps convertidos do replay adapter.
 */
function resolveJourneyStepSpecs(journeyId, runtimeSteps, seedData = {}) {
  if (journeyId === 'support_ticket_flow') {
    return buildSupportTicketFlowSteps(seedData);
  }
  if (journeyId === 'fitness_customer_checkin') {
    try {
      return buildFitnessCheckinFlowSteps(seedData);
    } catch (err) {
      // simulated_device proibido => retorna step inválido que gera NO_GO
      return [{
        id: 'step_fitness_seed_invalid',
        actionType: 'preflight_check',
        selectorUsed: null,
        journeyId,
        stepResult: { status: 'failed', error: err.message },
        screenshotBefore: null,
        screenshotAfter: null,
        url: null,
        domSnapshot: null,
        networkEvents: [],
        evidenceId: null,
        mutationLinkage: null,
        timestamp: new Date().toISOString(),
      }];
    }
  }
  return runtimeSteps;
}

async function normalizeOperationalRuntimeSteps({ replayArtifact, converted, previousReplay }) {
  const runtimeSteps = Array.isArray(converted?.steps) ? converted.steps : [];
  const journeyId = normalizeOperationalJourneyId(replayArtifact?.scenario?.journeyId || replayArtifact?.scenario?.journey || replayArtifact?.payload?.journeyId || '');
  const seedEvidence = replayArtifact?.seed?.seedEvidence || replayArtifact?.payload?.seedEvidence || null;
  const stateMutation = previousReplay?.stateMutation || null;
  const replayId = replayArtifact?.replayId || previousReplay?.replayId || null;
  const executionId = replayArtifact?.payload?.executionId || previousReplay?.executionId || null;

  // Para jornadas blocking: usa browser real + step definitions com execute(page)
  if (isBlockingOperationalJourney(journeyId)) {
    const seedData = {
      ...(replayArtifact?.seed?.data || {}),
      ...(seedEvidence?.provision || {}),
      ticketId: seedEvidence?.ticketId || null,
      conversationId: seedEvidence?.conversationId || null,
      contactId: seedEvidence?.contactId || null,
      subjectId: seedEvidence?.subjectId || null,
      membershipId: seedEvidence?.membershipId || null,
      credentialId: seedEvidence?.credentialId || null,
      credentialValue: seedEvidence?.provision?.credentialValue || null,
      deviceId: seedEvidence?.deviceId || null,
      deviceMode: seedEvidence?.deviceMode || null,
      agentReply: replayArtifact?.seed?.data?.agentReply || null,
      baseUrl: process.env.QA_BROWSER_BASE_URL || process.env.INTERNAL_API_BASE_URL || '',
    };

    const stepSpecs = resolveJourneyStepSpecs(journeyId, runtimeSteps, seedData);

    const browserResult = await browserOperationalRunner.executeBlockingJourneyWithBrowser(
      journeyId,
      stepSpecs,
      {
        replayId,
        executionId,
        stateMutation,
        seedEvidence,
        headless: true,
        initialUrl: seedData.baseUrl ? `${seedData.baseUrl}` : undefined,
        extraHTTPHeaders: seedEvidence?.authHeaders || {},
      }
    );

    return {
      steps: browserResult.steps || [],
      stepResults: browserResult.stepResults || [],
      blockers: browserResult.blockers || [],
      goNoGo: browserResult.goNoGo || null,
      executorUsed: browserResult.executorUsed,
      browserUsed: browserResult.browserUsed,
    };
  }

  // Para jornadas não-blocking: mantém comportamento existente (sem browser real)
  const stepResults = [];
  for (const step of runtimeSteps) {
    const result = await operationalStepExecutor.executeStep(step, null, {
      journeyId,
      replayId,
      executionId,
      stateMutation,
      seedEvidence,
    });
    stepResults.push(result);
  }

  return {
    steps: stepResults.map((item) => item.step),
    stepResults,
    blockers: stepResults.flatMap((item) => item.validation?.blockers || []),
    goNoGo: null,
    executorUsed: true,
    browserUsed: false,
  };
}

function validateOperationalSeedOutcome({ scenario, seed, replay }) {
  const journeyId = normalizeOperationalJourneyId(scenario?.journeyId || scenario?.journey || replay?.journeyId || '');
  if (!isBlockingOperationalJourney(journeyId)) {
    return { ok: true, blockers: [] };
  }

  const seedEvidence = seed?.seedEvidence || replay?.seedEvidence || null;
  if (!seedEvidence) {
    return { ok: false, blockers: [{ reason: 'operational_seed_missing', journeyId }] };
  }

  if (journeyId === 'support_ticket_flow') {
    const result = validateSupportSeedPostExecution(replay?.beforeSnapshot || {}, replay?.afterSnapshot || {});
    return { ok: result.ok, blockers: result.ok ? [] : result.blockers };
  }

  if (journeyId === 'fitness_customer_checkin') {
    const result = validateFitnessSeedPostExecution(replay?.beforeSnapshot || {}, replay?.afterSnapshot || {});
    return { ok: result.ok, blockers: result.ok ? [] : result.blockers };
  }

  return { ok: true, blockers: [] };
}

async function collectAndAttachSnapshot(replayArtifact, phase, replay = {}) {
  const snapshot = await stateSnapshotService.collectOperationalSnapshot(
    buildSnapshotContext(replayArtifact, phase, replay)
  );
  const field = phase === 'before' ? 'beforeSnapshot' : 'afterSnapshot';
  const current = safeReadJson(replayArtifact.path, replayArtifact.payload) || replayArtifact.payload;
  const patch = { [field]: snapshot };

  if (phase === 'after') {
    const beforeSnapshot = current.beforeSnapshot || replayArtifact.payload.beforeSnapshot || null;
    const snapshots = stateSnapshotService.captureTransitionSnapshots({
      before: beforeSnapshot,
      after: snapshot,
    });
    const contract = stateSnapshotService.validateSnapshotContracts({
      journeyId: snapshot?.metadata?.journeyId || current.journeyId,
      beforeSnapshot,
      afterSnapshot: snapshot,
    });
    patch.stateMutation = {
      valid: snapshots.mutationCount > 0,
      mutationCount: snapshots.mutationCount,
      sideEffects: snapshots.sideEffects,
      observedSideEffects: snapshots.observedSideEffects,
      reason: snapshots.mutationCount > 0 ? null : 'missing_real_state_mutation',
    };
    patch.stateSnapshotContract = contract;
    patch.operationalTimeline = buildOperationalTimeline({
      replay: current,
      beforeSnapshot,
      afterSnapshot: snapshot,
      stateMutation: patch.stateMutation,
      stateSnapshotContract: contract,
    });
  }

  return updateReplayArtifact(replayArtifact, patch);
}

function validatePostExecutionProofs(replay = {}) {
  const journeyContext = {
    journeyId: replay.journeyId || replay.scenario?.journeyId || '',
    executionMode: 'operational_go',
  };

  return operationalStepExecutor.validateJourneyPostStateProofs({
    beforeSnapshot: replay.beforeSnapshot || null,
    afterSnapshot: replay.afterSnapshot || null,
    executedSteps: Array.isArray(replay.steps) ? replay.steps : [],
    replay,
    journeyContext,
  });
}

function buildOperationalTimeline({ replay = {}, beforeSnapshot = {}, afterSnapshot = {}, stateMutation = {}, stateSnapshotContract = {} }) {
  const beforeState = beforeSnapshot?.state || replay.initialState || null;
  const afterState = afterSnapshot?.state || replay.finalState || null;
  const action = replay.steps?.find((step) => step?.action)?.action
    || replay.events?.find((event) => event?.action)?.action
    || 'execute_operational_journey';
  const sideEffects = Array.isArray(stateMutation?.observedSideEffects)
    ? stateMutation.observedSideEffects
    : [];
  const transitionStatus = stateMutation?.valid && stateSnapshotContract?.valid ? 'GO' : 'NO_GO';

  return [
    {
      id: 'initial_state',
      type: 'state',
      label: 'ANTES',
      state: beforeState,
      status: beforeSnapshot ? 'captured' : 'missing',
      evidence: beforeSnapshot,
    },
    {
      id: 'action',
      type: 'action',
      label: 'ACAO',
      action,
      status: replay.status || replay.result || 'unknown',
    },
    {
      id: 'transition',
      type: 'transition',
      label: 'TRANSICAO',
      from: beforeState,
      to: afterState,
      status: transitionStatus,
      blockers: stateSnapshotContract?.missing || [],
    },
    {
      id: 'final_state',
      type: 'state',
      label: 'DEPOIS',
      state: afterState,
      status: afterSnapshot ? 'captured' : 'missing',
      evidence: afterSnapshot,
    },
    {
      id: 'side_effects',
      type: 'side_effects',
      label: 'SIDE EFFECTS',
      status: sideEffects.length > 0 ? 'GO' : 'NO_GO',
      sideEffects,
      technicalEvidence: {
        mutationCount: stateMutation?.mutationCount || 0,
        snapshotContract: stateSnapshotContract?.valid ? 'passed' : 'failed',
      },
    },
  ];
}

function updateReplayArtifact(replayArtifact, patch = {}) {
  const current = safeReadJson(replayArtifact.path, replayArtifact.payload) || replayArtifact.payload;
  const merged = {
    ...current,
    ...patch,
  };
  safeWriteJson(replayArtifact.path, merged);
  replayArtifact.payload = merged;
  return merged;
}

function buildResultLatency(result, execution) {
  if (Number.isFinite(Number(result?.latency))) return Number(result.latency);
  const startedAt = result?.startedAt || execution?.startedAt || null;
  const finishedAt = result?.finishedAt || execution?.finishedAt || null;
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function normalizeBrowserSession({ result, rpaReplayData, replayArtifact }) {
  const rawResults = result?.rawStatus?.results || {};
  const browserName = rpaReplayData?.browser?.name || 'chromium';
  const browserVersion = rpaReplayData?.browser?.version || null;
  const viewport = rpaReplayData?.browser?.viewport || rawResults.viewport || { width: 1280, height: 720 };

  return {
    browser: {
      name: browserName,
      version: browserVersion,
      viewport,
    },
    tracePath: rawResults.tracePath || rpaReplayData?.tracePath || null,
    traceWarning: rawResults.traceWarning || null,
    rpaReplayPath: replayArtifact?.path || null,
    steps: Array.isArray(rpaReplayData?.steps) && rpaReplayData.steps.length > 0
      ? rpaReplayData.steps
      : (Array.isArray(rawResults.steps) ? rawResults.steps : []),
  };
}

function extractPrimaryReplayData(result) {
  const replayArtifact = Array.isArray(result?.artifacts)
    ? result.artifacts.find((a) => a.type === 'replay' && !a.summaryType)
    : null;

  const rpaReplayData = replayArtifact?.path
    ? safeReadJson(replayArtifact.path, null)
    : null;

  return { replayArtifact, rpaReplayData };
}

function findMeshResult(execution, platformScenarioIds = []) {
  const results = Array.isArray(execution?.results) ? execution.results : [];
  const matched = results.find((result) => platformScenarioIds.includes(result?.id));
  
  if (matched) return matched;
  
  // Se não encontrar correspondência exata com platformScenarioIds, é erro de correlação
  if (results.length > 0 && platformScenarioIds.length > 0) {
    logger.warn('[QaWavesExecutionService] Falha na correlação de resultado', {
      platformScenarioIds,
      availableResultIds: results.map((r) => r?.id),
      warning: 'Nenhum resultado encontrado para os cenários solicitados. Retornando null.',
    });
    return null;
  }
  
  // Se há resultados mas nenhum ID foi solicitado, retorna o primeiro (aceitável em contextos heurísticos)
  return results[0] || null;
}

function mapExecutionStatus(execution, result) {
  const raw = String(result?.status || execution?.status || '').toLowerCase();
  if (raw === 'passed' || raw === 'completed' || raw === 'success') {
    return { replayStatus: 'completed', publicResult: 'success', evidenceStatus: 'passed' };
  }
  if (raw === 'failed' || raw === 'error' || raw === 'failure') {
    return { replayStatus: 'failed', publicResult: 'failed', evidenceStatus: 'failed' };
  }
  return { replayStatus: 'failed', publicResult: 'failed', evidenceStatus: 'failed' };
}

/**
 * Reconstrói o estado de governança do ZERO a partir dos blockers reais.
 *
 * NÃO usa governanceBlockers anteriores do replay (evita contaminação por blockers temporários).
 * Deve ser chamado SOMENTE depois de:
 *   - afterSnapshot coletado
 *   - snapshotDiff computado
 *   - postStateProof validado
 *   - operationalReplayValidator executado
 *
 * @param {object} opts
 * @param {object[]} opts.blockers - blockers finais (runtime + seed + postState + operationalValidation + stepMutation)
 * @returns {{ governanceStatus: string, governanceBlockers: object[], result: string }}
 */
function rebuildGovernanceState({ blockers = [] } = {}) {
  const freshBlockers = Array.isArray(blockers) ? blockers.filter(Boolean) : [];
  const governanceStatus = freshBlockers.length === 0 ? 'GO' : 'NO_GO';
  const result = freshBlockers.length === 0 ? 'success' : 'failed';
  return {
    governanceStatus,
    governanceBlockers: freshBlockers,
    result,
  };
}

async function buildReplayPatch(replayArtifact, execution) {
  const result = findMeshResult(execution, replayArtifact.payload.platformScenarioIds || []);
  const status = mapExecutionStatus(execution, result);
  const finishedAt = execution?.finishedAt || result?.finishedAt || nowIso();
  const startedAt = replayArtifact.payload.startedAt || execution?.startedAt || nowIso();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const latency = buildResultLatency(result, execution);
  const errors = Array.isArray(result?.errors)
    ? result.errors
    : (execution?.error ? [{ message: execution.error }] : []);

  const { replayArtifact: rpaReplayArtifact, rpaReplayData } = extractPrimaryReplayData(result);
  let screens = [];
  let screenshots = [];
  if (rpaReplayData) {
    screens = Array.isArray(rpaReplayData.screens) ? rpaReplayData.screens : [];
    screenshots = screens
      .map((s) => s.screenshot)
      .filter((s) => typeof s === 'string' && s.length > 0);
  }

  const converted = qaWavesReplayAdapter.convertExecutionToReplay({
    replayId: replayArtifact.replayId,
    executionId: execution?.executionId || null,
    waveId: replayArtifact.scenario.waveId,
    journeyId: replayArtifact.scenario.journeyId || replayArtifact.scenario.journey || null,
    scenarioId: replayArtifact.scenario.id,
    seedId: replayArtifact.seed?.id || null,
    startedAt,
    finishedAt,
    durationMs,
    status: status.publicResult,
    errors,
    steps: Array.isArray(replayArtifact.scenario.semanticSteps)
      ? replayArtifact.scenario.semanticSteps
      : (replayArtifact.scenario.steps || []),
    platformAdapter: replayArtifact.payload.platformAdapter || null,
  }, normalizeBrowserSession({ result, rpaReplayData, replayArtifact: rpaReplayArtifact }));

  const previousReplay = safeReadJson(replayArtifact.path, replayArtifact.payload) || replayArtifact.payload;
  const operationalRuntime = await normalizeOperationalRuntimeSteps({
    replayArtifact,
    converted,
    previousReplay,
  });

  const semanticExecution = qaWavesExecutionEngine.executeScenario({
    semanticSteps: Array.isArray(replayArtifact.scenario.semanticSteps)
      ? replayArtifact.scenario.semanticSteps
      : (replayArtifact.scenario.steps || []),
    runtimeSteps: operationalRuntime.steps,
  });

  const replayStatus = converted.status;
  const baseReplayResult = replayStatus === 'success' ? 'success' : 'failed';
  const stateMutation = previousReplay.stateMutation || null;
  const stateSnapshotContract = previousReplay.stateSnapshotContract || null;
  const operationalTimeline = Array.isArray(previousReplay.operationalTimeline) ? previousReplay.operationalTimeline : [];

  // validateOperationalSeedOutcome e validateOperationalReplay são executados em
  // finalizeExecutionArtifacts APÓS collectAfterSnapshot() — nunca antes.
  // Aqui apenas preservamos o resultado base de execução (mesh status).
  const replayResult = baseReplayResult;

  return {
    executionStatus: String(execution?.status || 'completed').toLowerCase(),
    status: replayStatus,
    result: replayResult,
    // governanceStatus e governanceBlockers serão reconstruídos do zero em
    // finalizeExecutionArtifacts depois de afterSnapshot existir.
    governanceStatus: null,
    governanceBlockers: [],
    source: 'qa-waves',
    finishedAt,
    endTime: finishedAt,
    durationMs,
    latency,
    tracePath: converted.tracePath,
    browser: converted.browser,
    metadata: {
      ...(converted.metadata || {}),
      semanticStatus: semanticExecution.status || null,
      semanticErrorsCount: Array.isArray(semanticExecution.errors) ? semanticExecution.errors.length : 0,
      executorUsed: operationalRuntime.executorUsed === true,
      operationalSeedStatus: replayArtifact.seed?.operationalSeedStatus || previousReplay.operationalSeedStatus || null,
    },
    steps: semanticExecution.steps,
    journeySteps: semanticExecution.journeySteps,
    rpaSteps: semanticExecution.rpaSteps,
    events: semanticExecution.events,
    decisions: semanticExecution.decisions,
    evidence: semanticExecution.evidence,
    beforeSnapshot: previousReplay.beforeSnapshot || null,
    afterSnapshot: previousReplay.afterSnapshot || null,
    stateMutation,
    stateSnapshotContract,
    seedEvidence: replayArtifact.seed?.seedEvidence || previousReplay.seedEvidence || null,
    operationalSeedStatus: replayArtifact.seed?.operationalSeedStatus || previousReplay.operationalSeedStatus || null,
    // operationalValidation será preenchido em finalizeExecutionArtifacts
    operationalValidation: null,
    operationalTimeline,
    logs: Array.isArray(result?.logs) ? result.logs : [],
    timeline: Array.isArray(result?.logs) ? result.logs : [],
    errors: [...converted.errors, ...(semanticExecution.errors || [])],
    assertions: Array.isArray(replayArtifact.payload.assertions)
      ? replayArtifact.payload.assertions.map((assertion) => ({
        ...assertion,
        status: 'pending',
      }))
      : [],
    meshExecution: {
      executionId: execution?.executionId || null,
      historyPath: execution?.historyPath || null,
      summary: execution?.summary || null,
      resultId: result?.id || null,
      scenarioContext: execution?.payload?.scenarioContext || [],
    },
    screens,
    screenshots,
    screenCount: screens.length,
    // _runtimeBlockers: blockers do browser/executor para uso em finalizeExecutionArtifacts.
    // Não é persistido em disco — extraído antes de updateReplayArtifact.
    _runtimeBlockers: operationalRuntime.blockers || [],
  };
}

function writeEvidenceArtifact(replayArtifact, execution) {
  const result = findMeshResult(execution, replayArtifact.payload.platformScenarioIds || []);
  const status = mapExecutionStatus(execution, result);
  const waveId = replayArtifact.scenario.waveId;
  const evidenceDir = path.join(EVIDENCE_ROOT, waveId);
  ensureDir(evidenceDir);
  const fileName = `${execution.executionId}${replayArtifact.seed?.id ? `__${replayArtifact.seed.id}` : ''}.json`;
  const fullPath = path.join(evidenceDir, fileName);
  const semanticExecution = qaWavesExecutionEngine.executeScenario({
    semanticSteps: Array.isArray(replayArtifact.scenario.semanticSteps)
      ? replayArtifact.scenario.semanticSteps
      : (replayArtifact.scenario.steps || []),
    runtimeSteps: Array.isArray(result?.steps) ? result.steps : [],
  });

  const payload = {
    executionId: execution.executionId,
    scenarioId: replayArtifact.scenario.id,
    waveId,
    journeyId: replayArtifact.scenario.journeyId || replayArtifact.scenario.journey || null,
    journeyStep: replayArtifact.scenario.journeySteps?.[0] || null,
    journeySteps: Array.isArray(replayArtifact.scenario.journeySteps) ? replayArtifact.scenario.journeySteps : [],
    seedId: replayArtifact.seed?.id || null,
    status: status.evidenceStatus,
    steps: semanticExecution.steps,
    journeyStepsSemantic: semanticExecution.journeySteps,
    rpaSteps: semanticExecution.rpaSteps,
    events: semanticExecution.events,
    decisions: semanticExecution.decisions,
    evidence: semanticExecution.evidence,
    latency: buildResultLatency(result, execution),
    errors: Array.isArray(result?.errors)
      ? [...result.errors, ...(semanticExecution.errors || [])]
      : (execution?.error ? [{ message: execution.error }] : [...(semanticExecution.errors || [])]),
    generatedAt: nowIso(),
    replayId: replayArtifact.replayId,
    historyPath: execution?.historyPath || null,
  };

  safeWriteJson(fullPath, payload);
  return { filePath: fullPath, payload };
}

async function finalizeExecutionArtifacts(execution, replayArtifacts = []) {
  const finalized = [];
  for (const replayArtifact of replayArtifacts) {
    if (replayArtifact.beforeSnapshotPromise && typeof replayArtifact.beforeSnapshotPromise.then === 'function') {
      try {
        await replayArtifact.beforeSnapshotPromise;
      } catch (error) {
        updateReplayArtifact(replayArtifact, {
          governanceStatus: 'NO_GO',
          governanceBlockers: [{
            reason: 'snapshot_before_collection_failed',
            phase: 'before',
            error: error?.message || 'unknown_snapshot_error',
          }],
        });
      }
    }
    let currentReplay = safeReadJson(replayArtifact.path, replayArtifact.payload) || replayArtifact.payload;
    try {
      // PASSO 1: Executa/adapta runtime e persiste replay-base (somente step execution).
      const replayBasePatch = await buildReplayPatch(replayArtifact, execution);
      // Extrair blockers do runtime ANTES de persistir (campo privado, não vai para disco).
      const runtimeBlockers = Array.isArray(replayBasePatch._runtimeBlockers) ? replayBasePatch._runtimeBlockers : [];
      delete replayBasePatch._runtimeBlockers;
      currentReplay = updateReplayArtifact(replayArtifact, replayBasePatch);

      // PASSO 2: Coleta snapshot AFTER real após a execução dos steps.
      currentReplay = await collectAndAttachSnapshot(replayArtifact, 'after', currentReplay);

      // PASSO 3: Snapshot diff real do replay final (requisito de governança).
      currentReplay = updateReplayArtifact(replayArtifact, {
        snapshotDiff: computeRealSnapshotDiff(
          currentReplay.beforeSnapshot || null,
          currentReplay.afterSnapshot || null,
        ),
      });

      // PASSO 4: Correlacionar mutações por step (step ↔ mutation correlation real).
      // Determina quais mutações do diff global são atribuíveis a cada step.
      const journeyStepScopedMutations = deriveStepScopedMutations(
        Array.isArray(currentReplay.steps) ? currentReplay.steps : [],
        currentReplay.beforeSnapshot || null,
        currentReplay.afterSnapshot || null,
        currentReplay.snapshotDiff || null,
      );
      currentReplay = updateReplayArtifact(replayArtifact, {
        stepScopedMutations: journeyStepScopedMutations,
      });

      // PASSO 5: Valida prova pós-execução com before/after reais e anexa proof chain.
      const postStateValidation = validatePostExecutionProofs(currentReplay);
      currentReplay = updateReplayArtifact(replayArtifact, {
        steps: postStateValidation.steps,
        postStateProof: postStateValidation.postStateSummary,
      });

      // PASSO 6: validateOperationalReplay AGORA que afterSnapshot existe.
      // (Nunca antes — evita blockers temporários por afterSnapshot ausente.)
      const operationalValidation = operationalReplayValidator.validateOperationalReplay(currentReplay);

      // PASSO 7: validateOperationalSeedOutcome com afterSnapshot real.
      const seedValidation = validateOperationalSeedOutcome({
        scenario: replayArtifact.scenario,
        seed: replayArtifact.seed,
        replay: currentReplay,
      });

      // PASSO 8: Blockers de correlação step ↔ mutation (diff global sem step responsável => NO_GO).
      const stepMutationBlockers = journeyStepScopedMutations
        .filter((s) => s.goNoGo === 'NO_GO')
        .map((s) => ({
          reason: 'step_mutation_correlation_failed',
          stepId: s.stepId,
          actionType: s.actionType,
          expected: POST_STATE_MUTATION_CONTRACTS[s.stepId] || POST_STATE_MUTATION_CONTRACTS[s.actionType] || [],
        }));

      // PASSO 9: rebuildGovernanceState DO ZERO — sem blockers antigos/temporários.
      const freshBlockers = [
        ...runtimeBlockers,
        ...(seedValidation.blockers || []),
        ...(postStateValidation.blockers || []),
        ...(!operationalValidation.preconditionFailed ? (operationalValidation.blockers || []) : []),
        ...stepMutationBlockers,
      ];
      const governance = rebuildGovernanceState({ blockers: freshBlockers });

      currentReplay = updateReplayArtifact(replayArtifact, {
        ...governance,
        operationalValidation: {
          isOperational: operationalValidation.isOperational,
          classification: operationalValidation.classification,
          percentage: operationalValidation.percentage,
          blockers: operationalValidation.blockers,
          preconditionFailed: operationalValidation.preconditionFailed || false,
        },
        assertions: Array.isArray(replayArtifact.payload.assertions)
          ? replayArtifact.payload.assertions.map((assertion) => ({
            ...assertion,
            status: governance.result === 'success' ? 'passed' : 'failed',
          }))
          : [],
      });
    } catch (error) {
      currentReplay = updateReplayArtifact(replayArtifact, {
        stateMutation: {
          valid: false,
          mutationCount: 0,
          sideEffects: [],
          observedSideEffects: [],
          reason: 'snapshot_after_collection_failed',
          error: error.message,
        },
        governanceStatus: 'NO_GO',
        governanceBlockers: [{ reason: 'snapshot_absent', error: error.message }],
      });
    }
    const replay = currentReplay;
    const evidence = writeEvidenceArtifact(replayArtifact, execution);
    finalized.push({ replay, evidence, currentReplay });
  }
  return finalized;
}

function monitorExecution(executionId, replayArtifacts, options = {}) {
  const pollIntervalMs = Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = Number(options.maxPolls) || DEFAULT_MAX_POLLS;
  const tenantId = options.tenantId || null;
  let attempts = 0;

  function emitWsUpdate(status, extra = {}) {
    const firstArtifact = replayArtifacts[0];
    emitEvent('qa-waves.execution.updated', {
      executionId,
      status,
      waveId: firstArtifact?.scenario?.waveId || null,
      journeyId: firstArtifact?.scenario?.journeyId || firstArtifact?.scenario?.journey || null,
      replayIds: replayArtifacts.map((a) => a.replayId),
      ...extra,
    }, { tenantId });
  }

  function poll() {
    attempts += 1;
    const execution = qaMeshService.getQueuedExecutionStatus(executionId);

    if (!execution) {
      if (attempts >= maxPolls) {
        finalizeExecutionArtifacts({
          executionId,
          status: 'failed',
          finishedAt: nowIso(),
          error: 'Execução não encontrada para reconciliar replay QA Waves',
          results: [],
        }, replayArtifacts).catch((error) => logger.error('[QaWavesExecutionService] Falha ao finalizar artifacts', error));
        emitWsUpdate('failed', { error: 'execution_not_found' });
        return;
      }
      setTimeout(poll, pollIntervalMs);
      return;
    }

    const rawStatus = String(execution.status || '').toLowerCase();
    if (rawStatus === 'queued' || rawStatus === 'running' || rawStatus === 'processing') {
      if (attempts >= maxPolls) {
        finalizeExecutionArtifacts({
          ...execution,
          status: 'failed',
          finishedAt: nowIso(),
          error: 'Timeout aguardando execução QA Waves',
        }, replayArtifacts).catch((error) => logger.error('[QaWavesExecutionService] Falha ao finalizar artifacts', error));
        emitWsUpdate('failed', { error: 'timeout' });
        return;
      }
      setTimeout(poll, pollIntervalMs);
      return;
    }

    finalizeExecutionArtifacts(execution, replayArtifacts)
      .then(() => {
        const finalStatus = String(execution.status || 'completed').toLowerCase();
        emitWsUpdate(finalStatus);
      })
      .catch((error) => {
        logger.error('[QaWavesExecutionService] Falha ao finalizar artifacts', error);
        emitWsUpdate('failed', { error: 'artifact_finalization_failed' });
      });
  }

  setTimeout(poll, pollIntervalMs);
}

async function executePreparedWaveScenarios({ expanded, platformScenarioIds, governanceFindings, tenantId = null, runtimeOptions = {} }) {
  const preparedExpanded = await hydrateOperationalSeeds(expanded, tenantId, runtimeOptions);
  const scenarioContext = preparedExpanded.map(({ scenario, seed }) => ({
    scenarioId: scenario.id,
    seedId: seed?.id || null,
    waveId: scenario.waveId,
    journeyId: scenario.journeyId || scenario.journey || null,
    journeySteps: Array.isArray(scenario.journeySteps) ? scenario.journeySteps : [],
    semanticSteps: Array.isArray(scenario.semanticSteps) ? scenario.semanticSteps : (scenario.steps || []),
    seedEvidence: seed?.seedEvidence || null,
  }));

  qaWavesLogger.info('[QA_WAVE_EXECUTION] Enfileirando execução QA Waves', {
    tenantId,
    scenarioIds: platformScenarioIds,
  });
  logger.info('[QA_WAVE_EXECUTION] Enfileirando execucao QA Waves', {
    scenarioCount: preparedExpanded.length,
    platformScenarioIds,
    scenarioContext,
  });

  const queued = qaMeshService.queueMeshRun({
    scenarioIds: platformScenarioIds,
    executionOrigin: 'qa_waves_real',
    scenarioContext,
    tenantId,
  });

  const replayArtifacts = preparedExpanded.map(({ scenario, seed, preExecutionBlockers }) => {
    const artifact = writeReplayArtifact({
      executionId: queued.executionId,
      replayId: makeId('qa_wave_replay'),
      scenario,
      seed,
      status: 'running',
      platformScenarioIds,
    });
    if (Array.isArray(preExecutionBlockers) && preExecutionBlockers.length > 0) {
      updateReplayArtifact(artifact, {
        governanceStatus: 'NO_GO',
        governanceBlockers: preExecutionBlockers,
        operationalSeedStatus: seed?.operationalSeedStatus || 'missing',
        seedEvidence: seed?.seedEvidence || null,
      });
    }
    return artifact;
  });

  const replayIds = replayArtifacts.map((item) => item.replayId);
  const primaryReplayId = replayArtifacts[0]?.replayId || null;

  const beforeSnapshotsPromise = Promise.all(replayArtifacts.map((artifact) => collectAndAttachSnapshot(artifact, 'before')))
    .catch((error) => {
      logger.error('[QaWavesExecutionService] Falha ao coletar snapshot inicial', error);
      for (const artifact of replayArtifacts) {
        updateReplayArtifact(artifact, {
          governanceStatus: 'NO_GO',
          governanceBlockers: [{ reason: 'snapshot_absent', phase: 'before', error: error.message }],
        });
      }
    });
  for (const artifact of replayArtifacts) {
    artifact.beforeSnapshotPromise = beforeSnapshotsPromise;
  }

  qaWavesLogger.info('[QA_REPLAY_LINKED] Replay(s) vinculados à execução QA Waves', { replayCount: replayArtifacts.length });
  logger.info('[QA_REPLAY_LINKED] Replay(s) vinculados a execucao QA Waves', {
    executionId: queued.executionId,
    replayIds,
    scenarioContext,
  });

  // Log estruturado imediato — permite rastrear a correlação executionId↔replayId
  // ANTES de qualquer operação assíncrona (monitoramento, WS push, etc.)
  qaWavesLogger.info('[QA_REPLAY_READY] Replay(s) criado(s) e disponíveis para consulta', { replayCount: replayArtifacts.length });
  logger.info('[QA_REPLAY_READY] Replay(s) criado(s) e disponivel(is) para consulta', {
    executionId: queued.executionId,
    replayId: primaryReplayId,
    replayIds,
    replayDir: getRpaReplayDir(),
  });

  emitEvent('qa-waves.execution.started', {
    executionId: queued.executionId,
    replayId: primaryReplayId,
    replayIds,
    scenarioCount: preparedExpanded.length,
    platformScenarioIds,
  }, { tenantId });

  monitorExecution(queued.executionId, replayArtifacts, { tenantId });

  return {
    executionId: queued.executionId,
    replayId: primaryReplayId,
    replayIds,
    platformScenarioIds,
    governance: governanceFindings,
  };
}

function buildReplayArtifactsIndex(executionIds = null) {
  const replayDir = getRpaReplayDir();
  const byExecutionId = new Map();
  
  if (!fs.existsSync(replayDir)) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }

  // Validar cache com mtime do diretório
  let dirStats;
  try {
    dirStats = fs.statSync(replayDir);
  } catch (_) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }
  
  const dirCacheKey = `${replayDir}:${dirStats.mtimeMs}`;
  if (
    replayArtifactsIndexCache &&
    replayArtifactsIndexCacheMtime === dirCacheKey &&
    (!executionIds || executionIds.size === 0)
  ) {
    // Cache válido: retornar sem rescanear
    return replayArtifactsIndexCache;
  }

  const targetExecutionIds = executionIds instanceof Set ? executionIds : null;
  if (targetExecutionIds && targetExecutionIds.size === 0) {
    return { byExecutionId, scannedFiles: 0, indexedFiles: 0 };
  }

  let scannedFiles = 0;
  let indexedFiles = 0;

  fs.readdirSync(replayDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .forEach((fileName) => {
      scannedFiles += 1;
      const replay = extractReplayArtifactMeta(path.join(replayDir, fileName));
      if (!replay) return;
      const executionId = replay.executionId;
      if (!executionId) return;
      if (targetExecutionIds && !targetExecutionIds.has(executionId)) return;
      const existing = byExecutionId.get(executionId) || [];
      existing.push({
        replayId: replay.replayId,
        waveId: replay.waveId || null,
        journeyId: replay.journeyId || null,
        journeyStep: replay.journeyStep || null,
        scenarioId: replay.scenarioId || null,
        seedId: replay.seedId || null,
        status: replay.status || null,
        finishedAt: replay.finishedAt || null,
        platformAdapter: replay.platformAdapter || null,
      });
      byExecutionId.set(executionId, existing);
      indexedFiles += 1;
    });

  const result = { byExecutionId, scannedFiles, indexedFiles };
  
  // Armazenar em cache apenas se não há filtro de executionIds (full index)
  if (!targetExecutionIds) {
    replayArtifactsIndexCache = result;
    replayArtifactsIndexCacheMtime = dirCacheKey;
  }

  return result;
}

function listWaveExecutions(limit = 20) {
  const executions = qaMeshService.getAllExecutions(limit)
    .filter((execution) => execution?.payload?.executionOrigin === 'qa_waves_real')
  const executionIds = new Set(executions.map((execution) => execution.executionId).filter(Boolean));
  const startedAt = Date.now();
  const { byExecutionId: replayArtifactsIndex, scannedFiles, indexedFiles } = buildReplayArtifactsIndex(executionIds);
  const elapsedMs = Date.now() - startedAt;

  if (elapsedMs >= 1000) {
    qaMeshService.logger?.warn?.('[QaWavesExecutionService] listWaveExecutions lento', {
      elapsedMs,
      limit,
      executionCount: executions.length,
      scannedFiles,
      indexedFiles,
    });
  }

  return executions
    .map((execution) => ({
      ...execution,
      replayArtifacts: replayArtifactsIndex.get(execution.executionId) || [],
    }));
}

function clearWaveExecutions() {
  // 1. Limpa a fila em memória
  clearExecutions();

  // 2. Remove arquivos de meshHistory
  const meshHistoryDir = path.join(ROOT_DIR, 'qa-mesh', 'meshHistory');
  if (fs.existsSync(meshHistoryDir)) {
    for (const file of fs.readdirSync(meshHistoryDir)) {
      try {
        fs.unlinkSync(path.join(meshHistoryDir, file));
      } catch (_) { /* ignora */ }
    }
  }

  return { cleared: true };
}

module.exports = {
  buildSnapshotContext,
  hydrateOperationalSeeds,
  prepareOperationalSeedEntry,
  normalizeOperationalRuntimeSteps,
  executePreparedWaveScenarios,
  listWaveExecutions,
  clearWaveExecutions,
  writeReplayArtifact,
  updateReplayArtifact,
  writeEvidenceArtifact,
  validatePostExecutionProofs,
  finalizeExecutionArtifacts,
  monitorExecution,
  rebuildGovernanceState,
};
