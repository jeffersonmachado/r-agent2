'use strict';

/**
 * api/modules/engineering-router/routes.js
 *
 * Rotas REST do Engineering Model Router V1 — DEVELOPMENT-only. Segue o mesmo padrão de
 * `api/modules/qa-mesh/routes.js`: `express.Router()` declarativo, `requireAuth` +
 * `checkClassification('DEVELOPMENT')` em toda rota (nunca confia no frontend).
 */

const express = require('express');
const crypto = require('crypto');
const { checkClassification } = require('../../middleware/requireClassification');
const { TASK_TYPES, RISK_LEVELS, TASK_SCOPES } = require('../../../engine/engineeringRouter/constants');

function createEngineeringRouterRoutes({ buildDeps }) {
  const router = express.Router();

  function enforceDevelopment(deps, req, res) {
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, { error: 'classification_required', required: check.required, classification: check.classification });
      return false;
    }
    return true;
  }

  function guard(req, res, deps) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    if (!enforceDevelopment(deps, req, res)) return null;
    return auth;
  }

  router.get('/engineering/overview', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      deps.sendJson(res, 200, await deps.engineeringTaskService.computeOverview());
    } catch (err) {
      deps.logger.error('[engineering-router] overview', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const { status, risk, taskType, limit, offset } = req.query;
      const tasks = await deps.engineeringTaskService.listTasks({ status, risk, taskType, limit, offset });
      deps.sendJson(res, 200, { tasks, count: tasks.length });
    } catch (err) {
      deps.logger.error('[engineering-router] list tasks', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.post('/engineering/tasks', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      if (!body?.title && !body?.objective) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: 'title ou objective é obrigatório' });
        return;
      }
      if (body.taskType && !TASK_TYPES.includes(body.taskType)) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: `taskType inválido. Use um de: ${TASK_TYPES.join(', ')}` });
        return;
      }
      if (body.risk && !RISK_LEVELS.includes(body.risk)) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: `risk inválido. Use um de: ${RISK_LEVELS.join(', ')}` });
        return;
      }
      if (body.scope && !TASK_SCOPES.includes(body.scope)) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: `scope inválido. Use um de: ${TASK_SCOPES.join(', ')}` });
        return;
      }
      const task = await deps.engineeringTaskService.createTask(body, {
        createdBy: req.agent?.id || req.agent?.email || null,
        idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
      });
      deps.sendJson(res, 201, task);
    } catch (err) {
      // Erro de CONTRATO é do cliente (400), não falha interna: sem isto o operador
      // via 500 em algo que ele mesmo pode corrigir (declarar allowedPaths).
      if (err && err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        deps.sendJson(res, err.statusCode, { error: err.code || 'bad_request', message: err.message });
        return;
      }
      deps.logger.error('[engineering-router] create task', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const task = await deps.engineeringTaskService.getTask(req.params.id);
      if (!task) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, task);
    } catch (err) {
      deps.logger.error('[engineering-router] get task', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.post('/engineering/tasks/:id/run', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const task = await deps.engineeringTaskService.getTask(req.params.id);
      if (!task) { deps.sendJson(res, 404, { error: 'not_found' }); return; }

      // Fire-and-forget: uma execução real pode envolver múltiplas chamadas de LLM e testes,
      // levando muito além do timeout aceitável de uma requisição HTTP síncrona. O cliente
      // acompanha progresso ao vivo via WebSocket (evento `engineering.task.stage`, emitido por
      // tenant em engineeringRouterEvents.js) e, como fallback, via GET /engineering/tasks/:id.
      //
      // ERV1-CLOSE-006: o tenant do agente autenticado SÓ pode virar `eventAudienceTenantId`
      // (para o WebSocket alcançar quem abriu a tela) — NUNCA `credentialScope`. Passar o
      // tenant da requisição como escopo de credencial faria o Router resolver e gastar a
      // credencial/budget de IA daquele tenant (inclusive um cliente real) para enviar
      // código-fonte da plataforma — `credentialScope` fica de fora daqui de propósito, sempre
      // com o default fixo `ENGINEERING_CREDENTIAL_SCOPE` do próprio serviço.
      // ERV1-CLOSE-009: `beginRun` adquire o lock de forma SÍNCRONA (awaited) antes de
      // responder — uma segunda chamada concorrente genuína lança TASK_ALREADY_RUNNING AQUI,
      // capturado pelo catch abaixo como 409 real. Achado real: a versão anterior chamava
      // `runTask` (que só faz o lock DEPOIS de já ter sido disparado em fire-and-forget) sem
      // `await`, então o `catch` nunca via o erro de lock — toda chamada concorrente recebia
      // 202 "ACCEPTED" mesmo quando a execução nunca chegava a rodar de verdade.
      const eventAudienceTenantId = req.tenantId || req.agent?.tenantId || undefined;
      // IDENTIDADE ÚNICA POR REQUISIÇÃO (defeito medido em 2026-10-20).
      //
      // `http-<agent>-Date.now()` colide quando dois pedidos chegam no MESMO milissegundo. Como a
      // cláusula de reentrada do lease aceita `lease_worker_instance_id = :workerInstanceId`, o
      // segundo pedido se apresentava como o MESMO worker e re-adquiria o lease (fence+1) em vez
      // de receber 409 — medido em suite de concorrência sob carga: `[202, 202]`, duas execuções
      // aceitas para a mesma task. UUID por requisição remove a colisão sem enfraquecer a
      // idempotência real (task terminal continua devolvendo 200 idempotente).
      const beginResult = await deps.engineeringRouterService.beginRun(req.params.id, {
        runnerId: `http-${req.agent?.id || 'unknown'}-${crypto.randomUUID()}`,
        ...(eventAudienceTenantId ? { eventAudienceTenantId } : {}),
      });

      if (!beginResult.accepted) {
        deps.sendJson(res, 200, { taskId: beginResult.taskId, status: beginResult.status, idempotent: true });
        return;
      }
      deps.sendJson(res, 202, { taskId: beginResult.taskId, status: 'ACCEPTED' });
    } catch (err) {
      if (err.code === 'TASK_ALREADY_RUNNING') {
        deps.sendJson(res, 409, { error: 'task_already_running', message: err.message });
        return;
      }
      deps.logger.error('[engineering-router] run task', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.post('/engineering/tasks/:id/cancel', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const task = await deps.engineeringTaskService.transitionTask(req.params.id, 'CANCELLED');
      deps.sendJson(res, 200, task);
    } catch (err) {
      if (err.code === 'not_found') { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      if (err.code === 'INVALID_STATE_TRANSITION') {
        deps.sendJson(res, 409, { error: 'invalid_state_transition', from: err.from, to: err.to });
        return;
      }
      deps.logger.error('[engineering-router] cancel task', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks/:id/attempts', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const attempts = await deps.engineeringTaskService.listAttempts(req.params.id);
      deps.sendJson(res, 200, { attempts, count: attempts.length });
    } catch (err) {
      deps.logger.error('[engineering-router] list attempts', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks/:id/tests', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const attempts = await deps.engineeringTaskService.listAttempts(req.params.id);
      const testsByAttempt = {};
      for (const attempt of attempts) {
        testsByAttempt[attempt.id] = await deps.engineeringTaskService.listTestRuns(attempt.id);
      }
      deps.sendJson(res, 200, { testsByAttempt });
    } catch (err) {
      deps.logger.error('[engineering-router] list tests', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks/:id/reviews', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const attempts = await deps.engineeringTaskService.listAttempts(req.params.id);
      const reviewsByAttempt = {};
      for (const attempt of attempts) {
        reviewsByAttempt[attempt.id] = await deps.engineeringTaskService.listReviews(attempt.id);
      }
      deps.sendJson(res, 200, { reviewsByAttempt });
    } catch (err) {
      deps.logger.error('[engineering-router] list reviews', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/tasks/:id/telemetry', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const telemetry = await deps.engineeringTaskService.listTelemetry(req.params.id);
      deps.sendJson(res, 200, { telemetry, count: telemetry.length });
    } catch (err) {
      deps.logger.error('[engineering-router] list telemetry', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/models', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const models = await deps.engineeringModelStatsService.listModelsWithStats({});
      deps.sendJson(res, 200, { models, count: models.length });
    } catch (err) {
      deps.logger.error('[engineering-router] list models', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/router/decision/:taskId', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const task = await deps.engineeringTaskService.getTask(req.params.taskId);
      if (!task) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, { taskId: task.id, classifierResult: task.classifier_result, routingDecision: task.routing_decision });
    } catch (err) {
      deps.logger.error('[engineering-router] router decision', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/engineering/release-closure', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      deps.sendJson(res, 200, await deps.releaseClosureService.getReleaseClosure());
    } catch (err) {
      deps.logger.error('[engineering-router] release closure', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createEngineeringRouterRoutes,
};
