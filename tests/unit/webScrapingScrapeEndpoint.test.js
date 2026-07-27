/**
 * Regressão: POST /web-scraping/scrape não pode derrubar o processo quando o
 * scrape falha. Bug observado em produção (nodemon morreu 2x): o catch
 * referenciava `body?.url`, mas `body` era declarado dentro do try —
 * ReferenceError não capturada → unhandled rejection → processo Node morto.
 * Contrato esperado: erro de scrape vira resposta 500 SCRAPE_FAILED (ou 400
 * para URL inválida), nunca crash.
 */

'use strict';

const express = require('express');
const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createWebScrapingRoutes } = require('../../api/modules/web-scraping/routes');

function buildDepsStub({ scrapeUrlImpl }) {
  return () => ({
    requireAuth: () => ({ valid: true }),
    requirePermission: () => ({ allowed: true }),
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
    scrapeUrl: scrapeUrlImpl,
    logAction: jest.fn(),
    sendJson: (res, status, payload) => {
      res.status(status).json(payload);
    },
    badRequest: (res, message) => {
      res.status(400).json({ error: 'bad_request', message });
    },
    sendApiError: (res, apiError) => {
      res.status(apiError.httpStatus || 500).json(apiError);
    },
    buildApiError: ({ code, message, httpStatus, retryable, details }) => ({
      error: code, message, httpStatus, retryable, details,
    }),
    setCorsHeaders: jest.fn(),
    logger: require('../../api/utils/logger'),
  });
}

function startApp(deps) {
  const app = express();
  app.use(express.json());
  app.use(createWebScrapingRoutes({ buildDeps: deps }));
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function postJson(port, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/web-scraping/scrape',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.once('error', reject);
    // Se o handler morrer (ReferenceError não capturada), a requisição fica sem
    // resposta — falha rápida e explícita em vez de timeout opaco do Jest.
    req.setTimeout(3000, () => {
      req.destroy(new Error('sem resposta do handler (provável crash no catch da rota)'));
    });
    req.end(JSON.stringify(payload));
  });
}

describe('POST /web-scraping/scrape — resiliência a falha de scrape', () => {
  let server;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  test('falha de scrape retorna 500 SCRAPE_FAILED sem derrubar o processo', async () => {
    const deps = buildDepsStub({
      scrapeUrlImpl: async () => { throw new Error('fetch failed: ENOTFOUND'); },
    });
    server = await startApp(deps);
    const { port } = server.address();

    const res = await postJson(port, { url: 'http://host-inexistente.local/' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('SCRAPE_FAILED');
    expect(res.body.details.url).toBe('http://host-inexistente.local/');

    // processo segue vivo e responsivo após o erro
    const second = await postJson(port, { url: 'http://outro-host.local/' });
    expect(second.status).toBe(500);
  });

  test('URL inválida retorna 400 SCRAPE_FAILED (não 500) sem crash', async () => {
    const deps = buildDepsStub({
      scrapeUrlImpl: async () => { throw new Error('URL inválida: protocolo não suportado'); },
    });
    server = await startApp(deps);
    const { port } = server.address();

    const res = await postJson(port, { url: 'ftp://exemplo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SCRAPE_FAILED');
    expect(res.body.details.url).toBe('ftp://exemplo');
  });
});
