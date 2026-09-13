'use strict';

/**
 * L9 — TESTE DIRETO DE API: principal PRODUCTION não recebe NENHUM interno.
 *
 * Exercita o boundary HTTP REAL (`handleLearningCoreRoutes`) com a
 * classificação de plataforma REAL (`checkClassification` →
 * `getClassificationForAgent`) e um manual REAL em disco (gerado a partir de um
 * replay de teste). As respostas são varridas por:
 *
 *   1. chaves proibidas em qualquer profundidade do JSON;
 *   2. tokens técnicos crus (replayId, seletor, ação de automação);
 *   3. detector canônico de vazamento sobre o corpo serializado;
 *   4. conteúdo servido em streaming (`/md` e `/pdf`).
 *
 * O PDF é gerado de verdade (Chromium) e o TEXTO é extraído do artefato: é a
 * prova mais forte de que a superfície que o operador baixa não carrega detalhe
 * técnico.
 */

const { configureRuntimeRoot } = require('../../../api/utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../../api/services/ragService', () => ({
  indexDocument: jest.fn(async (doc) => ({ id: doc.id, chunksCreated: 3 })),
  deindexDocument: jest.fn(async () => ({ success: true, chunksRemoved: 3 })),
}));

const { detectProductionLeaks } = require('../../../api/services/learning/manualSanitizer');
const {
  isProductionManualDto, PRODUCTION_MANUAL_KEYS, PRODUCTION_STEP_KEYS,
} = require('../../../api/services/learning/manualProjection');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REPLAY_ID = 'api-production-replay-1';
const TECHNICAL_SELECTOR = '#membership-button';
const TECHNICAL_SELECTOR_2 = 'button:has-text("Salvar nota")';

const FORBIDDEN_KEYS = new Set([
  'replay', 'replayid', 'replayhash', 'selector', 'selectors', 'xpath',
  'success', 'action', 'adapter', 'timeoutms', 'durationms', 'uitrace',
  'trace', 'evidence', 'scenarioid', 'scenariocode', 'seed', 'wave',
  'classification', 'tenantid', 'createdby', 'ragdocumentid', 'ragchunkscreated',
]);

let runtimeRoot;
let manualService;

const REPLAY = {
  id: REPLAY_ID,
  tenantId: 'academia-a',
  journeyId: 'fitness_customer_checkin',
  uiTrace: [
    {
      index: 1,
      name: 'Abrir Matrícula do aluno',
      action: 'navigate',
      selector: '{{urls.frontend}}/fitness/students/1',
      input: null,
      success: true,
    },
    {
      index: 2,
      name: 'Seletor de data',
      action: 'click',
      selector: TECHNICAL_SELECTOR,
      input: null,
      success: true,
    },
    {
      index: 3,
      name: 'Salvar nota interna',
      action: 'fill',
      selector: TECHNICAL_SELECTOR_2,
      input: 'Nota do cliente 5511999999999',
      success: false,
    },
  ],
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-api-production-'));
  configureRuntimeRoot(runtimeRoot);
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, `${REPLAY_ID}.json`), JSON.stringify(REPLAY));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  configureRuntimeRoot(null);
});

beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line global-require
  manualService = require('../../../api/modules/learning-core/manualService');
});

function collectKeys(value, acc = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, acc));
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.add(String(key).toLowerCase());
      collectKeys(child, acc);
    }
  }
  return acc;
}

/** Asserção fail-closed: nenhum interno em nenhuma profundidade do payload. */
function assertNoInternals(payload, label) {
  const serialized = JSON.stringify(payload);
  const keys = collectKeys(payload);
  const hitKeys = [...keys].filter((key) => FORBIDDEN_KEYS.has(key));
  expect({ label, forbiddenKeys: hitKeys }).toEqual({ label, forbiddenKeys: [] });
  expect({ label, leaks: detectProductionLeaks(serialized).map((leak) => leak.ruleId) })
    .toEqual({ label, leaks: [] });
  for (const token of [REPLAY_ID, TECHNICAL_SELECTOR, TECHNICAL_SELECTOR_2]) {
    expect({ label, token, present: serialized.includes(token) }).toEqual({ label, token, present: false });
  }
}

/** `res` real de streaming: coleta os bytes servidos por `pipe`. */
function createStreamRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.statusCode = 0;
  res.headers = null;
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res.headers = headers || null;
    return res;
  };
  const finished = new Promise((resolve) => res.on('finish', resolve));
  return { res, chunks, finished, body: () => Buffer.concat(chunks) };
}

function buildDeps({ body = { replayId: REPLAY_ID } } = {}) {
  const sent = [];
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    sendJson: jest.fn((_res, code, data) => sent.push({ code, data })),
    badRequest: jest.fn((_res, message) => sent.push({ code: 400, data: { error: message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => body),
  };
  return { deps, sent };
}

/** eslint-disable-next-line global-require */
function loadHandler() {
  // eslint-disable-next-line global-require
  return require('../../../api/modules/learning-core/routes').handleLearningCoreRoutes;
}

async function invoke({ method, pathname, agent, body }) {
  const { deps, sent } = buildDeps({ body });
  await loadHandler()({
    req: { agent, tenantId: agent.tenantId },
    res: { writableEnded: false, writeHead: jest.fn(), end: jest.fn() },
    method,
    pathname,
    deps,
  });
  return sent;
}

const PRODUCTION_TENANT_ADMIN = {
  id: 'u-admin', username: 'admin', role: 'admin', tenantId: 'academia-a',
};
const PRODUCTION_AUDITOR = {
  id: 'u-auditor', username: 'auditor', role: 'auditor', tenantId: 'academia-a',
};
const SUPPORT_AGENT = {
  id: 'u-sup', username: 'sup', role: 'agent', tenantId: 'academia-a', platformRole: 'support_n2',
};
const DEVELOPMENT_AGENT = {
  id: 'u-dev', username: 'dev', role: 'agent', tenantId: 'academia-a', platformRole: 'engineer',
};

describe('L9 — resposta da API para principal PRODUCTION', () => {
  test('GET /api/learning/manuals devolve apenas DTO de produção', async () => {
    // Pré-condição: um manual real gerado por um perfil técnico.
    await manualService.generateManualFromReplay({ tenantId: 'academia-a', replayId: REPLAY_ID });

    const sent = await invoke({
      method: 'GET', pathname: '/api/learning/manuals', agent: PRODUCTION_TENANT_ADMIN,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].code).toBe(200);
    const manuals = sent[0].data.manuals;
    expect(manuals.length).toBeGreaterThan(0);
    for (const manual of manuals) {
      expect(isProductionManualDto(manual)).toBe(true);
      const stepKeys = Object.keys(manual.steps[0]).sort();
      expect(PRODUCTION_MANUAL_KEYS).toEqual(expect.arrayContaining(Object.keys(manual)));
      expect(PRODUCTION_STEP_KEYS).toEqual(expect.arrayContaining(stepKeys));
    }
    assertNoInternals(sent[0].data, 'GET /api/learning/manuals');
  });

  test('o mesmo para auditor de tenant (PRODUCTION, sem Platform Support automático)', async () => {
    await manualService.generateManualFromReplay({ tenantId: 'academia-a', replayId: REPLAY_ID });
    const sent = await invoke({
      method: 'GET', pathname: '/api/learning/manuals', agent: PRODUCTION_AUDITOR,
    });
    expect(sent[0].code).toBe(200);
    assertNoInternals(sent[0].data, 'GET auditor');
  });

  test('POST /api/learning/manuals/from-replay nega admin PRODUCTION (derivação é SUPPORT+)', async () => {
    const before = manualService.listManuals({ tenantId: 'academia-a' }).length;
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/manuals/from-replay', agent: PRODUCTION_TENANT_ADMIN,
    });

    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(sent[0].data.required).toBe('SUPPORT');
    expect(sent[0].data.classification).toBe('PRODUCTION');
    // Nada foi gerado/derivado para o principal PRODUCTION.
    expect(manualService.listManuals({ tenantId: 'academia-a' }).length).toBe(before);
  });

  test('POST por perfil de desenvolvimento devolve DTO sem internals', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/manuals/from-replay', agent: DEVELOPMENT_AGENT,
    });

    expect(sent[0].code).toBe(201);
    expect(isProductionManualDto(sent[0].data)).toBe(true);
    expect(sent[0].data.steps[1].name).toBe('Seletor de data');
    expect(sent[0].data.steps[2].completed).toBe(false);
    assertNoInternals(sent[0].data, 'POST from-replay');
  });

  test('POST por perfil SUPPORT também é autorizado (piso é SUPPORT)', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/manuals/from-replay', agent: SUPPORT_AGENT,
    });
    expect(sent[0].code).toBe(201);
    assertNoInternals(sent[0].data, 'POST from-replay SUPPORT');
  });
});

describe('L9 — arquivos servidos a principal PRODUCTION', () => {
  test('GET /:id/md serve markdown limpo', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a', replayId: REPLAY_ID,
    });
    const { deps, sent } = buildDeps();
    const { res, body, finished } = createStreamRes();

    await loadHandler()({
      req: { agent: PRODUCTION_TENANT_ADMIN, tenantId: 'academia-a' },
      res,
      method: 'GET',
      pathname: `/api/learning/manuals/${metadata.id}/md`,
      deps,
    });
    await finished;

    expect(sent).toHaveLength(0);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const markdown = body().toString('utf8');
    expect(detectProductionLeaks(markdown)).toEqual([]);
    expect(markdown).not.toContain(REPLAY_ID);
    expect(markdown).not.toContain(TECHNICAL_SELECTOR);
    expect(markdown).toContain('Seletor de data');
  }, 30000);

  test('GET /:id/pdf serve PDF real sem detalhe técnico (texto extraído)', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a', replayId: REPLAY_ID,
    });
    const { deps, sent } = buildDeps();
    const { res, body, finished } = createStreamRes();

    await loadHandler()({
      req: { agent: PRODUCTION_TENANT_ADMIN, tenantId: 'academia-a' },
      res,
      method: 'GET',
      pathname: `/api/learning/manuals/${metadata.id}/pdf`,
      deps,
    });
    await finished;

    expect(sent).toHaveLength(0);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const pdf = body();
    expect(pdf.length).toBeGreaterThan(1000);

    // eslint-disable-next-line global-require
    const pdfParse = require(path.join(REPO_ROOT, 'node_modules', 'pdf-parse'));
    const { text } = await pdfParse(pdf);
    expect(text.length).toBeGreaterThan(50);
    expect(detectProductionLeaks(text)).toEqual([]);
    expect(text).not.toMatch(/replay/i);
    expect(text).not.toContain(TECHNICAL_SELECTOR);
    expect(text).not.toContain('alvo');
    expect(text).toContain('passo não concluído');
  }, 60000);
});
