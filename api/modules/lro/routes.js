'use strict';

/**
 * Rotas de Long-Running Operations.
 *
 * Entrega (mandato LRO §6): SSE para eventos com `Last-Event-ID` + replay, REST para consulta e
 * comandos. O navegador é consumidor de estado — nunca executor.
 *
 * Segurança (mandato §8/§10): autorização em CADA subscribe e em CADA replay, contra a
 * `visibility_class` DA OPERAÇÃO (não contra o menu). Tenant vem do ator autenticado, nunca da query.
 * Operação de outro tenant responde 404 — não confirma existência.
 */

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { checkClassification } = require('../../middleware/requireClassification');
const logger = require('../../utils/logger');
const lroService = require('../../services/lro/lroService');
const lroFeedback = require('../../services/lro/lroFeedbackService');

const HEARTBEAT_MS = 15000;
const PAGINA_EVENTOS = 200;
const TERMINAIS = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];

function criarRouterLro() {
  const router = express.Router();

  /** Autentica, resolve tenant e autoriza contra a classe de visibilidade da operação. */
  async function autorizar(req, res) {
    const auth = requireAuth(req);
    if (!auth || auth.valid === false) {
      res.status(401).json({ error: 'unauthorized', message: auth ? auth.error : null });
      return null;
    }
    req.agent = req.agent || auth.agent;
    req.session = req.session || auth.session;

    const { tenantFromRequest } = require('../../../lib/rpaSecurity');
    let tenantId;
    try {
      tenantId = tenantFromRequest(req, auth);
    } catch (_) {
      tenantId = null;
    }
    if (!tenantId) {
      res.status(400).json({ error: 'tenant_required' });
      return null;
    }

    let operacao;
    try {
      operacao = await lroService.getOperation(req.params.id, { tenantId });
    } catch (error) {
      if (error.code === 'OPERATION_NOT_FOUND') {
        // 404 uniforme: não revela se a operação existe em outro tenant.
        res.status(404).json({ error: 'operation_not_found' });
        return null;
      }
      throw error;
    }

    const classe = String(operacao.visibility_class || 'DEVELOPMENT').toUpperCase();
    const veredito = checkClassification(req, classe);
    if (!veredito.allowed) {
      res.status(403).json({
        error: 'classification_forbidden',
        required: veredito.required,
        classification: veredito.classification,
      });
      return null;
    }
    return { tenantId, operacao };
  }

  /**
   * Lista operações do tenant. O ator só vê as classes que PODE ver: DEVELOPMENT vê tudo,
   * SUPPORT vê SUPPORT+PRODUCTION, PRODUCTION vê só PRODUCTION (política de experience-segregation).
   */
  router.get('/api/lro', async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      if (!auth || auth.valid === false) return res.status(401).json({ error: 'unauthorized' });
      req.agent = req.agent || auth.agent;

      const { tenantFromRequest } = require('../../../lib/rpaSecurity');
      const tenantId = tenantFromRequest(req, auth);
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });

      const { getClassificationForAgent } = require('../agent-os/experience-segregation');
      const classificacao = getClassificationForAgent(req.agent);
      const visiveis = {
        DEVELOPMENT: ['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'],
        SUPPORT: ['PRODUCTION', 'SUPPORT'],
        PRODUCTION: ['PRODUCTION'],
      }[classificacao] || ['PRODUCTION'];

      const status = req.query.status ? String(req.query.status).split(',').filter(Boolean) : null;
      const items = await lroService.listOperations({
        tenantId,
        statuses: status,
        visibilityClasses: visiveis,
        limit: req.query.limit || 50,
      });
      return res.json({ items, count: items.length, classification: classificacao });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/api/lro/:id', async (req, res, next) => {
    try {
      const ctx = await autorizar(req, res);
      if (!ctx) return undefined;
      return res.json({ operation: ctx.operacao });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * SSE de eventos.
   *  - `Last-Event-ID: <seq>` (ou `?after=<seq>`) faz REPLAY do que faltou;
   *  - `?snapshot=1` entrega o que existe e encerra (catch-up pontual, sem segurar conexão);
   *  - heartbeat periódico mantém a conexão viva sem inventar evento.
   */
  router.get('/api/lro/:id/events', async (req, res, next) => {
    let ctx;
    try {
      ctx = await autorizar(req, res);
    } catch (error) {
      return next(error);
    }
    if (!ctx) return undefined;

    const { tenantId, operacao } = ctx;
    const pedido = Number(req.headers['last-event-id'] || req.query.after || 0);
    const cursorInicial = Number.isFinite(pedido) && pedido > 0 ? pedido : 0;
    const somenteSnapshot = String(req.query.snapshot || '') === '1';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let cursor = cursorInicial;
    let encerrado = false;

    const enviarEvento = (evento) => {
      res.write(`id: ${evento.seq}\n`);
      res.write(`event: ${evento.type}\n`);
      res.write(`data: ${JSON.stringify({
        seq: evento.seq,
        type: evento.type,
        payload: evento.payload || null,
        actorId: evento.actor_id || null,
        createdAt: evento.created_at || null,
      })}\n\n`);
      cursor = Number(evento.seq);
    };

    const bombear = async () => {
      const eventos = await lroService.listEvents(operacao.id, {
        afterSeq: cursor, limit: PAGINA_EVENTOS, tenantId,
      });
      for (const evento of eventos) enviarEvento(evento);
      return eventos.length;
    };

    const heartbeat = setInterval(() => {
      if (!encerrado) res.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();

    const finalizar = () => {
      if (encerrado) return;
      encerrado = true;
      clearInterval(heartbeat);
      res.end();
    };

    req.on('close', () => { encerrado = true; clearInterval(heartbeat); });

    try {
      await bombear();
      if (somenteSnapshot) return finalizar();

      // Acompanha o log DURÁVEL (PostgreSQL é a autoridade; Redis Streams seria só transporte).
      const acompanhar = setInterval(async () => {
        if (encerrado) return;
        try {
          await bombear();
          const atual = await lroService.getOperation(operacao.id, { tenantId }).catch(() => null);
          if (atual && TERMINAIS.includes(atual.status)) {
            const restantes = await lroService.listEvents(operacao.id, { afterSeq: cursor, limit: 1, tenantId });
            if (restantes.length === 0) finalizar();
          }
        } catch (error) {
          logger.warn('[lro] falha ao bombear eventos', { operationId: operacao.id, code: error.code || null });
        }
      }, 1000);
      if (acompanhar.unref) acompanhar.unref();
      req.on('close', () => clearInterval(acompanhar));
    } catch (error) {
      finalizar();
      return next(error);
    }
    return undefined;
  });

  /** Abre um pedido de decisão humana (WAITING_FEEDBACK só existe com pedido identificado). */
  router.post('/api/lro/:id/feedback', express.json({ limit: '64kb' }), async (req, res, next) => {
    try {
      const ctx = await autorizar(req, res);
      if (!ctx) return undefined;
      const { assigneeActorId, assigneeRole, options, responseSchema, deadlineAt } = req.body || {};

      const aberto = await lroFeedback.requestFeedback(ctx.operacao.id, {
        tenantId: ctx.tenantId,
        requestedBy: req.agent ? req.agent.id : null,
        actorId: req.agent ? req.agent.id : null,
        assigneeActorId: assigneeActorId || null,
        assigneeRole: assigneeRole || null,
        options: options || null,
        responseSchema: responseSchema || null,
        deadlineAt: deadlineAt || null,
      });
      return res.status(201).json({ requestId: aberto.requestId, operation: aberto.operation });
    } catch (error) {
      if (error.code === 'FEEDBACK_OPERACAO_NAO_ESTA_RUNNING') {
        return res.status(409).json({ error: error.code, message: error.message });
      }
      if (error.code === 'OPERATION_NOT_FOUND') return res.status(404).json({ error: 'operation_not_found' });
      return next(error);
    }
  });

  /** Responde um pedido. Silêncio/tempo esgotado nunca aprova; códigos do serviço viram 403/409. */
  router.post('/api/lro/feedback/:requestId/respond', express.json({ limit: '64kb' }), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      if (!auth || auth.valid === false) return res.status(401).json({ error: 'unauthorized' });
      req.agent = req.agent || auth.agent;
      const { tenantFromRequest } = require('../../../lib/rpaSecurity');
      const tenantId = tenantFromRequest(req, auth);
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });

      const { decision, optionId, payload, idempotencyKey } = req.body || {};
      const respondido = await lroFeedback.respond(req.params.requestId, {
        tenantId,
        actorId: req.agent ? req.agent.id : null,
        decision,
        optionId: optionId || null,
        payload: payload || null,
        idempotencyKey,
        actorRoles: req.agent && req.agent.role ? [String(req.agent.role)] : [],
      });
      return res.json(respondido);
    } catch (error) {
      if (error.code === 'FEEDBACK_NAO_AUTORIZADO') return res.status(403).json({ error: error.code });
      if (error.code === 'FEEDBACK_NAO_ENCONTRADO') return res.status(404).json({ error: error.code });
      if (error.code && /^FEEDBACK_/.test(error.code)) return res.status(409).json({ error: error.code, message: error.message });
      return next(error);
    }
  });

  /** Comandos com escopo: só transições legais; versão otimista e fencing opcionais. */
  router.post('/api/lro/:id/transition', express.json({ limit: '64kb' }), async (req, res, next) => {
    try {
      const ctx = await autorizar(req, res);
      if (!ctx) return undefined;

      const { to, outcome, expectedVersion, fencingToken, reason, feedbackRequestId } = req.body || {};
      if (!to) return res.status(400).json({ error: 'to_required' });

      const atualizada = await lroService.transition(ctx.operacao.id, {
        to,
        actorId: req.agent ? req.agent.id : null,
        expectedVersion: expectedVersion === undefined ? null : expectedVersion,
        fencingToken: fencingToken === undefined ? null : fencingToken,
        context: {
          outcome,
          reason,
          feedbackRequestId,
          visibilityClass: ctx.operacao.visibility_class,
        },
      });
      return res.json({ operation: atualizada });
    } catch (error) {
      if (error.code && /^(VERSION_CONFLICT|FENCE_STALE|TERMINAL_IMUTAVEL|TRANSICAO_INVALIDA|DESFECHO_|FEEDBACK_|ESTADO_)/.test(error.code)) {
        return res.status(409).json({ error: error.code, message: error.message });
      }
      if (error.code === 'OPERATION_NOT_FOUND') return res.status(404).json({ error: 'operation_not_found' });
      return next(error);
    }
  });

  return router;
}

module.exports = { criarRouterLro };
