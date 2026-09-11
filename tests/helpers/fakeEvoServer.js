'use strict';

/**
 * Fake EVO server — EXCLUSIVO PARA TESTE.
 *
 * Servidor HTTP local determinístico que implementa o mesmo contrato declarado
 * em `config/integrations/evo-contract.json`. Existe porque nenhuma credencial
 * real do EVO foi fornecida; ele permite provar contrato, paginação, retry,
 * idempotência e schema drift sem depender de ambiente externo.
 *
 * NUNCA é usado pelo runtime de produção: vive em `tests/helpers/` e não é
 * referenciado por nenhum arquivo de `api/`. Não existe (nem deve existir)
 * branch do tipo `if (!credentials) useFakeEvo()` no runtime.
 */

const http = require('http');
const crypto = require('crypto');

const RESOURCE_PATHS = Object.freeze({
  '/members': 'members',
  '/prospects': 'prospects',
  '/membership-plans': 'plans',
  '/memberships': 'memberships',
  '/entries': 'entries',
  '/sales': 'sales',
  '/receivables': 'receivables',
});

function basicAuthHeader(token, secretKey) {
  return `Basic ${Buffer.from(`${token}:${secretKey}`, 'utf8').toString('base64')}`;
}

/**
 * @param {object} options
 * @param {string} [options.token]
 * @param {string} [options.secretKey]
 * @param {object} [options.datasets] map resource → array de registros brutos
 * @param {number} [options.pageSize] tamanho de página aplicado pelo servidor
 * @param {Array} [options.failures] `[{ path, times, status, body }]` para injetar 429/500/timeout
 * @param {object} [options.schemaDrift] `{ resource: { dropFields: [...], times } }`
 */
function createFakeEvoServer(options = {}) {
  const token = options.token || 'fake-token';
  const secretKey = options.secretKey || 'fake-secret-key';
  const datasets = options.datasets || {
    members: [], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [],
  };
  const defaultPageSize = Number(options.pageSize) || 100;
  const failures = (options.failures || []).map((f) => ({ ...f, remaining: f.times }));
  const drift = options.schemaDrift ? JSON.parse(JSON.stringify(options.schemaDrift)) : {};
  const requests = [];
  let authFailures = 0;

  function nextFailure(pathname) {
    const found = failures.find((f) => f.remaining > 0 && (!f.path || f.path === pathname));
    if (!found) return null;
    found.remaining -= 1;
    return found;
  }

  function authorize(req) {
    const header = req.headers.authorization || '';
    const expected = basicAuthHeader(token, secretKey);
    if (header !== expected) {
      authFailures += 1;
      return false;
    }
    return true;
  }

  function applyDrift(resource, items) {
    const cfg = drift[resource];
    if (!cfg || (cfg.remaining !== undefined && cfg.remaining <= 0)) return items;
    if (cfg.remaining !== undefined) cfg.remaining -= 1;
    if (!cfg.dropFields || cfg.dropFields.length === 0) return items;
    return items.map((item) => {
      const clone = { ...item };
      for (const field of cfg.dropFields) delete clone[field];
      return clone;
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const basePath = options.basePath === undefined ? '/api/v1' : String(options.basePath);
    let pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length) || '/';
    requests.push({ method: req.method, path: pathname, query: Object.fromEntries(url.searchParams) });

    const failure = nextFailure(pathname);
    if (failure) {
      if (failure.status === 'timeout') return; // não responde: exercita o timeout do cliente
      res.writeHead(failure.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(failure.body || { error: `injected_${failure.status}` }));
      return;
    }

    if (!authorize(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    const baseResource = RESOURCE_PATHS[pathname];
    if (!baseResource) {
      // detail path: /members/:id
      const detailMatch = /^\/(members|prospects|membership-plans|memberships|entries|sales|receivables)\/(.+)$/.exec(pathname);
      if (detailMatch) {
        const resource = RESOURCE_PATHS[`/${detailMatch[1]}`];
        const id = decodeURIComponent(detailMatch[2]);
        const items = datasets[resource] || [];
        const found = items.find((item) => Object.values(item).some((value) => String(value) === id));
        if (!found) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(applyDrift(resource, [found])[0]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', path: pathname }));
      return;
    }

    const page = Number(url.searchParams.get('page') || 1);
    const size = Number(url.searchParams.get('size') || defaultPageSize);
    const since = url.searchParams.get('updatedSince');
    let items = datasets[baseResource] || [];

    if (since) {
      const sinceMs = new Date(since).getTime();
      items = items.filter((item) => {
        const stamp = item.updatedAt || item.date || item.registerDate || item.createdAt;
        return stamp ? new Date(stamp).getTime() >= sinceMs : true;
      });
    }

    items = applyDrift(baseResource, items);
    const start = (page - 1) * size;
    const pageItems = items.slice(start, start + size);

    res.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': `fake-${requests.length}` });
    res.end(JSON.stringify(pageItems));
  });

  return {
    get baseUrl() {
      const address = server.address();
      return `http://127.0.0.1:${address.port}/api/v1`;
    },
    get requests() {
      return requests;
    },
    get authFailures() {
      return authFailures;
    },
    datasets,
    credentials: { token, secretKey },
    authHeader: basicAuthHeader(token, secretKey),
    /** Injeta falhas em runtime (usado por testes de resiliência). */
    addFailure(failure) {
      failures.push({ ...failure, remaining: failure.times });
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/api/v1`));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    signWebhook(rawBody) {
      return crypto.createHmac('sha256', secretKey).update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)).digest('hex');
    },
  };
}

module.exports = { createFakeEvoServer, RESOURCE_PATHS, basicAuthHeader };
