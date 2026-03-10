'use strict';

function getUrl(req) {
  return new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
}

function decodeRouteParam(match, index) {
  return decodeURIComponent(match?.[index] || '');
}

function readOptionalQuery(searchParams, key) {
  const raw = searchParams?.get(key);
  if (raw == null) return null;
  const normalized = String(raw).trim();
  return normalized || null;
}

function readOutcomeFilters(searchParams) {
  return {
    status: readOptionalQuery(searchParams, 'status'),
    sourceType: readOptionalQuery(searchParams, 'sourceType')
      || readOptionalQuery(searchParams, 'source_type'),
    sourceId: readOptionalQuery(searchParams, 'sourceId')
      || readOptionalQuery(searchParams, 'source_id'),
    actionId: readOptionalQuery(searchParams, 'actionId')
      || readOptionalQuery(searchParams, 'action_id'),
    actionType: readOptionalQuery(searchParams, 'actionType')
      || readOptionalQuery(searchParams, 'action_type'),
    contactId: readOptionalQuery(searchParams, 'contactId')
      || readOptionalQuery(searchParams, 'contact_id'),
    signalId: readOptionalQuery(searchParams, 'signalId')
      || readOptionalQuery(searchParams, 'signal_id'),
    recommendationId: readOptionalQuery(searchParams, 'recommendationId')
      || readOptionalQuery(searchParams, 'recommendation_id'),
    playbookExecutionId: readOptionalQuery(searchParams, 'playbookExecutionId')
      || readOptionalQuery(searchParams, 'playbook_execution_id'),
    outcomeType: readOptionalQuery(searchParams, 'outcomeType')
      || readOptionalQuery(searchParams, 'outcome_type'),
    from: readOptionalQuery(searchParams, 'from')
      || readOptionalQuery(searchParams, 'dateFrom')
      || readOptionalQuery(searchParams, 'startDate'),
    to: readOptionalQuery(searchParams, 'to')
      || readOptionalQuery(searchParams, 'dateTo')
      || readOptionalQuery(searchParams, 'endDate'),
  };
}

function readEnvBoolean(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function decisionEngineFlagFallback() {
  return readEnvBoolean('OPERATIONAL_DECISION_ENGINE_ENABLED', false);
}

async function withOccSuperAdmin({ req, res, requireAuth, isSuperAdmin, sendJson, forbiddenMessage, handler }) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  if (!isSuperAdmin(req.agent)) {
    sendJson(res, 403, { error: 'forbidden', message: forbiddenMessage || 'Apenas Super Admin pode acessar o OCC' });
    return true;
  }

  await handler();
  return true;
}

function buildOperationalPipelineService() {
  const { OperationalPipelineService } = require('../../core/operational-pipeline');
  return new OperationalPipelineService();
}

async function composeRouteHandlers(handlers = [], context = {}) {
  for (const handler of handlers) {
    if (typeof handler !== 'function') continue;
    const handled = await handler(context);
    if (handled) return true;
  }
  return false;
}

module.exports = {
  getUrl,
  decodeRouteParam,
  readOptionalQuery,
  readOutcomeFilters,
  decisionEngineFlagFallback,
  withOccSuperAdmin,
  buildOperationalPipelineService,
  composeRouteHandlers,
};
