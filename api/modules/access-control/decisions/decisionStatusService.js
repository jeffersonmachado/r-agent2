const repository = require('../accessControlRepository');

const DEFAULT_PENDING_CRITICAL_AGE_MS = 3 * 60 * 1000;

function getPendingCriticalAgeMs() {
  const raw = Number(process.env.ACCESS_CONTROL_PENDING_CRITICAL_AGE_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_PENDING_CRITICAL_AGE_MS;
}

function parsePositiveMs(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return null;
}

function readThresholdFromContainer(container, source, { unitId = null } = {}) {
  if (!container || typeof container !== 'object') return null;

  const byUnit = container.pending_critical_age_by_unit || container.pendingCriticalAgeByUnit || null;
  if (unitId && byUnit && typeof byUnit === 'object') {
    const unitValue = parsePositiveMs(byUnit[unitId]);
    if (unitValue) {
      return {
        threshold_ms: unitValue,
        threshold_source: `${source}:unit`,
      };
    }
  }

  const directValue = parsePositiveMs(container.pending_critical_age_ms || container.pendingCriticalAgeMs);
  if (directValue) {
    return {
      threshold_ms: directValue,
      threshold_source: source,
    };
  }

  const ops = container.ops && typeof container.ops === 'object' ? container.ops : null;
  if (ops) {
    const opsByUnit = ops.pending_critical_age_by_unit || ops.pendingCriticalAgeByUnit || null;
    if (unitId && opsByUnit && typeof opsByUnit === 'object') {
      const unitValue = parsePositiveMs(opsByUnit[unitId]);
      if (unitValue) {
        return {
          threshold_ms: unitValue,
          threshold_source: `${source}:ops_unit`,
        };
      }
    }
    const opsValue = parsePositiveMs(ops.pending_critical_age_ms || ops.pendingCriticalAgeMs);
    if (opsValue) {
      return {
        threshold_ms: opsValue,
        threshold_source: `${source}:ops`,
      };
    }
  }

  return null;
}

async function resolvePendingCriticalConfig({ tenantId, decision }) {
  const directDecisionConfig = readThresholdFromContainer(decision?.metadata, 'decision_metadata');
  if (directDecisionConfig) return directDecisionConfig;

  let device = null;
  if (decision?.device_id) {
    device = await repository.findDevice({
      tenantId,
      where: { id: String(decision.device_id) },
    });
  }

  const unitId = device?.unit_id || device?.location || decision?.metadata?.unitId || null;
  const policyId = decision?.metadata?.policyId || decision?.metadata?.policy_id || null;
  if (policyId) {
    const policy = await repository.findPolicy({
      tenantId,
      where: { id: String(policyId) },
    });
    const policyMetadataConfig = readThresholdFromContainer(policy?.metadata, 'policy_metadata', { unitId });
    if (policyMetadataConfig) return policyMetadataConfig;
    const policyGraceConfig = readThresholdFromContainer(policy?.grace_policy, 'policy_grace_policy', { unitId });
    if (policyGraceConfig) return policyGraceConfig;
  }

  const deviceConfig = readThresholdFromContainer(device?.metadata, 'device_metadata');
  if (deviceConfig) return deviceConfig;

  return {
    threshold_ms: getPendingCriticalAgeMs(),
    threshold_source: 'environment_default',
  };
}

function normalizeAckStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) return 'pending';
  if (['executed', 'success', 'allowed', 'completed'].includes(status)) return 'executed';
  if (['failed', 'error', 'denied', 'not_executed'].includes(status)) return 'failed';
  if (['pending', 'queued', 'sent'].includes(status)) return 'pending';
  return status;
}

function resolvePendingCritical({ decision, executionStatus, nowMs = Date.now(), thresholdMs = getPendingCriticalAgeMs() }) {
  if (executionStatus !== 'pending') return false;
  const issuedAtMs = decision?.issued_at ? new Date(decision.issued_at).getTime() : null;
  if (!Number.isFinite(issuedAtMs)) return false;
  return (nowMs - issuedAtMs) >= thresholdMs;
}

async function getDecisionExecutionStatus({ tenantId, decisionId }) {
  const decision = await repository.findDecision({
    tenantId,
    where: { id: String(decisionId) },
  });
  if (!decision) return null;

  const events = await repository.listEvents({
    tenantId,
    where: { decision_id: String(decisionId) },
    order: [['occurred_at', 'DESC']],
    limit: 100,
  });

  const nowMs = Date.now();
  const expiresAtMs = decision.expires_at ? new Date(decision.expires_at).getTime() : null;
  const callbackEvent = events.find((event) => event.event_type === 'device_callback') || null;
  const accessEvent = events.find((event) => event.event_type === 'entry' || event.event_type === 'exit') || null;
  const denyEvent = events.find((event) => event.event_type === 'deny') || null;

  let executionStatus = 'pending';
  if (callbackEvent) {
    executionStatus = normalizeAckStatus(callbackEvent.raw_payload?.status);
  } else if (accessEvent) {
    executionStatus = 'executed';
  } else if (denyEvent) {
    executionStatus = 'failed';
  } else if (expiresAtMs && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    executionStatus = 'expired';
  }

  const pendingCriticalConfig = await resolvePendingCriticalConfig({
    tenantId,
    decision,
  });
  const pending_critical = resolvePendingCritical({
    decision,
    executionStatus,
    nowMs,
    thresholdMs: pendingCriticalConfig.threshold_ms,
  });

  return {
    decision,
    execution_status: executionStatus,
    pending_critical,
    pending_critical_threshold_ms: pendingCriticalConfig.threshold_ms,
    pending_critical_threshold_source: pendingCriticalConfig.threshold_source,
    callback_event: callbackEvent,
    access_event: accessEvent,
    deny_event: denyEvent,
    events,
  };
}

async function listDecisionExecutionStatuses({ tenantId, decisions = [], executionStatus = null, pendingCriticalOnly = false }) {
  const items = await Promise.all((Array.isArray(decisions) ? decisions : []).map(async (decision) => {
    const status = await getDecisionExecutionStatus({ tenantId, decisionId: decision.id });
    if (!status) {
      return {
        ...decision,
        execution_status: 'unknown',
      };
    }
    return {
      ...decision,
      execution_status: status.execution_status,
      pending_critical: status.pending_critical === true,
      pending_critical_threshold_ms: status.pending_critical_threshold_ms || null,
      pending_critical_threshold_source: status.pending_critical_threshold_source || null,
      callback_event: status.callback_event,
      access_event: status.access_event,
      deny_event: status.deny_event,
    };
  }));
  let filtered = items;
  if (executionStatus) {
    filtered = filtered.filter((item) => item.execution_status === String(executionStatus));
  }
  if (pendingCriticalOnly) {
    filtered = filtered.filter((item) => item.pending_critical === true);
  }
  return filtered;
}

function summarizeDecisionExecutionStatuses(items = []) {
  const summary = {
    total: 0,
    pending: 0,
    pending_critical: 0,
    executed: 0,
    failed: 0,
    expired: 0,
    unknown: 0,
  };

  for (const item of Array.isArray(items) ? items : []) {
    summary.total += 1;
    const key = Object.prototype.hasOwnProperty.call(summary, item.execution_status)
      ? item.execution_status
      : 'unknown';
    summary[key] += 1;
    if (item.pending_critical === true) {
      summary.pending_critical += 1;
    }
  }

  return summary;
}

async function getDecisionHealthSnapshot({ tenantId, limit = 100 } = {}) {
  const decisions = await repository.listDecisions({
    tenantId,
    where: {},
    order: [['issued_at', 'DESC']],
    limit: Math.min(Number(limit) || 100, 300),
  });
  const items = await listDecisionExecutionStatuses({ tenantId, decisions });
  const summary = summarizeDecisionExecutionStatuses(items);
  const pendingCriticalItems = items.filter((item) => item.pending_critical === true);
  const failedItems = items.filter((item) => item.execution_status === 'failed');

  return {
    threshold_ms: getPendingCriticalAgeMs(),
    threshold_scope: 'policy_device_aware',
    summary,
    has_incidents: pendingCriticalItems.length > 0 || summary.failed > 0,
    pending_critical_items: pendingCriticalItems.slice(0, 20),
    failed_items: failedItems.slice(0, 20),
  };
}

module.exports = {
  getDecisionExecutionStatus,
  listDecisionExecutionStatuses,
  summarizeDecisionExecutionStatuses,
  getDecisionHealthSnapshot,
  DEFAULT_PENDING_CRITICAL_AGE_MS,
  getPendingCriticalAgeMs,
};
