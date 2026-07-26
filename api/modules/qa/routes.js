'use strict';

const express = require('express');
const { checkClassification } = require('../../middleware/requireClassification');

function createQaRoutes({ buildDeps }) {
  const router = express.Router();

  // Resultados e execução de QA são ferramentas de engenharia: exigem
  // autenticação + classificação DEVELOPMENT (política de segregação).
  function ensureEngineeringAccess(deps, req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return null;
    }
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
      return null;
    }
    return authResult;
  }

  router.get('/qa/latest', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureEngineeringAccess(deps, req, res)) return;

    try {
      const result = deps.getLatestQaResult();
      if (!result) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Nenhum resultado de QA encontrado' });
        return;
      }
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao obter último resultado QA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
  });

  router.get('/qa/history', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureEngineeringAccess(deps, req, res)) return;

    try {
      const url = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const source = url.searchParams.get('source') || undefined;
      const history = deps.getQaHistory({ limit, source });
      deps.sendJson(res, 200, { results: history, count: history.length });
    } catch (error) {
      deps.logger.error('Erro ao obter histórico QA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter histórico QA' });
    }
  });

  router.get('/qa/stats', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureEngineeringAccess(deps, req, res)) return;

    try {
      deps.sendJson(res, 200, deps.getQaStatistics());
    } catch (error) {
      deps.logger.error('Erro ao obter estatísticas QA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estatísticas QA' });
    }
  });

  router.get('/qa/:id', (req, res, next) => {
    const deps = buildDeps(req, res);
    // 'stability' e 'checkpoints' são rotas do módulo qa-mesh (mesmo prefixo /qa,
    // 1 segmento) e 'operational-status' é do operationalStatusRouter; sem o
    // next() o /qa/:id as captura e devolve 404 indevido.
    if (['latest', 'history', 'stats', 'stability', 'checkpoints', 'operational-status'].includes(req.params.id)) {
      next();
      return;
    }

    if (!ensureEngineeringAccess(deps, req, res)) return;

    try {
      const id = req.params.id;
      if (!id) {
        deps.badRequest(res, 'ID do resultado QA é obrigatório');
        return;
      }
      const result = deps.getQaResultById(id);
      if (!result) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Resultado de QA não encontrado' });
        return;
      }
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao obter resultado QA por ID:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
  });

  router.post('/qa/run', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureEngineeringAccess(deps, req, res)) return;

    const permResult = deps.requirePermission(req, 'qa', 'execute');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const result = deps.runQaManual({
        changedFiles: body.changedFiles || undefined,
        source: body.source || 'manual',
      });

      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'execute',
        resource: 'qa',
        details: { status: result.status, scopes: result.scope },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao executar QA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: error.message || 'Erro ao executar QA' });
    }
  });

  return router;
}

module.exports = {
  createQaRoutes,
};
