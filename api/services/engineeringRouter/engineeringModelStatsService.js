'use strict';

/**
 * api/services/engineeringRouter/engineeringModelStatsService.js
 *
 * Dados para a UI "Models / Model Router": registry real (capabilities/roles/provider/enabled)
 * + telemetria básica acumulada real (a partir de EngineeringTelemetryEvent). V1 não faz
 * nenhum ranking adaptativo — apenas soma/média do que já aconteceu.
 */

const { listCapabilityEntries } = require('../../../engine/engineeringRouter/modelCapabilities');
const { buildAvailableModels } = require('./engineeringModelAvailabilityService');
const getEngineeringTelemetryEventModel = require('../../db/models/EngineeringTelemetryEvent');

async function listModelsWithStats({ tenantId } = {}) {
  const availableModels = await buildAvailableModels({ tenantId });
  const Telemetry = getEngineeringTelemetryEventModel();

  const events = await Telemetry.findAll({ attributes: ['provider', 'model', 'result', 'latency_ms', 'estimated_cost', 'task_id'] });

  const statsByKey = new Map();
  for (const ev of events) {
    const key = `${ev.provider}:${ev.model}`;
    if (!statsByKey.has(key)) {
      statsByKey.set(key, { tasks: new Set(), successes: 0, failures: 0, totalLatency: 0, latencyCount: 0, knownCost: 0, unknownCost: 0 });
    }
    const entry = statsByKey.get(key);
    if (ev.task_id) entry.tasks.add(ev.task_id);
    if (ev.result === 'SUCCESS') entry.successes += 1;
    else entry.failures += 1;
    if (Number.isFinite(ev.latency_ms)) {
      entry.totalLatency += ev.latency_ms;
      entry.latencyCount += 1;
    }
    if (ev.estimated_cost === 'UNKNOWN') entry.unknownCost += 1;
    else entry.knownCost += 1;
  }

  return availableModels.map((m) => {
    const key = `${m.providerId}:${m.modelId}`;
    const stats = statsByKey.get(key);
    return {
      providerId: m.providerId,
      modelId: m.modelId,
      roles: m.roles,
      capabilities: m.capabilities,
      contextClass: m.contextClass,
      costClass: m.costClass,
      enabled: m.enabled,
      healthy: m.healthy,
      hasCredential: m.hasCredential,
      telemetry: stats ? {
        tasks: stats.tasks.size,
        successes: stats.successes,
        failures: stats.failures,
        averageLatencyMs: stats.latencyCount > 0 ? Math.round(stats.totalLatency / stats.latencyCount) : null,
        costKnown: stats.knownCost,
        costUnknown: stats.unknownCost,
      } : { tasks: 0, successes: 0, failures: 0, averageLatencyMs: null, costKnown: 0, costUnknown: 0 },
    };
  });
}

function listAllCapabilityKeys() {
  return listCapabilityEntries().map((e) => `${e.providerId}:${e.modelId}`);
}

module.exports = {
  listModelsWithStats,
  listAllCapabilityKeys,
};
