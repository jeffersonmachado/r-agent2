'use strict';

const fs = require('fs');
const path = require('path');
const { discoverSystem } = require('./qa/systemDiscoveryEngine');
const { inferJourneys } = require('./qa/journeyInferenceService');
const { detectGaps } = require('./qa/gapDetectionEngine');
const autonomousGapClosureEngine = require('./qa/autonomousGapClosureEngine');
const paymentProvider = require('../integrations/paymentProvider');
const models = require('../db/models');
const ROOT_DIR = path.join(__dirname, '..', '..');
const JOURNEY_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'journey-contracts.json');
const OPERATIONAL_GAPS_REPORT_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'operational-gaps-report.json');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonSafe(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function pickFirstNonEmpty(values = []) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function buildRuntimeIntegrationHealth(tenantId, context = {}) {
  const AccessSubject = models.AccessSubject?.();
  const PbxTenant = models.PbxTenant?.();
  const AccessDevice = models.AccessDevice?.();

  return {
    crm: {
      health: async () => {
        if (!AccessSubject || typeof AccessSubject.count !== 'function') {
          return { ok: false, reason: 'crm_subject_model_unavailable' };
        }
        const count = await AccessSubject.count({ where: { tenant_key: tenantId }, limit: 1 });
        return {
          ok: true,
          evidence: {
            tenantId,
            contactsDetected: Number(count || 0),
            mode: 'db_probe',
          },
        };
      },
    },
    payment_gateway: {
      health: async () => {
        try {
          const provider = paymentProvider.normalizeProvider();
          return {
            ok: true,
            evidence: {
              provider,
              mode: provider === 'sandbox' ? 'sandbox_configured' : 'provider_configured',
            },
          };
        } catch (error) {
          return {
            ok: false,
            reason: `payment_provider_not_ready:${error.message}`,
          };
        }
      },
    },
    pbx: {
      health: async () => {
        if (!PbxTenant || typeof PbxTenant.count !== 'function') {
          return { ok: false, reason: 'pbx_tenant_model_unavailable' };
        }
        const count = await PbxTenant.count({ where: { tenantKey: tenantId }, limit: 1 });
        return {
          ok: count > 0,
          reason: count > 0 ? null : 'pbx_tenant_not_configured',
          evidence: {
            tenantId,
            tenantConfigured: count > 0,
            mode: 'db_probe',
          },
        };
      },
    },
    release_mechanism: {
      health: async () => {
        if (!AccessDevice || typeof AccessDevice.findOne !== 'function') {
          return { ok: false, reason: 'access_device_model_unavailable' };
        }

        const deviceId = safeString(context?.deviceId);
        if (!deviceId) {
          return { ok: false, reason: 'device_id_missing' };
        }

        const row = await AccessDevice.findOne({
          where: {
            tenant_key: tenantId,
            id: deviceId,
            status: 'active',
          },
        });

        if (!row) return { ok: false, reason: 'device_not_found_or_inactive' };
        const metadata = row.metadata || {};
        const heartbeatAt = metadata.heartbeatAt || metadata.lastHeartbeatAt || null;
        const integrationOk = metadata.integrationOk !== false;

        return {
          ok: Boolean(heartbeatAt) && integrationOk,
          reason: !heartbeatAt ? 'device_heartbeat_missing' : (integrationOk ? null : 'release_integration_unhealthy'),
          evidence: {
            deviceId,
            heartbeatAt,
            integrationOk,
          },
        };
      },
    },
  };
}

function attachRuntimeIntegrationContext(payload = {}) {
  const context = payload.context || {};
  const tenantId = safeString(payload.tenantId || context.tenantId);
  if (!tenantId) return payload;

  return {
    ...payload,
    context: {
      ...context,
      tenantId,
      integrations: {
        ...(context.integrations || {}),
        ...buildRuntimeIntegrationHealth(tenantId, context),
      },
    },
  };
}

function buildStagingAutonomousLoopPayload(options = {}) {
  const snapshot = options.snapshot || getOperationalSnapshot();
  const journeyId = safeString(options.journeyId)
    || pickFirstNonEmpty(Object.keys(snapshot?.journeyContracts || {}))
    || 'support_ticket_flow';

  const capabilityIds = Array.isArray(options.capabilityIds) && options.capabilityIds.length > 0
    ? options.capabilityIds
    : (snapshot?.journeyContracts?.[journeyId]?.requiredCapabilities || []).slice(0, 10);

  const tenantId = safeString(options.tenantId || process.env.DEFAULT_TENANT_ID || 'system');
  const scenarioIds = Array.isArray(options.scenarioIds) && options.scenarioIds.length > 0
    ? options.scenarioIds
    : ['staging-smoke-scenario-1'];

  const expectedConsequences = Array.isArray(options.expectedConsequences) && options.expectedConsequences.length > 0
    ? options.expectedConsequences
    : ['ticket_status_changed', 'crm_updated', 'audit_log_created'];

  const payload = {
    waveId: safeString(options.waveId || `wave-staging-smoke-${Date.now()}`),
    journeyId,
    scenarioIds,
    capabilityIds,
    tenantId,
    maxRetries: Number.isFinite(Number(options.maxRetries)) ? Number(options.maxRetries) : 1,
    expectedConsequences,
    context: {
      tenantId,
      ticketId: safeString(options.ticketId || process.env.DEFAULT_SMOKE_TICKET_ID || ''),
      contactId: safeString(options.contactId || process.env.DEFAULT_SMOKE_CONTACT_ID || ''),
      membershipId: safeString(options.membershipId || process.env.DEFAULT_SMOKE_MEMBERSHIP_ID || ''),
      credentialId: safeString(options.credentialId || process.env.DEFAULT_SMOKE_CREDENTIAL_ID || ''),
      deviceId: safeString(options.deviceId || process.env.DEFAULT_SMOKE_DEVICE_ID || ''),
      subscriptionId: safeString(options.subscriptionId || process.env.DEFAULT_SMOKE_SUBSCRIPTION_ID || ''),
    },
  };

  return attachRuntimeIntegrationContext(payload);
}

function buildOperationalSnapshot(options = {}) {
  const persist = options.persist !== false;
  const policy = {
    requireTraceForCritical: options.policy?.requireTraceForCritical !== false,
    requireScreenshotsForCritical: options.policy?.requireScreenshotsForCritical !== false,
    requireFreshReplayDays: Number(options.policy?.requireFreshReplayDays || 7),
  };

  const discoveryResult = discoverSystem({
    persist,
    replayFreshnessDays: policy.requireFreshReplayDays,
  });
  const journeyResult = inferJourneys({
    discovery: discoveryResult.discovery,
    capabilities: discoveryResult.capabilities,
    persist,
  });

  const journeyContractsStore = readJsonSafe(JOURNEY_CONTRACTS_PATH, { journeys: {} });
  const journeyContracts = journeyContractsStore.journeys || journeyResult.journeyContracts || {};

  const gapReport = detectGaps({
    discovery: discoveryResult.discovery,
    capabilities: discoveryResult.capabilities,
    dependencies: discoveryResult.dependencyGraph,
    journeyContracts,
    policy,
  });

  const summary = {
    generatedAt: nowIso(),
    goNoGo: gapReport.governance.goNoGo,
    capabilities: discoveryResult.capabilities.length,
    journeys: Object.keys(journeyContracts).length,
    gaps: {
      implementation: gapReport.gaps.implementation.length,
      e2e: gapReport.gaps.e2e.length,
      replay: gapReport.gaps.replay.length,
      ux: gapReport.gaps.ux.length,
      operational: gapReport.gaps.operational.length,
      stateBased: (gapReport.gaps.stateBased || []).length,
    },
  };

  const payload = {
    summary,
    discovery: discoveryResult.discovery,
    capabilities: discoveryResult.capabilities,
    dependencyGraph: discoveryResult.dependencyGraph,
    operationalGraph: discoveryResult.operationalGraph,
    journeys: journeyResult.journeys,
    journeyGraph: journeyResult.journeyGraph,
    journeyContracts,
    coverage: gapReport.coverage,
    finalCoverage: gapReport.finalCoverage,
    gaps: gapReport.gaps,
    replayCoverageAnalysis: gapReport.replayCoverageAnalysis,
    autoGeneration: gapReport.autoGeneration,
    governance: gapReport.governance,
    policy,
  };

  if (persist) {
    writeJsonSafe(OPERATIONAL_GAPS_REPORT_PATH, payload);
  }

  return payload;
}

function getOperationalSnapshot() {
  const cached = readJsonSafe(OPERATIONAL_GAPS_REPORT_PATH, null);
  if (cached) return cached;
  return buildOperationalSnapshot({ persist: true });
}

/**
 * Detecta gaps e gera remediações automáticas
 */
async function analyzeGapsForAutoClosure(options = {}) {
  const snapshot = getOperationalSnapshot();
  return autonomousGapClosureEngine.detectGapsWithAutoRemediations({
    discovery: snapshot.discovery,
    capabilities: snapshot.capabilities,
    dependencies: snapshot.dependencyGraph,
    journeyContracts: snapshot.journeyContracts,
    policy: snapshot.policy,
    tenantId: options.tenantId || 'system',
    persistGeneratedScenarios: options.persistGeneratedScenarios === true,
  });
}

/**
 * Gera report completo de closure automático
 */
async function generateGapClosureReport(options = {}) {
  const snapshot = getOperationalSnapshot();
  return autonomousGapClosureEngine.generateClosureReport({
    discovery: snapshot.discovery,
    capabilities: snapshot.capabilities,
    dependencies: snapshot.dependencyGraph,
    journeyContracts: snapshot.journeyContracts,
    policy: snapshot.policy,
    tenantId: options.tenantId || 'system',
    persistGeneratedScenarios: options.persistGeneratedScenarios === true,
  });
}

/**
 * Executa preflight validation
 */
async function validatePreflight(waveSpec = {}) {
  return autonomousGapClosureEngine.checkPreflightBlockers(waveSpec);
}

async function executeAutonomousGapClosureLoop(payload = {}) {
  const runtimePayload = attachRuntimeIntegrationContext(payload);
  return autonomousGapClosureEngine.runAutonomousGapClosureLoop(runtimePayload);
}

/**
 * Valida operacionalidade de um replay
 */
function validateReplayOperationality(replay = {}) {
  return autonomousGapClosureEngine.validateReplayOperationality(replay);
}

/**
 * Classifica operacionalidade de uma execução
 */
function classifyOperationality(executionTrace = {}, chainName = null) {
  return autonomousGapClosureEngine.classifyOperationality(executionTrace, chainName);
}

/**
 * Executa todos os health probes de integração e devolve mapa de readiness por integração.
 * Seguro para staging: sem side effects, apenas leitura/config check.
 */
async function runIntegrationReadinessProbe(payload = {}) {
  const context = payload.context || {};
  const integrations = context.integrations || {};
  const keys = Object.keys(integrations);

  const results = {};
  let allOk = true;

  await Promise.all(
    keys.map(async (key) => {
      const probe = integrations[key]?.health;
      if (typeof probe !== 'function') {
        results[key] = { ok: false, reason: `probe_not_a_function:${key}` };
        allOk = false;
        return;
      }
      try {
        const result = await probe();
        results[key] = result;
        if (!result?.ok) allOk = false;
      } catch (error) {
        results[key] = { ok: false, reason: `probe_threw:${error.message}` };
        allOk = false;
      }
    })
  );

  const notReady = Object.entries(results)
    .filter(([, r]) => !r.ok)
    .map(([k, r]) => ({ integration: k, reason: r.reason || 'health_failed' }));

  return {
    readinessAt: new Date().toISOString(),
    goNoGo: allOk ? 'GO' : 'NO_GO',
    allReady: allOk,
    notReady,
    integrations: results,
  };
}

module.exports = {
  buildOperationalSnapshot,
  getOperationalSnapshot,
  analyzeGapsForAutoClosure,
  generateGapClosureReport,
  validatePreflight,
  executeAutonomousGapClosureLoop,
  validateReplayOperationality,
  classifyOperationality,
  buildStagingAutonomousLoopPayload,
  runIntegrationReadinessProbe,
};
