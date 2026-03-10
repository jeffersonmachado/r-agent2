'use strict';

const {
  getUrl,
  decodeRouteParam,
  readOptionalQuery,
  withOccSuperAdmin,
  buildOperationalPipelineService,
  decisionEngineFlagFallback,
} = require('./occShared');

async function handleOccOverviewRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      isSuperAdmin,
      sendJson,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname === '/api/admin/tenants/health') {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar o OCC',
      handler: async () => {
        try {
          const operationalMetricsService = require('../../services/operationalMetricsService');
          const out = await operationalMetricsService.getTenantsHealthSummary();
          sendJson(res, 200, out);
        } catch (err) {
          logger.error('Erro ao carregar health summary OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/metrics$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar o OCC',
      handler: async () => {
        try {
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/metrics$/);
          const tenantId = decodeRouteParam(match, 1);
          const operationalMetricsService = require('../../services/operationalMetricsService');
          const out = await operationalMetricsService.getLatestTenantSnapshot({ tenantId });
          sendJson(res, 200, out);
        } catch (err) {
          logger.error('Erro ao carregar snapshot OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/crm\/operational-summary$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar resumo CRM do OCC',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/crm\/operational-summary$/);
          const tenantId = decodeRouteParam(match, 1);
          const recentWindowHours = Number(urlObj.searchParams.get('recentWindowHours') || 72);
          const { CRMEventService } = require('../../core/crm');
          const out = await CRMEventService.getTenantOperationalSummary({ tenantId, recentWindowHours });
          if (!out.ok) {
            sendJson(res, 400, out);
            return;
          }
          sendJson(res, 200, out);
        } catch (err) {
          logger.error('Erro ao carregar resumo CRM OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-playbook-executions$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar execuções de playbook do OCC',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-playbook-executions$/);
          const tenantId = decodeRouteParam(match, 1);
          const limit = Number(urlObj.searchParams.get('limit') || 120);
          const status = readOptionalQuery(urlObj.searchParams, 'status');
          const contactId = readOptionalQuery(urlObj.searchParams, 'contactId')
            || readOptionalQuery(urlObj.searchParams, 'contact_id');
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccActivePlaybooks({
            tenantId,
            limit,
            status,
            contactId,
            from,
            to,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar execuções de playbook OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-decisions\/signals$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar decisões operacionais OCC',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-decisions\/signals$/);
          const tenantId = decodeRouteParam(match, 1);
          const tenantFeatureService = require('../../services/tenantFeatureService');
          const enabled = await tenantFeatureService.isEnabled(
            tenantId,
            'operational_decision_engine_enabled',
            decisionEngineFlagFallback(),
          );

          if (!enabled) {
            sendJson(res, 200, {
              ok: true,
              enabled: false,
              reason: 'feature_disabled',
              items: [],
              total: 0,
              source: 'decision_engine',
            });
            return;
          }

          const limit = Number(urlObj.searchParams.get('limit') || 200);
          const activeOnly = urlObj.searchParams.get('activeOnly') !== 'false';
          const contactId = readOptionalQuery(urlObj.searchParams, 'contactId')
            || readOptionalQuery(urlObj.searchParams, 'contact_id');
          const status = readOptionalQuery(urlObj.searchParams, 'status');
          const severity = readOptionalQuery(urlObj.searchParams, 'severity');
          const type = readOptionalQuery(urlObj.searchParams, 'type');
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listSignalDecisions({
            tenantId,
            limit,
            activeOnly,
            contactId,
            status,
            severity,
            type,
            from,
            to,
          });
          sendJson(res, out.ok ? 200 : 400, { ...out, enabled: true, source: 'decision_engine' });
        } catch (err) {
          logger.error('Erro ao listar decisões por sinais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-decisions\/recommendations$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar decisões operacionais OCC',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-decisions\/recommendations$/);
          const tenantId = decodeRouteParam(match, 1);
          const tenantFeatureService = require('../../services/tenantFeatureService');
          const enabled = await tenantFeatureService.isEnabled(
            tenantId,
            'operational_decision_engine_enabled',
            decisionEngineFlagFallback(),
          );

          if (!enabled) {
            sendJson(res, 200, {
              ok: true,
              enabled: false,
              reason: 'feature_disabled',
              items: [],
              total: 0,
              source: 'decision_engine',
            });
            return;
          }

          const limit = Number(urlObj.searchParams.get('limit') || 200);
          const contactId = readOptionalQuery(urlObj.searchParams, 'contactId')
            || readOptionalQuery(urlObj.searchParams, 'contact_id');
          const status = readOptionalQuery(urlObj.searchParams, 'status');
          const priority = readOptionalQuery(urlObj.searchParams, 'priority');
          const type = readOptionalQuery(urlObj.searchParams, 'type');
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listRecommendationDecisions({
            tenantId,
            limit,
            contactId,
            status,
            priority,
            type,
            from,
            to,
          });
          sendJson(res, out.ok ? 200 : 400, { ...out, enabled: true, source: 'decision_engine' });
        } catch (err) {
          logger.error('Erro ao listar decisões por recomendações OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-kpis$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar KPIs operacionais OCC',
      handler: async () => {
        try {
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-kpis$/);
          const tenantId = decodeRouteParam(match, 1);
          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.getOperationalKPIs({ tenantId });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar KPIs operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals\/top-types$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar top signals OCC',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals\/top-types$/);
          const tenantId = decodeRouteParam(match, 1);
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');
          const limit = Number(urlObj.searchParams.get('limit') || 5);
          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.getTopOperationalSignals({ tenantId, from, to, limit });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar top tipos de sinais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  return false;
}

module.exports = {
  handleOccOverviewRoutes,
};
