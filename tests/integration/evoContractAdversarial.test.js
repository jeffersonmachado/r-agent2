'use strict';

/**
 * EVO — SUÍTE ADVERSARIAL DO CONTRATO (§13–§36, §47)
 *
 * Cada teste aqui representa uma SITUAÇÃO INVÁLIDA que o sistema precisa
 * REJEITAR. Verde só é verde quando o sistema recusa o cenário — não quando ele
 * "passa por acaso".
 *
 * Cobre:
 *  - auth oficial (DNS da academia como usuário, Secret Key como senha) e a
 *    recusa do dialeto errado (`token`);
 *  - SSRF: metadata, loopback não autorizado, faixas privadas;
 *  - paginação take/skip resource-aware e `maxTake` específico por recurso;
 *  - `Membership` (catálogo) ≠ `MemberMembership` (contrato do aluno);
 *  - incremental por recurso, sem `updatedSince` global;
 *  - webhook: cabeçalho customizado + dedup de replay + fail-closed;
 *  - estados de contrato separados (local PASS ≠ live certified).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const evo = require('../../api/services/integration/providers/evo/evoProviderAdapter');
const {
  createEvoClient, assertEndpointIsSafe, resolvePagination, buildPaginationQuery, resolveTake, isBlockedIpv4,
  buildAuthHeader,
} = require('../../api/services/integration/providers/evo/evoApiClient');
const { MAPPERS, normalizeResourceRecord } = require('../../api/services/integration/providers/evo/evoMappers');
const { createFakeEvoServer, labConfig } = require('../helpers/fakeEvoServer');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'integrations', 'evo-contract.json'), 'utf8'));

const CREDENTIALS = { academyDns: 'academia-teste', secretKey: 'chave-secreta' };

// ── §13 AUTENTICAÇÃO ──────────────────────────────────────────────────────

describe('§13 autenticação oficial: DNS da academia + Secret Key', () => {
  it('o contrato declara o dialeto oficial (academyDns) e NÃO um alias "token"', () => {
    expect(CONTRACT.auth.type).toBe('basic');
    expect(CONTRACT.auth.usernameField).toBe('academyDns');
    expect(CONTRACT.auth.passwordField).toBe('secretKey');
    expect(CONTRACT.auth.usernameField).not.toBe('token');
    expect(CONTRACT.auth._rejectedAlternative.usernameField).toBe('token');
    expect(CONTRACT.auth.verification).toBe('UNVERIFIED');
  });

  it('o header Authorization é exatamente Basic base64(academyDns:secretKey)', () => {
    expect(buildAuthHeader(CONTRACT, CREDENTIALS))
      .toBe(`Basic ${Buffer.from('academia-teste:chave-secreta', 'utf8').toString('base64')}`);
  });

  it('credencial nomeada "token" é REJEITADA (o dialeto errado falha alto)', () => {
    expect(() => buildAuthHeader(CONTRACT, { token: 'x', secretKey: 'y' }))
      .toThrow(/credenciais incompletas|credenciais/i);
  });

  it('a Secret Key nunca aparece no erro de credencial faltante', () => {
    let message = '';
    try {
      buildAuthHeader(CONTRACT, { academyDns: 'a', secretKey: '' });
    } catch (error) {
      message = `${error.message} ${JSON.stringify(error.details || error.detail || {})}`;
    }
    expect(message).not.toContain('chave-secreta');
  });
});

// ── §14/§15 HOST + SSRF ───────────────────────────────────────────────────

describe('§14 host oficial não é presumido', () => {
  it('nenhum host é declarado OFICIAL sem documentação oficial que o autorize', () => {
    expect(CONTRACT._hostPolicy.officialHost).toBeNull();
    expect(CONTRACT._hostPolicy.allowlist).toEqual([]);
    expect(CONTRACT.defaultBaseUrlOfficial).toBe(false);
  });

  it('o host candidato carrega o estado de verificação e a falha de resolução', () => {
    expect(CONTRACT._hostPolicy.candidateHost).toBe('evo-integracao.wanessa.cloud');
    expect(CONTRACT._hostPolicy.candidateHostVerification).toBe('UNVERIFIED');
    expect(CONTRACT._hostPolicy.candidateHostResolution).toMatch(/DNS_UNRESOLVED/);
  });

  it('chamada para o host candidato NÃO certificado é bloqueada por padrão', async () => {
    const client = createEvoClient({ contract: CONTRACT, connection: {}, credentials: CREDENTIALS });
    await expect(client.rawRequest('/members')).rejects.toMatchObject({
      code: 'integration_evo_contract_not_certified',
    });
  });

  it('a API Financeiro (client credentials) NÃO é adotada como auth da integração', () => {
    expect(CONTRACT.auth.identityTokenPath).toBeUndefined();
    expect(String(CONTRACT.auth.type)).not.toMatch(/client_credentials/);
    expect(CONTRACT._officialDocsConsultation.authModelFinding).toMatch(/client credentials/i);
  });
});

describe('§15 SSRF: baseUrl configurável não pode virar arma', () => {
  const policy = CONTRACT._ssrfPolicy;

  it('metadata de nuvem é bloqueado', () => {
    const verdict = assertEndpointIsSafe(new URL('https://169.254.169.254/latest/meta-data'), policy, {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/blocked_ip_range/);
  });

  it('faixas privadas RFC1918 são bloqueadas', () => {
    for (const host of ['10.0.0.5', '172.16.4.4', '192.168.1.10']) {
      expect(assertEndpointIsSafe(new URL(`https://${host}/api/v1`), policy, {}).ok).toBe(false);
    }
  });

  it('loopback só passa com opt-in de laboratório explícito', () => {
    const url = new URL('http://127.0.0.1:1234/api/v1');
    expect(assertEndpointIsSafe(url, policy, {}).ok).toBe(false);
    expect(assertEndpointIsSafe(url, policy, { allowLoopback: true }).ok).toBe(true);
  });

  it('IPv6 loopback / link-local / ULA são bloqueados', () => {
    for (const host of ['[::1]', '[fe80::1]', '[fd00::1]']) {
      expect(assertEndpointIsSafe(new URL(`https://${host}/api/v1`), policy, {}).ok).toBe(false);
    }
  });

  it('http puro contra host externo exige opt-in explícito', () => {
    expect(assertEndpointIsSafe(new URL('http://concorrente.example/api'), policy, {}).ok).toBe(false);
    expect(assertEndpointIsSafe(new URL('https://concorrente.example/api'), policy, {}).ok).toBe(true);
  });

  it('hostname de metadata é bloqueado mesmo com resolução DNS plausível', () => {
    expect(assertEndpointIsSafe(new URL('https://metadata.google.internal/x'), policy, {}).ok).toBe(false);
  });

  it('o guard SSRF roda ANTES da requisição (nenhum fetch acontece)', async () => {
    let called = false;
    const client = createEvoClient({
      contract: CONTRACT,
      connection: { config: { baseUrl: 'https://169.254.169.254/api/v1', allowUnverifiedEndpoints: true } },
      credentials: CREDENTIALS,
      fetchImpl: async () => { called = true; return { status: 200, text: async () => '{}' }; },
    });
    await expect(client.rawRequest('/members')).rejects.toMatchObject({ code: 'integration_endpoint_blocked_ssrf' });
    expect(called).toBe(false);
  });

  it('allowUnverifiedEndpoints NÃO libera faixa privada (só loopback de laboratório)', () => {
    const verdict = assertEndpointIsSafe(new URL('https://10.1.2.3/api'), policy, { allowLoopback: false });
    expect(verdict.ok).toBe(false);
  });

  it('isBlockedIpv4 é determinístico e não aceita octeto inválido', () => {
    expect(isBlockedIpv4('10.1.2.3').blocked).toBe(true);
    expect(isBlockedIpv4('8.8.8.8').blocked).toBe(false);
    expect(isBlockedIpv4('999.1.1.1')).toBeNull();
  });
});

// ── §19/§20 PAGINAÇÃO ─────────────────────────────────────────────────────

describe('§19 paginação é resource-specific (take/skip), não global', () => {
  it('o contrato NÃO declara mais page/size como dialeto', () => {
    expect(CONTRACT.pagination.pageParam).toBeUndefined();
    expect(CONTRACT.pagination.sizeParam).toBeUndefined();
    expect(CONTRACT._paginationModels.takeSkip.takeParam).toBe('take');
    expect(CONTRACT._paginationModels.takeSkip.skipParam).toBe('skip');
  });

  it('cada recurso declara o próprio modelo e o próprio maxTake', () => {
    for (const [resource, config] of Object.entries(CONTRACT.resources)) {
      if (!config.pagination) throw new Error(`${resource} sem pagination`);
      expect(config.pagination.model).toBe('takeSkip');
      expect(Number.isFinite(config.pagination.maxTake)).toBe(true);
      expect(config.pagination.maxTake).toBeGreaterThan(0);
    }
    // Não existe constante global de tamanho de página.
    expect(CONTRACT.request.pageSize).toBeUndefined();
  });

  it('buildPaginationQuery usa take/skip e NUNCA page/size', () => {
    const pagination = resolvePagination(CONTRACT, 'entries');
    const { query } = buildPaginationQuery(pagination, { cursor: 20, take: 10 });
    expect(query).toEqual({ take: 10, skip: 20 });
    expect(query.page).toBeUndefined();
    expect(query.size).toBeUndefined();
  });

  it('take pedido acima do maxTake do recurso é truncado no máximo do recurso', () => {
    const pagination = resolvePagination(CONTRACT, 'entries');
    expect(resolveTake(pagination, 100000)).toBe(pagination.maxTake);
  });

  it('recursos DIFERENTES podem declarar limites DIFERENTES (limite é do recurso)', () => {
    const contract = JSON.parse(JSON.stringify(CONTRACT));
    contract.resources.entries.pagination.maxTake = 50;
    contract.resources.sales.pagination.maxTake = 200;
    expect(resolveTake(resolvePagination(contract, 'entries'), 500)).toBe(50);
    expect(resolveTake(resolvePagination(contract, 'sales'), 500)).toBe(200);
  });
});

describe('§20 fake server honra o dialeto do contrato (0 duplicados, 0 ausentes)', () => {
  let server;
  const members = Array.from({ length: 7 }, (_, i) => ({ idMember: i + 1, name: `Aluno ${i + 1}`, registerDate: '2026-01-10T10:00:00.000Z' }));

  beforeAll(async () => {
    server = createFakeEvoServer({ datasets: { members, prospects: [], plans: [], memberships: [], entries: [], sales: [], receivables: [] } });
    await server.listen();
  });
  afterAll(async () => { await server.close(); });

  const withServer = (extra = {}) => ({
    connection: { config: labConfig(server.baseUrl) },
    credentials: server.credentials,
    contract: CONTRACT,
    ...extra,
  });

  it('paginação completa: 0 duplicados e 0 registros ausentes', async () => {
    const client = createEvoClient(withServer({ fetchImpl: fetch }));
    const page = await client.fetchAllPages('/members', { resource: 'members', take: 2 });
    const ids = page.items.map((item) => item.idMember);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(page.paginationModel).toBe('takeSkip');
  });

  it('lote final parcial encerra a paginação', async () => {
    const client = createEvoClient(withServer({ fetchImpl: fetch }));
    const page = await client.fetchAllPages('/members', { resource: 'members', take: 5 });
    expect(page.items).toHaveLength(7);
    expect(page.pagesProcessed).toBe(2);
  });

  it('take maior que o conjunto devolve tudo em UMA página', async () => {
    const client = createEvoClient(withServer({ fetchImpl: fetch }));
    const page = await client.fetchAllPages('/members', { resource: 'members', take: 100 });
    expect(page.items).toHaveLength(7);
    expect(page.pagesProcessed).toBe(1);
  });

  it('skip progride (não repete a primeira página)', async () => {
    const mark = server.requests.length;
    const client = createEvoClient(withServer({ fetchImpl: fetch }));
    await client.fetchAllPages('/members', { resource: 'members', take: 3 });
    const skips = server.requests.slice(mark).filter((r) => r.path === '/members').map((r) => r.query.skip);
    expect(skips).toEqual(['0', '3', '6']);
  });

  it('dialeto legado page/size NÃO é aceito pelo provedor (não passa por acidente)', async () => {
    const response = await fetch(`${server.baseUrl}/members?page=2&size=2`, { headers: { Authorization: server.authHeader } });
    const body = await response.json();
    // O provedor ignora page/size: devolve o começo da coleção.
    expect(body.skip).toBe(0);
    expect(body.data[0].idMember).toBe(1);
  });

  it('filtro incremental usa o parâmetro REAL do recurso declarado', async () => {
    const mark = server.requests.length;
    await evo.fetchPage({
      ...withServer({}),
      resource: 'members',
      since: '2026-01-01T00:00:00.000Z',
      fetchImpl: fetch,
    });
    const last = server.requests.slice(mark).filter((r) => r.path === '/members').pop();
    expect(last.query.updateDateStart).toBe('2026-01-01T00:00:00.000Z');
    expect(last.query.updatedSince).toBeUndefined();
  });

  it('`updatedSince` global NÃO existe mais em nenhum recurso do contrato', () => {
    for (const [resource, config] of Object.entries(CONTRACT.resources)) {
      if (config.incrementalParam === 'updatedSince') throw new Error(`${resource} ainda usa updatedSince`);
      expect(config.incremental.strategy).toBeTruthy();
      expect(CONTRACT._incrementalStrategies[config.incremental.strategy]).toBeDefined();
    }
  });

  it('entradas usam filtro por data de registro (registro, não updatedSince)', () => {
    expect(CONTRACT.resources.entries.incremental.strategy).toBe('REGISTER_DATE_RANGE');
    expect(CONTRACT.resources.entries.incrementalParam).toBe('registerDateStart');
  });

  it('recebíveis usam filtro por data de recebimento', () => {
    expect(CONTRACT.resources.receivables.incremental.strategy).toBe('RECEIVING_DATE_RANGE');
    expect(CONTRACT.resources.receivables.incrementalParam).toBe('receivingDateStart');
  });

  it('buildIncrementalQuery devolve o vazio para FULL_SCAN declarado e o filtro certo nos demais', () => {
    expect(evo.buildIncrementalQuery({ contract: CONTRACT, resource: 'members', since: '2026-01-01T00:00:00.000Z' }))
      .toEqual({ updateDateStart: '2026-01-01T00:00:00.000Z' });
    expect(evo.buildIncrementalQuery({ contract: CONTRACT, resource: 'entries', since: null })).toEqual({});
  });
});

// ── §16/§17/§26 MEMBERSHIP vs MEMBERMEMBERSHIP ────────────────────────────

describe('§16 Membership (catálogo) ≠ MemberMembership (contrato do aluno)', () => {
  it('os dois recursos são entidades DECLARADAS distintas no contrato', () => {
    expect(CONTRACT.resources.plans.evoEntity).toBe('Membership');
    expect(CONTRACT.resources.memberships.evoEntity).toBe('MemberMembership');
    expect(CONTRACT.resources.plans.path).not.toBe(CONTRACT.resources.memberships.path);
    expect(CONTRACT.resources.memberships.mustNotBeConfusedWith).toMatch(/plans/);
  });

  it('o catálogo NUNCA é o alvo de AccessMembership', () => {
    expect(CONTRACT.resources.plans.rapTarget).toMatch(/catálogo|projection|reference/i);
    expect(CONTRACT.resources.plans.rapTarget).toMatch(/NUNCA vira AccessMembership/i);
    expect(CONTRACT.resources.memberships.rapTarget).toBe('AccessMembership');
  });

  it('os mapeadores são distintos e não compartilham implementação', () => {
    expect(typeof MAPPERS.plans.map).toBe('function');
    expect(typeof MAPPERS.memberships.map).toBe('function');
    expect(MAPPERS.plans.map).not.toBe(MAPPERS.memberships.map);
  });

  it('o DTO do catálogo não expõe campos de contrato do aluno (datas/status de matrícula)', () => {
    const planDto = normalizeResourceRecord('plans', { id: 9, name: 'Gold', amount: 199.9 }, CONTRACT);
    for (const field of ['memberExternalId', 'startAt', 'endAt', 'dueDate', 'renewalAt', 'billingStatus']) {
      expect(planDto).not.toHaveProperty(field);
    }
  });

  it('o DTO de matrícula EXIGE memberExternalId (contrato pertence a um aluno)', () => {
    expect(() => normalizeResourceRecord('memberships', { id: 1, planName: 'Gold' }, CONTRACT))
      .toThrow(/obrigat/i);
  });

  it('a mesma pessoa não é duplicada: matrícula referencia o aluno por external id', () => {
    const dto = normalizeResourceRecord('memberships', { id: 1, idMember: 77, planName: 'Gold' }, CONTRACT);
    expect(dto.memberExternalId).toBe('77');
    expect(dto.externalId).toBe('1');
  });
});

// ── §23/§24 SALES vs RECEIVABLES ──────────────────────────────────────────

describe('§23/§24 Sale e Receivable não são a mesma entidade', () => {
  it('o contrato separa as duas entidades e seus filtros', () => {
    expect(CONTRACT.resources.sales.evoEntity).toBe('Sale');
    expect(CONTRACT.resources.receivables.evoEntity).toBe('Receivable');
    expect(CONTRACT.resources.sales.incrementalParam).not.toBe(CONTRACT.resources.receivables.incrementalParam);
  });

  it('o DTO de recebível preserva o vínculo com a venda de origem', () => {
    const dto = normalizeResourceRecord('receivables', { id: 5, idSale: 3, idMember: 1, amount: 10 }, CONTRACT);
    expect(dto.saleExternalId).toBe('3');
    expect(dto.externalId).toBe('5');
  });
});

// ── §29/§30/§31 WEBHOOK ───────────────────────────────────────────────────

describe('§29/§31 webhook: segredo do RAP, fail-closed e dedup de replay', () => {
  const secret = crypto.randomBytes(32).toString('base64url');

  it('o contrato NÃO afirma que o esquema HMAC é do provedor', () => {
    expect(CONTRACT.webhook.providerDocumented).toBe(false);
    expect(CONTRACT.webhook.model).toBe('RAP_DEFINED_CUSTOM_HEADER');
    expect(CONTRACT.webhook.verificationStatus).toBe('UNVERIFIED');
    expect(CONTRACT.webhook.providerCapabilityRequired).toBe('custom_header_on_webhook_creation');
  });

  it('o segredo gerado é forte (256 bits) e o cabeçalho é configurável', () => {
    const generated = evo.generateWebhookSecret();
    expect(Buffer.from(generated, 'base64url')).toHaveLength(32);
    expect(new Set(Array.from({ length: 20 }, () => evo.generateWebhookSecret())).size).toBe(20);
    expect(CONTRACT.webhook.signatureHeaderConfigurable).toBe(true);
  });

  it('aceita o valor do cabeçalho customizado e rejeita valor diferente', () => {
    const connection = { config: { webhookSecret: secret, webhookHeader: 'x-rap-signature' } };
    expect(evo.verifyWebhookSignature({ connection, headers: { 'x-rap-signature': secret } }))
      .toEqual({ ok: true, mode: 'SHARED_SECRET_HEADER' });
    expect(evo.verifyWebhookSignature({ connection, headers: { 'x-rap-signature': `${secret}x` } }).ok).toBe(false);
    expect(evo.verifyWebhookSignature({ connection, headers: { 'x-rap-signature': secret.slice(0, -1) } }).ok).toBe(false);
  });

  it('FAIL-CLOSED: sem segredo configurado nada é aceito', () => {
    const result = evo.verifyWebhookSignature({
      connection: { config: {} }, headers: { 'x-evo-signature': 'qualquer' }, rawBody: '{}',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('webhook_secret_not_configured');
  });

  it('header ausente é rejeitado mesmo com segredo configurado', () => {
    const result = evo.verifyWebhookSignature({ connection: { config: { webhookSecret: secret } }, headers: {}, rawBody: '{}' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_header_missing');
  });

  it('NÃO presume HMAC: o mesmo valor assinado por HMAC falha no modo padrão', () => {
    const rawBody = '{"event":"entry.created"}';
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(evo.verifyWebhookSignature({
      connection: { config: { webhookSecret: secret } }, headers: { 'x-evo-signature': hmac }, rawBody,
    }).ok).toBe(false);
  });

  it('replay do mesmo evento produz a MESMA chave de deduplicação', () => {
    const normalized = {
      eventType: 'entry.created', externalEventId: null, resourceType: 'entries', externalResourceId: '554423', payload: { idEntry: 554423 },
    };
    const now = new Date('2026-09-11T12:00:00.000Z');
    const a = evo.computeWebhookReplayKey({ connectionId: 'c1', normalized, policy: CONTRACT.webhook.replayProtection, now });
    const b = evo.computeWebhookReplayKey({ connectionId: 'c1', normalized, policy: CONTRACT.webhook.replayProtection, now });
    expect(a.key).toBe(b.key);
    expect(a.strongEventIdAvailable).toBe(false);
  });

  it('a chave de replay é ESCOPADA por conexão (payload nunca escolhe tenant)', () => {
    const normalized = { eventType: 'entry.created', payload: { idEntry: 1 } };
    const now = new Date('2026-09-11T12:00:00.000Z');
    const a = evo.computeWebhookReplayKey({ connectionId: 'c1', normalized, policy: CONTRACT.webhook.replayProtection, now });
    const b = evo.computeWebhookReplayKey({ connectionId: 'c2', normalized, policy: CONTRACT.webhook.replayProtection, now });
    expect(a.key).not.toBe(b.key);
  });

  it('eventos materialmente diferentes NÃO colapsam na mesma chave', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    const a = evo.computeWebhookReplayKey({
      connectionId: 'c1', policy: CONTRACT.webhook.replayProtection, now, normalized: { eventType: 'entry.created', payload: { idEntry: 1 } },
    });
    const b = evo.computeWebhookReplayKey({
      connectionId: 'c1', policy: CONTRACT.webhook.replayProtection, now, normalized: { eventType: 'entry.created', payload: { idEntry: 2 } },
    });
    expect(a.key).not.toBe(b.key);
  });

  it('o segredo do webhook nunca aparece em log de diagnóstico', () => {
    const logs = [];
    const logger = { warn: (...args) => logs.push(JSON.stringify(args)), error: (...args) => logs.push(JSON.stringify(args)) };
    evo.verifyWebhookSignature({ connection: { config: { webhookSecret: secret } }, headers: {}, rawBody: '{}', logger });
    expect(logs.join('\n')).not.toContain(secret);
  });
});

// ── §36/§40/§42 ESTADOS DE CERTIFICAÇÃO ───────────────────────────────────

describe('§36/§40 estados de contrato separados (local PASS ≠ live certified)', () => {
  it('capabilities publica cada estado separadamente', () => {
    const caps = evo.capabilities();
    expect(caps.contractStates).toEqual({
      OFFICIAL_DOCS_VERIFIED: false,
      LOCAL_CONTRACT_TESTED: true,
      AWAITING_LIVE_CERTIFICATION: true,
      LIVE_CERTIFIED: false,
    });
  });

  it('o contrato não pode reivindicar LIVE VERIFIED enquanto UNVERIFIED', () => {
    expect(CONTRACT._certification.status).toBe('UNVERIFIED');
    expect(CONTRACT._certification.mustNotClaim).toBe('LIVE VERIFIED');
    expect(`${CONTRACT._certification.honestLabel}`.toUpperCase()).not.toContain('LIVE VERIFIED');
    expect(CONTRACT._officialDocsConsultation.verifiedAgainst).toEqual([]);
  });

  it('a taxonomia declara os quatro estados e proíbe colapsá-los', () => {
    expect(CONTRACT._contractStates.states).toEqual(
      expect.arrayContaining(['OFFICIAL_DOCS_VERIFIED', 'LOCAL_CONTRACT_TESTED', 'AWAITING_LIVE_CERTIFICATION', 'LIVE_CERTIFIED']),
    );
    expect(CONTRACT._contractStates._mustNotBeCollapsed).toMatch(/NUNCA autoriza/i);
  });

  it('o fake server é declaradamente NÃO prova de integração live', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'tests/helpers/fakeEvoServer.js'), 'utf8');
    expect(source).toMatch(/NÃO é prova de integração live/i);
    expect(source).toMatch(/NÃO pode conter endpoint inventado/i);
  });

  it('o contrato é a única fonte de endpoints: o adapter não tem path hardcoded', () => {
    const adapterSource = fs.readFileSync(
      path.join(REPO_ROOT, 'api/services/integration/providers/evo/evoProviderAdapter.js'), 'utf8',
    );
    for (const resource of Object.values(CONTRACT.resources)) {
      expect(adapterSource).not.toContain(`'${resource.path}'`);
    }
  });
});
