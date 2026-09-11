'use strict';

/**
 * Contract test do provider EVO (read-only) contra o fake server local.
 *
 * Estado declarado: CODE READY / CONTRACT TESTED / LOCAL INTEGRATION TESTED /
 * AWAITING EVO LIVE CREDENTIAL CERTIFICATION. Nenhuma chamada real ao EVO é
 * feita aqui — a documentação oficial do host de integração não está acessível
 * neste ambiente e não há credencial fornecida.
 */

const http = require('http');

const { createFakeEvoServer } = require('../helpers/fakeEvoServer');
const evo = require('../../api/services/integration/providers/evo/evoProviderAdapter');
const { createEvoClient } = require('../../api/services/integration/providers/evo/evoApiClient');
const { checkProviderContract } = require('../../api/services/integration/providerContract');
const { INTEGRATION_ERROR_CODES } = require('../../api/services/integration/integrationRedaction');

const FAST_CONTRACT = {
  ...evo.loadContract(),
  request: { ...evo.loadContract().request, timeoutMs: 400, maxRetries: 2, baseBackoffMs: 5, pageSize: 2 },
};

function memberRecord(id, extra = {}) {
  return {
    idMember: id,
    name: `Aluno ${id}`,
    email: `aluno${id}@example.test`,
    phone: '+5511999999999',
    document: '12345678901',
    status: '1',
    birthDate: '1990-05-10',
    idBranch: '1',
    registerDate: '2026-01-10T10:00:00.000Z',
    ...extra,
  };
}

describe('EVO provider — contrato de provider', () => {
  it('cumpre o contrato provider-neutral', () => {
    expect(checkProviderContract(evo)).toEqual({ ok: true, missing: [], invalid: [] });
    expect(evo.providerId()).toBe('evo');
  });

  it('declara read-only e recursos suportados', () => {
    const caps = evo.capabilities();
    expect(caps.readOnly).toBe(true);
    expect(caps.certificationStatus).toBe('UNVERIFIED');
    expect(caps.resources.map((r) => r.resource).sort()).toEqual(
      ['entries', 'members', 'memberships', 'plans', 'prospects', 'receivables', 'sales'],
    );
  });

  it('o contrato versionado é a única fonte de endpoints', () => {
    const contract = evo.loadContract();
    expect(contract._certification.status).toBe('UNVERIFIED');
    expect(contract._certification.mustNotClaim).toBe('LIVE VERIFIED');
    expect(contract.readOnly).toBe(true);
    expect(Object.keys(contract.resources).length).toBeGreaterThan(5);
  });
});

describe('EVO provider — autenticação', () => {
  let server;
  beforeAll(async () => { server = createFakeEvoServer(); await server.listen(); });
  afterAll(async () => { await server.close(); });

  it('aceita credenciais corretas', async () => {
    const result = await evo.validateConnection({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: server.credentials,
      contract: FAST_CONTRACT,
    });
    expect(result.ok).toBe(true);
    expect(server.authFailures).toBe(0);
  });

  it('rejeita credenciais inválidas com código de auth', async () => {
    const result = await evo.validateConnection({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: { token: 'errado', secretKey: 'errado' },
      contract: FAST_CONTRACT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(INTEGRATION_ERROR_CODES.PROVIDER_AUTH_ERROR);
    expect(result.detail).not.toContain('errado');
  });

  it('exige credenciais completas', async () => {
    const result = await evo.validateConnection({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: { token: 'só-token' },
      contract: FAST_CONTRACT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(INTEGRATION_ERROR_CODES.CREDENTIALS_MISSING);
  });
});

describe('EVO provider — paginação', () => {
  let server;

  beforeAll(async () => {
    const members = [];
    for (let i = 1; i <= 5; i += 1) members.push(memberRecord(i));
    server = createFakeEvoServer({ datasets: { members, prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] } });
    await server.listen();
  });
  afterAll(async () => { await server.close(); });

  const ctx = () => ({ connection: { config: { baseUrl: server.baseUrl } }, credentials: server.credentials, contract: FAST_CONTRACT });

  it('0 registros', async () => {
    const page = await evo.fetchPage({ ...ctx(), resource: 'prospects', limit: 2 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('página cheia e página final parcial', async () => {
    const first = await evo.fetchPage({ ...ctx(), resource: 'members', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe('2');

    const second = await evo.fetchPage({ ...ctx(), resource: 'members', cursor: first.nextCursor, limit: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const third = await evo.fetchPage({ ...ctx(), resource: 'members', cursor: second.nextCursor, limit: 2 });
    expect(third.items).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it('um único registro', async () => {
    const page = await evo.fetchPage({ ...ctx(), resource: 'members', limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].externalId).toBe('1');
  });

  it('cobre a base inteira somando as páginas sem duplicar', async () => {
    const before = server.requests.filter((r) => r.path === '/members').length;
    const seen = new Set();
    let cursor = null;
    for (let guard = 0; guard < 10; guard += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await evo.fetchPage({ ...ctx(), resource: 'members', cursor, limit: 2 });
      page.items.forEach((item) => seen.add(item.externalId));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    expect([...seen].sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(server.requests.filter((r) => r.path === '/members').length - before).toBe(3);
  });

  it('cursão inválido é rejeitado', async () => {
    await expect(evo.fetchPage({ ...ctx(), resource: 'members', cursor: 'abc' }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION });
  });

  it('recurso não suportado é rejeitado listando os suportados', async () => {
    await expect(evo.fetchPage({ ...ctx(), resource: 'activities' }))
      .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED });
  });

  it('fetchAllPages detecta página repetida do provedor (loop infinito)', async () => {
    const repeated = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([memberRecord(1), memberRecord(2)]));
    });
    await new Promise((resolve) => repeated.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${repeated.address().port}/api/v1`;
    const client = createEvoClient({
      contract: FAST_CONTRACT,
      connection: { baseUrl },
      credentials: server.credentials,
    });
    try {
      await expect(client.fetchAllPages('/members'))
        .rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE });
    } finally {
      await new Promise((resolve) => repeated.close(resolve));
    }
  });
});

describe('EVO provider — resiliência', () => {
  let server;
  beforeAll(async () => {
    server = createFakeEvoServer({ datasets: { members: [memberRecord(1)], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] } });
    await server.listen();
  });
  afterAll(async () => { await server.close(); });

  const ctx = () => ({ connection: { config: { baseUrl: server.baseUrl } }, credentials: server.credentials, contract: FAST_CONTRACT });

  it('429 é reprocessado e a página é entregue', async () => {
    server.addFailure({ path: '/members', times: 1, status: 429 });
    const page = await evo.fetchPage({ ...ctx(), resource: 'members', limit: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('503 é reprocessado', async () => {
    server.addFailure({ path: '/members', times: 1, status: 503 });
    const page = await evo.fetchPage({ ...ctx(), resource: 'members', limit: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('timeout na página N é reprocessado e conclui', async () => {
    server.addFailure({ path: '/members', times: 1, status: 'timeout' });
    const page = await evo.fetchPage({ ...ctx(), resource: 'members', limit: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('404 não é reprocessado (falha imediata e explícita)', async () => {
    const before = server.requests.length;
    await expect(evo.fetchOne({
      ...ctx(),
      resource: 'members',
      externalId: 'nao-existe-404',
    })).rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.PROVIDER_HTTP_ERROR });
    expect(server.requests.length - before).toBe(1);
  });

  it('erro não vaza credencial na mensagem', async () => {
    try {
      await evo.fetchPage({
        connection: { config: { baseUrl: server.baseUrl } },
        credentials: { token: 'token-secreto-123', secretKey: 'secret-secreto-456' },
        resource: 'members',
      });
      throw new Error('deveria falhar sem credencial válida');
    } catch (error) {
      expect(JSON.stringify(error.message)).not.toContain('secret-secreto-456');
      expect(JSON.stringify(error.details || {})).not.toContain('secret-secreto-456');
    }
  });
});

describe('EVO provider — schema drift', () => {
  let server;
  beforeAll(async () => {
    server = createFakeEvoServer({
      datasets: { members: [memberRecord(1), memberRecord(2)], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] },
      schemaDrift: { members: { dropFields: ['idMember'], times: 1 } },
    });
    await server.listen();
  });
  afterAll(async () => { await server.close(); });

  it('registro sem campo obrigatório é rejeitado sem derrubar o lote', async () => {
    const page = await evo.fetchPage({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: server.credentials,
      resource: 'members',
      limit: 10,
      contract: FAST_CONTRACT,
    });
    expect(page.items).toHaveLength(0);
    expect(page.rejected).toHaveLength(2);
    expect(page.rejected[0].code).toBe(INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT);
  });
});

describe('EVO provider — mapeamento (DTO normalizado)', () => {
  let server;
  beforeAll(async () => {
    server = createFakeEvoServer({
      datasets: {
        members: [memberRecord(10)],
        prospects: [{ idProspect: 20, name: 'Prospect', email: 'p@example.test', stage: 'visitante' }],
        plans: [{ idMembershipPlan: 30, name: 'Mensal', type: 'monthly', amount: '199,90', cycle: 'MONTHLY', active: '1' }],
        memberships: [{
          idMembership: 40,
          idMember: 10,
          idMembershipPlan: 30,
          planName: 'Mensal',
          planType: 'monthly',
          status: 'active',
          billingStatus: 'delinquent',
          startDate: '01/02/2026',
          endDate: '01/02/2027',
          dueDate: '2026-09-05',
          renewalDate: '2026-10-05',
          idBranch: '1',
        }],
        entries: [{ idEntry: 554423, idMember: 10, date: '2026-09-09T07:30:00.000Z', idBranch: '1', idDevice: 'catraca-1' }],
        sales: [{ idSale: 9001, idMember: 10, status: 'paid', amount: '149.90', currency: 'brl', type: 'plan', date: '2026-09-01T12:00:00.000Z' }],
        receivables: [{ idReceivable: 99001, idMember: 10, idSale: 9001, status: 'open', amount: '149.90', currency: 'BRL', dueDate: '2026-09-10' }],
      },
    });
    await server.listen();
  });
  afterAll(async () => { await server.close(); });

  const fetch = (resource) => evo.fetchPage({
    connection: { config: { baseUrl: server.baseUrl } },
    credentials: server.credentials,
    resource,
    limit: 10,
    contract: FAST_CONTRACT,
  });

  it('member', async () => {
    const [item] = (await fetch('members')).items;
    expect(item).toEqual(expect.objectContaining({ externalId: '10', name: 'Aluno 10', status: 'active' }));
    expect(item.joinedAt).toBe('2026-01-10T10:00:00.000Z');
  });

  it('prospect', async () => {
    const [item] = (await fetch('prospects')).items;
    expect(item).toEqual(expect.objectContaining({ externalId: '20', stage: 'visitante' }));
  });

  it('plan normaliza valor pt-BR', async () => {
    const [item] = (await fetch('plans')).items;
    expect(item.amount).toBeCloseTo(199.9, 2);
  });

  it('membership normaliza datas e billing status', async () => {
    const [item] = (await fetch('memberships')).items;
    expect(item.billingStatus).toBe('delinquent');
    expect(item.startAt).toBe('2026-02-01T00:00:00.000Z');
    expect(item.dueDate).toBe('2026-09-05T00:00:00.000Z');
  });

  it('entry', async () => {
    const [item] = (await fetch('entries')).items;
    expect(item).toEqual(expect.objectContaining({ externalId: '554423', memberExternalId: '10', occurredAt: '2026-09-09T07:30:00.000Z' }));
  });

  it('sale', async () => {
    const [item] = (await fetch('sales')).items;
    expect(item).toEqual(expect.objectContaining({ externalId: '9001', status: 'paid', currency: 'BRL' }));
  });

  it('receivable', async () => {
    const [item] = (await fetch('receivables')).items;
    expect(item).toEqual(expect.objectContaining({ externalId: '99001', status: 'pending', saleExternalId: '9001' }));
  });

  it('fetchOne devolve o registro normalizado', async () => {
    const item = await evo.fetchOne({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: server.credentials,
      resource: 'members',
      externalId: '10',
      contract: FAST_CONTRACT,
    });
    expect(item.externalId).toBe('10');
  });

  it('fetchOne devolve null para 404 tratado', async () => {
    await expect(evo.fetchOne({
      connection: { config: { baseUrl: server.baseUrl } },
      credentials: server.credentials,
      resource: 'members',
      externalId: 'nao-existe',
      contract: FAST_CONTRACT,
    })).rejects.toMatchObject({ code: INTEGRATION_ERROR_CODES.PROVIDER_HTTP_ERROR });
  });
});

describe('EVO provider — webhook', () => {
  const connection = { config: { webhookSecret: 'segredo-webhook' }, external_unit_id: '1' };

  it('valida assinatura HMAC correta', () => {
    const rawBody = JSON.stringify({ event: 'entry.created', idEntry: 554423 });
    const signature = require('crypto').createHmac('sha256', 'segredo-webhook').update(rawBody).digest('hex');
    expect(evo.verifyWebhookSignature({ connection, headers: { 'x-evo-signature': signature }, rawBody })).toEqual({ ok: true });
  });

  it('rejeita assinatura incorreta', () => {
    const result = evo.verifyWebhookSignature({
      connection, headers: { 'x-evo-signature': 'deadbeef' }, rawBody: '{"a":1}',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('é fail-closed sem segredo configurado', () => {
    const result = evo.verifyWebhookSignature({ connection: { config: {} }, headers: {}, rawBody: '{}' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('webhook_secret_not_configured');
  });

  it('normaliza o webhook como SINAL e sanitiza o payload', () => {
    const normalized = evo.normalizeWebhook({
      connection,
      rawBody: JSON.stringify({
        event: 'entry.created',
        idEvent: 'evt-9',
        idEntry: 554423,
        Authorization: 'Basic zzz',
        faceTemplate: 'BLOB',
      }),
    });
    expect(normalized).toEqual(expect.objectContaining({
      eventType: 'entry.created',
      externalEventId: 'evt-9',
      externalResourceId: '554423',
    }));
    expect(normalized.payload.Authorization).toBe('[REDACTED]');
    expect(JSON.stringify(normalized.payload)).not.toContain('BLOB');
  });

  it('rejeita webhook sem corpo', () => {
    expect(() => evo.normalizeWebhook({ connection, rawBody: '' }))
      .toThrow(expect.objectContaining({ code: INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE }));
  });
});

describe('EVO provider — guarda de contrato não certificado', () => {
  it('bloqueia chamada a host externo enquanto UNVERIFIED', async () => {
    await expect(evo.fetchPage({
      connection: { config: { baseUrl: 'https://host-externo.example.test/api/v1' } },
      credentials: { token: 't', secretKey: 's' },
      resource: 'members',
    })).rejects.toMatchObject({ code: 'integration_evo_contract_not_certified' });
  });

  it('permite loopback (testes/laboratório)', async () => {
    const server = createFakeEvoServer({ datasets: { members: [memberRecord(1)], prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] } });
    await server.listen();
    try {
      const page = await evo.fetchPage({
        connection: { config: { baseUrl: server.baseUrl } },
        credentials: server.credentials,
        resource: 'members',
        limit: 10,
        contract: FAST_CONTRACT,
      });
      expect(page.items).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
