'use strict';

/**
 * Bakery Vertical — End-to-End Integration Test (fase 3)
 *
 * A vertical bakery NÃO tem rotas/serviços dedicados: as jornadas operam sobre
 * os primitivos da plataforma (tickets/orders/marketing/CRM). Este teste
 * valida o que existe de fato:
 *
 * 1. Registry de jornadas bakery (config/qa-waves-registry.json)
 * 2. Contratos e precondições (config/journey-contracts.json / journey-preconditions.json)
 * 3. Bakery como vertical obrigatória (governance/shared/required-journeys.js)
 * 4. FLOW_SCENARIOS cobrindo as 5 jornadas (tests/rpa/business/catalog.js)
 * 5. Executores reais rodando contra um client de API stub (sem rede/DB)
 * 6. Template de vertical (api/modules/vertical-templates) e config/verticals.json
 * 7. Segmento de onboarding padaria/bakery (api/services/onboardingService.js)
 * 8. Seed do marketplace (mkt-segment-padaria) com fluxo válido
 *
 * Boundary: sem DB e sem rede — os executores rodam contra stubs do client
 * `api` (mesma superfície usada em produção pelo RPA CLI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

const { FLOW_SCENARIOS } = require('../rpa/business/catalog');
const { runFlowScenario } = require('../rpa/business/runtime');
const { REQUIRED_VERTICALS, PROD_LIKE_JOURNEY_VERTICAL } = require('../../governance/shared/required-journeys');
const { DEFAULT_TEMPLATES } = require('../../api/modules/vertical-templates/service');

const BAKERY_JOURNEYS = [
  'bakery_encomenda_flow',
  'bakery_balcao_retirada',
  'bakery_producao_fornada',
  'bakery_estoque_perdas',
  'bakery_reativacao_cliente',
];

function scenarioOf(code) {
  const found = FLOW_SCENARIOS.find((item) => item.code === code);
  if (!found) throw new Error(`Cenario nao encontrado no catalogo: ${code}`);
  return found;
}

// ── Stubs do client `api` (mesma superfície de createApiClient) ─────────────

function makeTicketApi() {
  const tickets = new Map();
  let seq = 0;
  return {
    async post(url, body) {
      if (url === '/tickets') {
        seq += 1;
        const id = `t-stub-${seq}`;
        tickets.set(id, { id, status: 'open', ...body });
        return { id };
      }
      const action = url.match(/^\/tickets\/([^/]+)\/(takeover|message|close)$/);
      if (action) {
        const ticket = tickets.get(decodeURIComponent(action[1]));
        if (!ticket) throw new Error('ticket desconhecido');
        if (action[2] === 'close') ticket.status = 'closed';
        return { ok: true };
      }
      throw new Error(`POST inesperado: ${url}`);
    },
    async get(url) {
      const one = url.match(/^\/tickets\/([^/]+)$/);
      if (one) return tickets.get(decodeURIComponent(one[1])) || null;
      throw new Error(`GET inesperado: ${url}`);
    },
  };
}

function makeOrderApi(initialOrders) {
  const orders = new Map(initialOrders.map((order) => [order.id, { ...order }]));
  return {
    async get(url) {
      if (url.startsWith('/orders?')) {
        return { orders: Array.from(orders.values()), total: orders.size };
      }
      const one = url.match(/^\/orders\/([^/]+)$/);
      if (one) return { order: orders.get(decodeURIComponent(one[1])) || null };
      throw new Error(`GET inesperado: ${url}`);
    },
    async put(url, body) {
      const status = url.match(/^\/orders\/([^/]+)\/status$/);
      if (status) {
        const order = orders.get(decodeURIComponent(status[1]));
        if (!order) throw new Error('pedido desconhecido');
        order.status = body.status;
        return { ok: true };
      }
      throw new Error(`PUT inesperado: ${url}`);
    },
    async post(url) {
      const incident = url.match(/^\/orders\/([^/]+)\/incidents$/);
      if (incident) {
        return { ok: true, ticket: { id: 't-loss-stub', status: 'open' } };
      }
      throw new Error(`POST inesperado: ${url}`);
    },
  };
}

function makeMarketingApi() {
  const items = [];
  return {
    async get(url) {
      if (url.startsWith('/api/marketing/email-campaigns')) {
        return { items, total: items.length };
      }
      throw new Error(`GET inesperado: ${url}`);
    },
    async post(url, body) {
      if (url === '/api/marketing/email-campaigns') {
        const campaign = { id: `camp-stub-${items.length + 1}`, name: body.name };
        items.push(campaign);
        return { campaign };
      }
      if (url.match(/^\/api\/marketing\/email-campaigns\/[^/]+\/send$/)) {
        return { ok: true };
      }
      throw new Error(`POST inesperado: ${url}`);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe('Bakery Vertical — End-to-End Journey', () => {

  describe('1. Registry de jornadas (qa-waves)', () => {
    test('as 5 jornadas bakery estão registradas com steps reais', () => {
      const registry = loadJson('config/qa-waves-registry.json');
      const bakery = registry.verticalJourneys && registry.verticalJourneys.bakery;
      expect(bakery).toBeTruthy();
      expect(Object.keys(bakery).sort()).toEqual([...BAKERY_JOURNEYS].sort());
      for (const journey of BAKERY_JOURNEYS) {
        expect(Array.isArray(bakery[journey].steps)).toBe(true);
        expect(bakery[journey].steps.length).toBeGreaterThanOrEqual(5);
        expect(typeof bakery[journey].name).toBe('string');
      }
    });
  });

  describe('2. Contratos e precondições', () => {
    test('journey-contracts cobre as 5 jornadas bakery', () => {
      const contracts = loadJson('config/journey-contracts.json');
      for (const journey of BAKERY_JOURNEYS) {
        expect(contracts.journeys[journey]).toBeTruthy();
        expect(Array.isArray(contracts.journeys[journey].requiredCapabilities)).toBe(true);
        expect(contracts.journeys[journey].requiredCapabilities.length).toBeGreaterThan(0);
      }
    });

    test('journey-preconditions cobre as 5 jornadas bakery', () => {
      const preconditions = loadJson('config/journey-preconditions.json');
      for (const journey of BAKERY_JOURNEYS) {
        expect(preconditions[journey]).toBeTruthy();
      }
    });
  });

  describe('3. Bakery como vertical obrigatória (governança)', () => {
    test('REQUIRED_VERTICALS inclui bakery', () => {
      expect(REQUIRED_VERTICALS).toContain('bakery');
    });

    test('bakery_encomenda_flow é a jornada prod-like da vertical', () => {
      expect(PROD_LIKE_JOURNEY_VERTICAL.bakery_encomenda_flow).toBe('bakery');
    });

    test('config/verticals.json declara o domínio bakery com alias padaria', () => {
      const verticals = loadJson('config/verticals.json');
      expect(verticals.domains.bakery).toEqual(expect.objectContaining({
        kind: 'vertical',
        aliases: expect.arrayContaining(['padaria']),
      }));
    });
  });

  describe('4. FLOW_SCENARIOS executáveis cobrem as 5 jornadas', () => {
    test('toda jornada bakery tem ao menos um flow scenario executável', () => {
      const bakeryFlows = FLOW_SCENARIOS.filter((item) => item.vertical === 'bakery');
      const covered = new Set(bakeryFlows.map((item) => item.journey));
      for (const journey of BAKERY_JOURNEYS) {
        expect(covered.has(journey)).toBe(true);
      }
      for (const flow of bakeryFlows) {
        expect(flow.type).toBe('flow');
        expect(flow.validations).toEqual(expect.objectContaining({ requireBackendValidation: true }));
      }
    });

    test('todo flow scenario bakery tem branch de executor no runtime', () => {
      // Guard estático: o executor BAKERY-FLOW-CLIENTE-RECORRENTE depende de DB
      // (marketingService/accessControlService) e não roda contra stub; este
      // guard garante que nenhum cenário do catálogo fica sem executor.
      const source = fs.readFileSync(path.join(ROOT, 'tests/rpa/business/runtime.js'), 'utf8');
      const bakeryFlows = FLOW_SCENARIOS.filter((item) => item.vertical === 'bakery');
      for (const flow of bakeryFlows) {
        expect(source).toContain(`definition.code === '${flow.code}'`);
      }
    });
  });

  describe('5. Executores contra API stub (sem rede/DB)', () => {
    test('BAKERY-FLOW-ENCOMENDA: encomenda aberta, produzida e entregue (tickets)', async () => {
      const api = makeTicketApi();
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-ENCOMENDA'), { api, runId: 'jest-bakery' });
      expect(result.ids.ticketId).toBeTruthy();
      expect(result.evidence.finalStatus).toBe('closed');
    });

    test('BAKERY-FLOW-BALCAO-RETIRADA: pedido de balcão até retirada (tickets)', async () => {
      const api = makeTicketApi();
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-BALCAO-RETIRADA'), { api, runId: 'jest-bakery' });
      expect(result.ids.ticketId).toBeTruthy();
      expect(result.evidence.finalStatus).toBe('closed');
    });

    test('BAKERY-FLOW-BALCAO-RETIRADA falha fechado se a retirada não é confirmada', async () => {
      const api = makeTicketApi();
      const originalPost = api.post.bind(api);
      api.post = async (url, body) => {
        if (url.endsWith('/close')) return { ok: true }; // close ignorado pelo backend
        return originalPost(url, body);
      };
      await expect(
        runFlowScenario(scenarioOf('BAKERY-FLOW-BALCAO-RETIRADA'), { api, runId: 'jest-bakery' }),
      ).rejects.toThrow(/Retirada nao confirmada/);
    });

    test('BAKERY-FLOW-PEDIDO-STATUS: pedido avança uma etapa (orders)', async () => {
      const api = makeOrderApi([{ id: 'o-1', status: 'confirmed' }]);
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-PEDIDO-STATUS'), { api, runId: 'jest-bakery' });
      expect(result.ids.orderId).toBe('o-1');
      expect(result.evidence).toEqual(expect.objectContaining({ from: 'confirmed', to: 'preparing' }));
    });

    test('BAKERY-FLOW-PRODUCAO-FORNADA: fornada avança até disponibilidade ready (orders)', async () => {
      const api = makeOrderApi([{ id: 'o-2', status: 'created' }]);
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-PRODUCAO-FORNADA'), { api, runId: 'jest-bakery' });
      expect(result.ids.orderId).toBe('o-2');
      expect(result.evidence.finalStatus).toBe('ready');
      expect(result.evidence.transitions).toEqual([
        { from: 'created', to: 'confirmed' },
        { from: 'confirmed', to: 'preparing' },
        { from: 'preparing', to: 'ready' },
      ]);
    });

    test('BAKERY-FLOW-PRODUCAO-FORNADA sem pedidos elegíveis degrada explicitamente', async () => {
      const api = makeOrderApi([{ id: 'o-3', status: 'delivered' }]);
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-PRODUCAO-FORNADA'), { api, runId: 'jest-bakery' });
      expect(result.ids).toEqual({});
      expect(result.detail).toMatch(/sem fornada elegivel/);
    });

    test('BAKERY-FLOW-ESTOQUE-PERDAS: perda registrada como incidente do pedido', async () => {
      const ordersApi = makeOrderApi([{ id: 'o-4', status: 'delivered' }]);
      const api = {
        ...ordersApi,
        async get(url) {
          if (url === '/tickets/t-loss-stub') return { id: 't-loss-stub', status: 'open' };
          return ordersApi.get(url);
        },
      };
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-ESTOQUE-PERDAS'), { api, runId: 'jest-bakery' });
      expect(result.ids).toEqual(expect.objectContaining({ orderId: 'o-4', ticketId: 't-loss-stub' }));
      expect(result.evidence.incidentType).toBe('perda_estoque');
    });

    test('BAKERY-FLOW-CAMPANHA-COMBO: campanha de combo criada e disparada (marketing)', async () => {
      const api = makeMarketingApi();
      const result = await runFlowScenario(scenarioOf('BAKERY-FLOW-CAMPANHA-COMBO'), { api, runId: 'jest-bakery' });
      expect(result.ids.campaignId).toBe('camp-stub-1');
    });
  });

  describe('6. Template de vertical (vertical-templates)', () => {
    test('DEFAULT_TEMPLATES contém Bakery com as 5 jornadas', () => {
      const bakery = DEFAULT_TEMPLATES.find((tpl) => tpl.slug === 'bakery');
      expect(bakery).toBeTruthy();
      expect(bakery.journeys).toEqual([
        'bakery-encomendas',
        'bakery-balcao-retirada',
        'bakery-producao-fornada',
        'bakery-estoque-perdas',
        'bakery-reativacao-cliente',
      ]);
      expect(bakery.kpis.length).toBeGreaterThan(0);
    });
  });

  describe('7. Segmento padaria no onboarding do tenant', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    function setupOnboardingMocks() {
      const requestedIds = [];
      const tenant = { id: 'tenant-bakery', createdAt: '2026-09-02T10:00:00.000Z', settings: {} };

      jest.doMock('../../api/utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      jest.doMock('../../api/services/tenantService', () => ({
        getTenant: jest.fn(() => tenant),
        updateTenant: jest.fn(() => ({ success: true })),
      }));
      jest.doMock('../../api/services/queueService', () => ({
        createQueue: jest.fn(() => ({ success: true, queue: { id: 'q-1' } })),
      }));
      jest.doMock('../../api/services/authService', () => ({ createAgent: jest.fn(() => ({ success: true })) }));
      jest.doMock('../../api/services/quickRepliesService', () => ({
        createQuickReply: jest.fn(() => ({ success: true, quickReply: { id: 'qr-1' } })),
      }));
      jest.doMock('../../api/services/flowTemplateMarketplaceService', () => ({
        getTemplate: jest.fn(({ id }) => {
          requestedIds.push(id);
          return { name: `Tpl ${id}`, description: '', icon: 'x', tags: [], flow: { nodes: [] } };
        }),
        createTemplate: jest.fn(async (payload) => ({ success: true, template: { id: payload.id } })),
      }));

      return { requestedIds, tenant };
    }

    test.each(['padaria', 'bakery'])('segmento %s inclui o template mkt-segment-padaria', async (segment) => {
      const { requestedIds } = setupOnboardingMocks();
      // eslint-disable-next-line global-require
      const { createInitialTemplates } = require('../../api/services/onboardingService');

      const out = await createInitialTemplates('tenant-bakery', { segment });
      expect(out.success).toBe(true);
      expect(requestedIds).toContain('mkt-segment-padaria');
      expect(requestedIds).toContain('mkt-status-pedido-servico');
    });
  });

  describe('8. Seed do marketplace (mkt-segment-padaria)', () => {
    test('seed spec declara segment-padaria e o arquivo de fluxo existe', () => {
      const source = fs.readFileSync(path.join(ROOT, 'api/services/flowTemplateMarketplaceService.js'), 'utf8');
      expect(source).toContain("id: 'segment-padaria'");
      expect(source).toContain("file: 'padaria-padrao.json'");

      const templatePath = path.join(ROOT, 'frontend/public/templates/padaria-padrao.json');
      expect(fs.existsSync(templatePath)).toBe(true);
    });

    test('fluxo da padaria é estruturalmente íntegro (ids, start/end e referências next)', () => {
      // O template segue o padrão de crossfit-academia.json (seed do segmento
      // academia): o marketplace exige id/name/flow (tryLoadSeedTemplate) —
      // aqui validamos adicionalmente a integridade das referências entre nós.
      const template = loadJson('frontend/public/templates/padaria-padrao.json');
      expect(template.id).toBe('padaria-padrao');
      expect(template.name).toBeTruthy();
      expect(Array.isArray(template.flow.nodes)).toBe(true);

      const nodeIds = new Set(template.flow.nodes.map((node) => node.id));
      expect(nodeIds.size).toBe(template.flow.nodes.length);
      expect(template.flow.nodes.some((node) => node.type === 'start')).toBe(true);
      expect(template.flow.nodes.some((node) => node.type === 'end')).toBe(true);

      const refs = [];
      for (const node of template.flow.nodes) {
        if (typeof node.next === 'string') refs.push(node.next);
        if (node.next && typeof node.next === 'object') refs.push(...Object.values(node.next));
        for (const rule of (node.config && node.config.rules) || []) {
          if (rule.next) refs.push(rule.next);
        }
      }
      for (const ref of refs) {
        expect(nodeIds.has(ref)).toBe(true);
      }
    });
  });
});
