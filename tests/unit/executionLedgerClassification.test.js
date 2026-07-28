'use strict';

/**
 * Regressão: as rotas do execution-ledger (diagnóstico, classificação
 * SUPPORT) respondiam 200 para papel operacional (admin → PRODUCTION) —
 * achado da API Surface Wave (2026-07-28). Agora exigem
 * checkClassification('SUPPORT') após o requireAuth: admin recebe 403
 * classification_required; auditor (SUPPORT) e super_admin (DEVELOPMENT)
 * passam pela hierarquia DEVELOPMENT > SUPPORT > PRODUCTION.
 */

const express = require('express');
const http = require('http');
const { createExecutionLedgerRoutes } = require('../../api/modules/execution-ledger/routes');

function startServer(agent) {
  const buildDeps = () => ({
    requireAuth: (req) => { req.agent = agent; req.tenantId = agent.tenantId; return { valid: true, agent }; },
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    badRequest: (res, msg) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_request', message: msg }));
    },
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({}),
    logAction: () => {},
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  });

  const app = express();
  app.use(createExecutionLedgerRoutes({ buildDeps }));
  // serviço do ledger não é exercido: falha controlada 503
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('execution-ledger — classificação SUPPORT obrigatória', () => {
  test('papel operacional (admin → PRODUCTION) recebe 403 classification_required', async () => {
    const { server, port } = await startServer({ id: 'a1', role: 'admin', tenantId: 't1' });
    try {
      const res = await get(port, '/api/executions');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('classification_required');
      expect(res.body.required).toBe('SUPPORT');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test('auditor (SUPPORT) atravessa a classificação', async () => {
    const { server, port } = await startServer({ id: 'a2', role: 'auditor', tenantId: 't1' });
    try {
      const res = await get(port, '/api/executions');
      // 503 (serviço indisponível no teste) prova que passou por auth + classificação
      expect([200, 503]).toContain(res.status);
      expect(res.body.error).not.toBe('classification_required');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test('super_admin (DEVELOPMENT) atravessa pela hierarquia', async () => {
    const { server, port } = await startServer({ id: 'a3', role: 'super_admin', isSuperAdmin: true, tenantId: 'system' });
    try {
      const res = await get(port, '/api/executions/ledger');
      expect([200, 503]).toContain(res.status);
      expect(res.body.error).not.toBe('classification_required');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
