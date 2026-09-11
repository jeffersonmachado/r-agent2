'use strict';

/**
 * Fake EVO server — EXCLUSIVO PARA TESTE.
 *
 * Servidor HTTP local determinístico que implementa o MESMO dialeto declarado em
 * `config/integrations/evo-contract.json`: Basic `academyDns`+`secretKey`,
 * paginação `take`/`skip` por recurso com `maxTake` resource-specific, filtros
 * incrementais por data por recurso e webhook com cabeçalho customizado.
 *
 * Ele existe porque nenhuma credencial real do EVO foi fornecida: permite provar
 * contrato, paginação, retry, idempotência e schema drift sem depender de
 * ambiente externo.
 *
 * HONESTIDADE OBRIGATÓRIA (o que este arquivo NÃO é):
 *  - NÃO é prova de integração live — o contrato real permanece UNVERIFIED até
 *    certificação com credencial verdadeira;
 *  - NÃO pode conter endpoint inventado. O dialeto implementado aqui é o MESMO
 *    lido do contrato versionado; se o contrato mudar, este servidor muda junto
 *    ou o teste de contrato falha.
 *
 * NUNCA é usado pelo runtime de produção: vive em `tests/helpers/` e não é
 * referenciado por nenhum arquivo de `api/`. Não existe (nem deve existir)
 * branch do tipo `if (!credentials) useFakeEvo()` no runtime.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTRACT_PATH = path.join(__dirname, '..', '..', 'config', 'integrations', 'evo-contract.json');
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

/** Path declarado no contrato → recurso provider-neutral (fonte única). */
const RESOURCE_BY_PATH = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACT.resources).map(([resource, config]) => [config.path, resource]),
));

/** Dialeto de paginação do recurso, LIDO do contrato (nunca constante local). */
function paginationFor(resource) {
  const declared = (CONTRACT.resources[resource] || {}).pagination || {};
  const model = (CONTRACT._paginationModels || {})[declared.model] || CONTRACT.pagination;
  return {
    model: declared.model || CONTRACT.pagination.type,
    takeParam: model.takeParam || 'take',
    skipParam: model.skipParam || 'skip',
    startsAt: Number.isFinite(Number(model.startsAt)) ? Number(model.startsAt) : 0,
    maxTake: Number(declared.maxTake) || Number(model.maxTake) || 100,
    defaultTake: Number(declared.defaultTake) || 50,
    itemsFields: [model.itemsField, ...(model.itemsFieldAlternatives || [])].filter(Boolean),
  };
}

/** Estratégia incremental real do recurso, conforme o contrato. */
function incrementalFor(resource) {
  const declared = (CONTRACT.resources[resource] || {}).incremental || {};
  const definition = (CONTRACT._incrementalStrategies || {})[declared.strategy];
  return {
    strategy: declared.strategy || null,
    params: (definition && definition.params) || [],
    watermark: definition ? definition.watermark : null,
  };
}

function basicAuthHeader(academyDns, secretKey) {
  return `Basic ${Buffer.from(`${academyDns}:${secretKey}`, 'utf8').toString('base64')}`;
}

/** Campos de data observados por recurso (para avaliar o filtro incremental). */
const WATERMARK_CANDIDATES = Object.freeze({
  registerDate: ['registerDate', 'createdAt', 'dateRegister'],
  updateDate: ['updateDate', 'updatedAt', 'dateUpdate'],
  receivingDate: ['receivingDate', 'payDate', 'paidAt', 'dateReceiving'],
  cancellationDate: ['cancellationDate', 'cancelDate'],
});

function watermarkValue(record, watermark) {
  for (const field of WATERMARK_CANDIDATES[watermark] || []) {
    if (record && record[field] !== undefined && record[field] !== null) return record[field];
  }
  return null;
}

/** @deprecated alias mantido para leitura — `RESOURCE_BY_PATH` é a fonte. */
const RESOURCE_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(RESOURCE_BY_PATH).map(([p, resource]) => [p, resource]),
));

/**
 * @param {object} options
 * @param {string} [options.academyDns] usuário do Basic (DNS da academia)
 * @param {string} [options.secretKey] senha do Basic (Secret Key)
 * @param {object} [options.datasets] map resource → array de registros brutos
 * @param {number} [options.pageSize] take aplicado quando o cliente não pede
 * @param {Array} [options.failures] `[{ path, times, status, body }]` para injetar 429/500/timeout
 * @param {object} [options.schemaDrift] `{ resource: { dropFields: [...], times } }`
 * @param {string} [options.webhookHeader] cabeçalho customizado do webhook
 * @param {string} [options.webhookSecret] segredo compartilhado do webhook
 */
function createFakeEvoServer(options = {}) {
  const academyDns = options.academyDns || options.token || 'fake-academy';
  const secretKey = options.secretKey || 'fake-secret-key';
  const datasets = options.datasets || {
    members: [], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [],
  };
  const defaultPageSize = Number(options.pageSize) || 100;
  const failures = (options.failures || []).map((f) => ({ ...f, remaining: f.times }));
  const drift = options.schemaDrift ? JSON.parse(JSON.stringify(options.schemaDrift)) : {};
  const webhookHeader = String(options.webhookHeader || (CONTRACT.webhook && CONTRACT.webhook.signatureHeader) || 'x-evo-signature').toLowerCase();
  const webhookSecret = options.webhookSecret || null;
  const requests = [];
  const webhooks = [];
  let authFailures = 0;

  function nextFailure(pathname) {
    const found = failures.find((f) => f.remaining > 0 && (!f.path || f.path === pathname));
    if (!found) return null;
    found.remaining -= 1;
    return found;
  }

  function authorize(req) {
    const header = req.headers.authorization || '';
    const expected = basicAuthHeader(academyDns, secretKey);
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

  /** Aplica o filtro incremental EXATO declarado para o recurso. */
  function applyIncremental(resource, items, searchParams) {
    const incremental = incrementalFor(resource);
    if (!incremental.strategy || incremental.strategy === 'FULL_SCAN' || incremental.params.length === 0) return items;
    const raw = searchParams.get(incremental.params[0]);
    if (!raw) return items;
    const since = Date.parse(raw);
    if (!Number.isFinite(since)) return items;
    return items.filter((item) => {
      const value = watermarkValue(item, incremental.watermark);
      if (value === null) return true;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed >= since : true;
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const basePath = options.basePath === undefined ? '/api/v1' : String(options.basePath);
    let pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length) || '/';
    requests.push({ method: req.method, path: pathname, query: Object.fromEntries(url.searchParams) });

    // Webhook de provedor (callback): NÃO autentica por Basic — autentica pelo
    // cabeçalho customizado que o RAP configurou na criação.
    if (pathname.startsWith('/webhooks/integrations/evo/')) {
      const provided = webhookSecret ? (req.headers[webhookHeader] || null) : null;
      const accepted = webhookSecret ? provided === webhookSecret : true;
      webhooks.push({ headers: req.headers, path: pathname, accepted });
      res.writeHead(accepted ? 202 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted }));
      return;
    }

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

    const baseResource = RESOURCE_BY_PATH[pathname];
    if (!baseResource) {
      // detail path: /members/:id
      const detailMatch = /^\/(members|prospects|membership-plans|memberships|entries|sales|receivables)\/(.+)$/.exec(pathname);
      if (detailMatch) {
        const resource = RESOURCE_BY_PATH[`/${detailMatch[1]}`];
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

    const pagination = paginationFor(baseResource);
    // take/skip — o MESMO dialeto do contrato. Parâmetros `page`/`size` são
    // IGNORADOS de propósito: um cliente que use o dialeto errado fica preso na
    // primeira página e o teste de paginação falha em vez de passar por acaso.
    const requestedTake = Number(url.searchParams.get(pagination.takeParam) || defaultPageSize);
    const take = Math.max(1, Math.min(requestedTake, pagination.maxTake));
    const skipRaw = url.searchParams.get(pagination.skipParam);
    const skip = skipRaw === null ? pagination.startsAt : Math.max(0, Number(skipRaw) || 0);

    let items = datasets[baseResource] || [];
    items = applyIncremental(baseResource, items, url.searchParams);
    items = applyDrift(baseResource, items);
    const pageItems = items.slice(skip, skip + take);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-request-id': `fake-${requests.length}`,
      'x-evo-take-applied': String(take),
      'x-evo-max-take': String(pagination.maxTake),
    });
    res.end(JSON.stringify({
      [pagination.itemsFields[0] || 'data']: pageItems,
      count: items.length,
      take,
      skip,
      model: pagination.model,
    }));
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
    get webhooks() {
      return webhooks;
    },
    datasets,
    credentials: { academyDns, secretKey, token: academyDns },
    authHeader: basicAuthHeader(academyDns, secretKey),
    webhookHeaderName: webhookHeader,
    webhookHeaderValue: webhookSecret,
    paginationFor,
    incrementalFor,
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
    /** Valor do cabeçalho customizado que o RAP enviaria ao criar o webhook. */
    signWebhook(rawBody) {
      if (webhookSecret) return webhookSecret;
      return crypto.createHmac('sha256', secretKey).update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)).digest('hex');
    },
  };
}

/**
 * Config de conexão em MODO LABORATÓRIO para os testes de contrato.
 *
 * Loopback exige opt-in explícito (`allowUnverifiedEndpoints`) tanto pelo guard
 * de contrato não certificado quanto pela política de SSRF. Declarar o modo aqui
 * mantém os testes honestos: eles estão exercitando um fake local, e isso fica
 * registrado na configuração da conexão — nunca ligado por padrão.
 */
function labConfig(baseUrl, extra = {}) {
  return { baseUrl, allowUnverifiedEndpoints: true, ...extra };
}

module.exports = {
  createFakeEvoServer,
  labConfig,
  RESOURCE_BY_PATH,
  RESOURCE_PATHS,
  basicAuthHeader,
  paginationFor,
  incrementalFor,
  CONTRACT,
};
