'use strict';

/**
 * Módulo de rotas: GOVERNANÇA DE ENGENHARIA (pendências, estado de release e
 * ações governadas de release).
 *
 * Classificação: **DEVELOPMENT**. Pendências de missão, estado do release e
 * selagem são superfície de ENGENHARIA — nunca de cliente.
 *
 * Postura de honestidade (a mesma do resto da capacidade):
 *   - a lista de pendências NUNCA inventa item: fonte ilegível vira
 *     `sourceUnavailable` declarado, não tela preenchida;
 *   - o estado do release informa o motivo do guard local em vez de contorná-lo;
 *   - ação que altera o repositório exige `confirm: true` e passa por allowlist
 *     fechada (`releaseActionService`): não existe comando parametrizado pelo
 *     cliente;
 *   - uma ação por vez (o pipeline de selagem mexe em `dist/`).
 */

const express = require('express');

const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');
const {
  APPROVAL_IDENTITY_UNRESOLVABLE,
  resolveApprovalIdentity,
} = require('./../security-intel/approvalAuthority');
const {
  DEV_GOVERNANCE_RESOURCE,
  DEV_GOVERNANCE_ACTIONS,
  RELEASE_ACTION_RBAC,
} = require('./actions');

const { READ, RELEASE_VERIFY, RELEASE_SEAL, RELEASE_PUBLISH } = DEV_GOVERNANCE_ACTIONS;

/**
 * Ação autorizável de cada rota — fail-closed.
 *
 * Tabela `METHOD path` (não um parâmetro por rota): rota nova que esquecer de
 * declarar a ação é negada com 403 `route_action_undeclared`, em vez de herdar
 * implicitamente a permissão de leitura. `routes.test.js` cobre a não-vacuidade.
 */
const ROUTE_ACTIONS = Object.freeze({
  'GET /api/dev-governance/pendencies': READ,
  'GET /api/dev-governance/release': READ,
  'GET /api/dev-governance/release/actions': READ,
  'GET /api/dev-governance/release/actions/:jobId': READ,
  'POST /api/dev-governance/release/verify': RELEASE_VERIFY,
  'POST /api/dev-governance/release/seal': RELEASE_SEAL,
  'POST /api/dev-governance/release/publish-tag': RELEASE_PUBLISH,
});

/** Rota → ação do catálogo executável. Fonte única (o handler não adivinha). */
const ROUTE_RELEASE_ACTION = Object.freeze({
  'POST /api/dev-governance/release/verify': 'verify',
  'POST /api/dev-governance/release/seal': 'seal',
  'POST /api/dev-governance/release/publish-tag': 'publish-tag',
});

function declaredPathOf(req) {
  const raw = (req && req.route && req.route.path) || (req && req.path) || '';
  const path = String(raw).split('?')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function routeKey(req) {
  return `${String((req && req.method) || '').toUpperCase()} ${declaredPathOf(req)}`;
}

function actionForRequest(req) {
  return ROUTE_ACTIONS[routeKey(req)] || null;
}

function releaseActionForRequest(req) {
  return ROUTE_RELEASE_ACTION[routeKey(req)] || null;
}

function parseOnlyPending(req) {
  const raw = (req.query && (req.query.onlyPending ?? req.query.only_pending)) ?? null;
  if (raw === null || raw === undefined || raw === '') return false;
  const text = String(raw).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function createDevGovernanceRoutes({ buildDeps } = {}) {
  const router = express.Router();

  function depsFor(req, res) {
    return typeof buildDeps === 'function' ? buildDeps(req, res) : {};
  }

  /**
   * Guard fail-closed, na mesma ordem do resto da superfície de engenharia:
   *   1. autenticação (401);
   *   2. classificação DEVELOPMENT (403);
   *   3. ação declarada da rota (403 `route_action_undeclared`);
   *   4. identidade do ator derivada server-side (403 se inutilizável);
   *   5. autorização POR AÇÃO via RBAC (403 `forbidden`);
   *   6. tenant resolvido server-side (400) — nunca assumido como 'system'.
   */
  function guard(req, res) {
    const deps = depsFor(req, res);
    const auth = deps.requireAuth(req);
    if (!auth || !auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: (auth && auth.error) || 'não autenticado' });
      return null;
    }
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
        route: req.path,
      });
      return null;
    }
    const action = actionForRequest(req);
    if (!action) {
      deps.sendJson(res, 403, { error: 'route_action_undeclared', route: declaredPathOf(req) });
      return null;
    }
    const identity = resolveApprovalIdentity(auth.agent || req.agent || {});
    if (!identity) {
      deps.sendJson(res, 403, {
        error: APPROVAL_IDENTITY_UNRESOLVABLE,
        message: 'Ator autenticado sem identidade utilizável para autorizar a operação',
      });
      return null;
    }
    const permission = typeof deps.requirePermission === 'function'
      ? deps.requirePermission(req, DEV_GOVERNANCE_RESOURCE, action)
      : { allowed: false, error: 'requirePermission indisponível' };
    if (!permission || permission.allowed !== true) {
      deps.sendJson(res, 403, {
        error: 'forbidden',
        resource: DEV_GOVERNANCE_RESOURCE,
        action,
        message: (permission && permission.error) || null,
      });
      return null;
    }
    let tenantKey;
    try {
      tenantKey = tenantFromRequest(req, auth);
    } catch (error) {
      deps.sendJson(res, 400, {
        error: error.code === 'TENANT_INVALID' ? 'tenant_invalid' : 'tenant_required',
        message: 'Tenant autenticado é obrigatório para a governança de engenharia',
      });
      return null;
    }
    return { deps, req, tenantKey, action, actor: identity.label, classification: check.classification };
  }

  function handleError(deps, res, error) {
    const code = error && error.code ? error.code : null;
    if (code === 'persistence_required') {
      return deps.sendJson(res, 503, { error: 'persistence_required', detail: error.message });
    }
    // Recusas de ação são decisões de política: o código e o motivo precisam
    // chegar ao cliente para a operação ser corrigível (não é falha de servidor).
    if (code && String(code).startsWith('release_action')) {
      return deps.sendJson(res, error.statusCode || 409, {
        error: code,
        detail: String(error.message || '').slice(code.length + 1) || null,
      });
    }
    if (code) {
      return deps.sendJson(res, error.statusCode || 400, {
        error: code,
        detail: String(error.message || '').slice(code.length + 1) || null,
      });
    }
    const deps2 = deps || {};
    if (typeof deps2.sendJson === 'function') {
      deps2.sendJson(res, 500, { error: 'internal_error', message: String((error && error.message) || error) });
    }
    return undefined;
  }

  // ── GET /pendencies ──────────────────────────────────────────────────────
  router.get('/api/dev-governance/pendencies', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    try {
      const { getPendencies } = require('../../services/devGovernance/pendenciesService');
      const payload = await getPendencies({
        tenantKey: ctx.tenantKey,
        onlyPending: parseOnlyPending(req),
      });
      ctx.deps.sendJson(res, 200, payload);
    } catch (error) {
      handleError(ctx.deps, res, error);
    }
  });

  // ── GET /release ─────────────────────────────────────────────────────────
  router.get('/api/dev-governance/release', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    try {
      const { getReleaseState } = require('../../services/devGovernance/releaseStateService');
      const state = await getReleaseState();
      ctx.deps.sendJson(res, 200, state);
    } catch (error) {
      handleError(ctx.deps, res, error);
    }
  });

  // ── GET /release/actions (histórico) ─────────────────────────────────────
  router.get('/api/dev-governance/release/actions', (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    try {
      const { listReleaseActions } = require('../../services/devGovernance/releaseActionService');
      ctx.deps.sendJson(res, 200, { items: listReleaseActions() });
    } catch (error) {
      handleError(ctx.deps, res, error);
    }
  });

  // ── GET /release/actions/:jobId ──────────────────────────────────────────
  router.get('/api/dev-governance/release/actions/:jobId', (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    try {
      const { getReleaseAction } = require('../../services/devGovernance/releaseActionService');
      ctx.deps.sendJson(res, 200, getReleaseAction({ jobId: req.params.jobId }));
    } catch (error) {
      handleError(ctx.deps, res, error);
    }
  });

  /**
   * POSTs de ação. O corpo aceita SOMENTE `{ confirm }`: a ação vem da ROTA, não
   * do corpo — assim a ação executada é sempre a que passou pelo RBAC.
   */
  function actionHandler(actionId) {
    return async (req, res) => {
      const ctx = guard(req, res);
      if (!ctx) return;
      try {
        let body = {};
        if (typeof ctx.deps.parseJsonBody === 'function' && ctx.deps.hasJsonContentType(req)) {
          body = ctx.deps.parseJsonBody(req) || {};
        } else if (req.body && typeof req.body === 'object') {
          body = req.body;
        }
        const { runReleaseAction } = require('../../services/devGovernance/releaseActionService');
        const job = await runReleaseAction({
          actionId,
          confirm: body.confirm === true,
          actor: ctx.actor,
        });
        ctx.deps.sendJson(res, 202, job);
      } catch (error) {
        handleError(ctx.deps, res, error);
      }
    };
  }

  router.post('/api/dev-governance/release/verify', actionHandler(releaseActionForRequest({ method: 'POST', route: { path: '/api/dev-governance/release/verify' } })));
  router.post('/api/dev-governance/release/seal', actionHandler(releaseActionForRequest({ method: 'POST', route: { path: '/api/dev-governance/release/seal' } })));
  router.post('/api/dev-governance/release/publish-tag', actionHandler(releaseActionForRequest({ method: 'POST', route: { path: '/api/dev-governance/release/publish-tag' } })));

  return router;
}

module.exports = {
  ROUTE_ACTIONS,
  ROUTE_RELEASE_ACTION,
  RELEASE_ACTION_RBAC,
  actionForRequest,
  declaredPathOf,
  parseOnlyPending,
  createDevGovernanceRoutes,
};
