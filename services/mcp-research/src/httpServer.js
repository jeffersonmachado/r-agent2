'use strict';

/**
 * HTTP Streamable do MCP Research — Node http puro + StreamableHTTPServerTransport
 * do SDK oficial, modo STATELESS (sessionIdGenerator: undefined): um par
 * Server+Transport por request POST /mcp, sem estado de sessão em memória.
 *
 * Rotas:
 *   GET  /health     → estado do processo (não autenticado, sem dado sensível)
 *   GET  /readiness  → prontidão real (token configurado, snapshot legível)
 *   POST /mcp        → endpoint MCP ( bearer OBRIGATÓRIO )
 *   GET|DELETE /mcp  → 405 (stateless não mantém stream de sessão)
 *
 * Defesas: teto de body, JSON malformado → 400, rota desconhecida → 404,
 * shutdown gracioso por SIGTERM/SIGINT (index.js).
 */

const http = require('http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { isAuthorized, writeUnauthorized } = require('./auth');

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Lê o body com TETO — corpo além do limite é recusado (413), nunca truncado. */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('request_body_too_large'), { code: 'request_body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {object} args
 * @param {object} args.config          loadConfig()
 * @param {Function} args.createServer  () → SDK Server pronto para connect
 * @param {Function} [args.readiness]   () → { ready: boolean, checks: object }
 * @param {object} [args.logger]
 * @returns {{ server: http.Server, start: Function, stop: Function }}
 */
function createHttpServer({ config, createServer, readiness, logger } = {}) {
  if (!config) throw new Error('mcp_research_http_config_required');
  if (typeof createServer !== 'function') throw new Error('mcp_research_http_server_factory_required');
  const log = logger || null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://internal');
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/health') {
        writeJson(res, 200, { status: 'ok', service: 'mcp-research', mode: config.mode });
        return;
      }

      if (req.method === 'GET' && path === '/readiness') {
        let report = { ready: true, checks: { auth: 'configured' } };
        if (typeof readiness === 'function') {
          try {
            report = readiness();
          } catch (error) {
            report = { ready: false, checks: { readiness: error.code || error.message } };
          }
        }
        writeJson(res, report.ready ? 200 : 503, { service: 'mcp-research', mode: config.mode, ...report });
        return;
      }

      if (path !== '/mcp') {
        writeJson(res, 404, { error: 'not_found', code: 'mcp_research_not_found' });
        return;
      }

      if (req.method !== 'POST') {
        // Stateless: não há stream GET de sessão nem DELETE de término.
        writeJson(res, 405, { error: 'method_not_allowed', code: 'mcp_research_method_not_allowed' });
        return;
      }

      // Fronteira autenticada: tudo abaixo exige o bearer serviço-a-serviço.
      if (!isAuthorized(req, config.authToken)) {
        writeUnauthorized(res);
        return;
      }

      const rawBody = await readBody(req, config.maxRequestBodyBytes);
      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf8') || 'null');
      } catch (_) {
        writeJson(res, 400, { error: 'invalid_json', code: 'mcp_research_invalid_json' });
        return;
      }

      // Um Server + Transport por request (stateless): sem sessão, sem estado
      // compartilhado entre chamadas — o container escala horizontalmente.
      const mcpServer = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      log?.error?.('[mcp-research] request falhou', { code: error?.code || 'internal_error' });
      if (!res.headersSent) {
        if (error?.code === 'request_body_too_large') {
          writeJson(res, 413, { error: 'request_body_too_large', code: 'request_body_too_large' });
        } else {
          writeJson(res, 500, { error: 'internal_error', code: 'mcp_research_internal_error' });
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject);
        const address = server.address();
        log?.info?.('[mcp-research] listening', { port: address?.port, mode: config.mode });
        resolve(address);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      server.close(() => resolve());
      // Drena conexões keep-alive que segurariam o close.
      server.closeIdleConnections?.();
    });
  }

  return { server, start, stop };
}

module.exports = { createHttpServer };
