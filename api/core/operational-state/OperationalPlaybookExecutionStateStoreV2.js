'use strict';

const { resolveOperationalPlaybookRunModel } = require('../operational-compat');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function mapExecutionToRow(execution, tenantId) {
  const tenantKey = safeString(execution?.tenantId) || safeString(tenantId);
  return {
    id: safeString(execution?.id),
    tenant_key: tenantKey,
    playbook_id: safeString(execution?.playbookId) || 'unknown',
    playbook_name: safeString(execution?.playbookName) || safeString(execution?.playbookId) || 'playbook',
    contact_id: safeString(execution?.contactId),
    signal_id: safeString(execution?.signalId),
    recommendation_id: safeString(execution?.recommendationId),
    operator_id: safeString(execution?.operatorId),
    status: safeString(execution?.status) || 'in_progress',
    current_step_index: Number.isFinite(Number(execution?.currentStepIndex)) ? Number(execution.currentStepIndex) : 0,
    steps_json: safeArray(execution?.steps),
    context_json: safeObject(execution?.context),
    last_error: safeString(execution?.lastError),
    completed_at: toIso(execution?.completedAt, null),
    aborted_at: toIso(execution?.abortedAt, null),
    created_at: toIso(execution?.createdAt, new Date().toISOString()),
    updated_at: toIso(execution?.updatedAt, new Date().toISOString()),
  };
}

function mapRowToExecution(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: safeString(item?.id),
    playbookId: safeString(item?.playbook_id),
    playbookName: safeString(item?.playbook_name),
    tenantId: safeString(item?.tenant_key),
    contactId: safeString(item?.contact_id),
    signalId: safeString(item?.signal_id),
    recommendationId: safeString(item?.recommendation_id),
    operatorId: safeString(item?.operator_id),
    status: safeString(item?.status) || 'in_progress',
    currentStepIndex: Number.isFinite(Number(item?.current_step_index)) ? Number(item.current_step_index) : 0,
    steps: safeArray(item?.steps_json),
    createdAt: toIso(item?.created_at, new Date().toISOString()),
    updatedAt: toIso(item?.updated_at, new Date().toISOString()),
    completedAt: toIso(item?.completed_at, null),
    abortedAt: toIso(item?.aborted_at, null),
    lastError: safeString(item?.last_error),
    context: safeObject(item?.context_json),
  };
}

async function upsertExecution({ tenantId, execution }) {
  const tenantKey = safeString(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const next = mapExecutionToRow(execution, tenantKey);
  if (!next.id) return { ok: false, error: 'execution_id_required' };

  const Model = resolveOperationalPlaybookRunModel();
  const existing = await Model.findByPk(next.id);
  if (existing) {
    const row = existing.toJSON ? existing.toJSON() : existing;
    if (String(row.tenant_key || '') !== tenantKey) {
      return { ok: false, error: 'execution_tenant_mismatch' };
    }
    await existing.update({
      playbook_id: next.playbook_id,
      playbook_name: next.playbook_name,
      contact_id: next.contact_id,
      signal_id: next.signal_id,
      recommendation_id: next.recommendation_id,
      operator_id: next.operator_id,
      status: next.status,
      current_step_index: next.current_step_index,
      steps_json: next.steps_json,
      context_json: next.context_json,
      last_error: next.last_error,
      completed_at: next.completed_at,
      aborted_at: next.aborted_at,
      updated_at: next.updated_at,
    });
    return { ok: true, execution: mapRowToExecution(existing) };
  }

  const created = await Model.create(next);
  return { ok: true, execution: mapRowToExecution(created) };
}

async function getExecution({ tenantId, executionId }) {
  const tenantKey = safeString(tenantId);
  const executionKey = safeString(executionId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!executionKey) return { ok: false, error: 'execution_id_required' };

  const Model = resolveOperationalPlaybookRunModel();
  const row = await Model.findOne({
    where: {
      tenant_key: tenantKey,
      id: executionKey,
    },
  });
  if (!row) return { ok: false, error: 'execution_not_found' };
  return { ok: true, execution: mapRowToExecution(row) };
}

module.exports = {
  upsertExecution,
  getExecution,
};
