'use strict';

/**
 * M9/M10/M12/M15/M16/M17/M18 — DESCOBERTA, TESTE e CADEIA COMPLETA reais.
 *
 * Por que este arquivo existe: os testes anteriores do Control Plane usavam
 * dublês de model/serviço e NÃO existia nenhum teste que exercitasse
 * `mcpDiscoveryService` — exatamente o módulo que substituiu dois comportamentos
 * mentirosos:
 *
 *   - `POST discover` aceitava `body.tools`: o inventário vinha do CLIENTE. Não
 *     era descoberta, era digitação — a capability existia no banco porque
 *     alguém a declarou, não porque o servidor remoto a oferece;
 *   - `POST test` devolvia um 502 fixo ("nenhum servidor configurado"), que não
 *     distingue endpoint morto de auth inválida de TLS.
 *
 * Aqui o caminho é o REAL de ponta a ponta:
 *
 *   Postgres (model + serviço reais)
 *     → política de endpoint (SSRF/TLS) → credencial por referência
 *     → `connect` + `tools/list` REAIS (servidor MCP fixture, SDK oficial)
 *     → validação do inventário → fingerprint → persistência
 *     → adapter → Canonical Tool Registry → execução da tool
 *
 * O único elemento substituído é o TRANSPORTE (socket): em vez de abrir TCP
 * contra a internet, usa `InMemoryTransport` do SDK. O protocolo é o de verdade,
 * os handlers são de verdade e a contagem de chamadas é real. Isso é permitido
 * pela missão (fixture em `tests/`), e nunca vira caminho de produção — o gate
 * `no_fake_mcp_in_production` proíbe fallback fake em código de runtime.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO e reportado (nunca verde silencioso).
 */

const http = require('http');
const express = require('express');

const {
  DB_SKIP_REASON,
  tryConnectDatabase,
  closeDatabase,
  uniqueTenantKey,
  purgeTenants,
} = require('./helpers/realDatabase');
const {
  createFakeMcpServer,
  createFixtureTransportFactory,
  createFailingTransportFactory,
} = require('./fixtures/fakeMcpServer');

const modelModule = require('../../../api/db/models/McpConnection');
const service = require('../../../api/services/mcp/mcpConnectionService');
const discovery = require('../../../api/services/mcp/mcpDiscoveryService');
const { getExternalEcosystemStatus, MCP_EXTERNAL_ECOSYSTEM } = require('../../../api/services/mcp/mcpEcosystemStatus');
const { loadConnectionsFromPersistence } = require('../../../api/runtime/startMcpClient');
const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const {
  registerExternalMcpTools,
  externalMcpTenantToken,
} = require('../../../src/core/mcp/external-tool-adapter');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { ensureAskAiCapabilityTools, executeCapability } = require('../../../api/services/askAi/canonicalToolBridge');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** Endpoint PÚBLICO: passa a política de SSRF sem exigir rede real (transporte injetado). */
const PUBLIC_ENDPOINT = 'https://mcp.externo.exemplo.com/rpc';
const TOOL = 'crm.lookupCustomer';

const REMOTE_TOOLS = [
  {
    name: TOOL,
    description: 'Consulta cadastro do cliente no ERP externo.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true },
  },
];

let dbAvailable = false;
let dbReason = null;
const tenants = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[mcp-discovery-real] PULADO: ${DB_SKIP_REASON} (${dbReason})`);
  return true;
}

/** Conexão persistida com escopo e mapeamento — o runtime só conhece CAPABILITY. */
function connectionInput(overrides = {}) {
  return {
    name: 'erp',
    endpoint: PUBLIC_ENDPOINT,
    transport: 'http',
    authType: 'bearer',
    credentialRef: 'MCP_FIXTURE_TOKEN',
    enabled: true,
    classificationCeiling: 'PRODUCTION',
    allowedCapabilities: ['crm.read'],
    allowedTools: [TOOL],
    toolCapabilityMap: { [TOOL]: 'crm.read' },
    toolPolicies: {
      [TOOL]: {
        sideEffects: false,
        riskLevel: 'low',
        confirmationPolicy: 'autonomous',
        idempotencyPolicy: 'none',
      },
    },
    endpointPolicy: { allowPrivateNetwork: false },
    quota: { tenant: 100, connection: 50, tool: 10 },
    timeoutMs: 15000,
    retryPolicy: { attempts: 2 },
    ...overrides,
  };
}

/** Deps de teste: transporte fixture + credencial resolvida por referência. */
function fixtureDeps({ server, onAuthHeaders = null } = {}) {
  return {
    transportFactory: createFixtureTransportFactory({ server, onAuthHeaders }),
    credentialResolver: () => 'fixture-secret-token',
  };
}

async function createStoredConnection({ tenantId, input = connectionInput() } = {}) {
  const created = await service.createConnection({ tenantId, input });
  return created;
}

describe('M9/M10/M12/M15–M18 — descoberta real contra servidor MCP no protocolo', () => {
  beforeAll(async () => {
    const result = await tryConnectDatabase();
    dbAvailable = result.available;
    dbReason = result.reason;
  });

  afterAll(async () => {
    try {
      if (dbAvailable) await purgeTenants(tenants);
    } finally {
      await closeDatabase();
    }
  });

  // ── M9: o inventário vem do SERVIDOR ─────────────────────────────────────
  describe('M9 — descoberta REAL via tools/list', () => {
    it('persiste o inventário do servidor remoto, não o do cliente', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-disc-real');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const { server, state } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(true);
      expect(result.inventorySource).toBe('remote_tools_list');
      // Prova que houve ida ao SERVIDOR (não leitura do corpo da requisição).
      expect(state.listCalls).toBe(1);
      expect(result.tools.map((t) => t.name)).toEqual([TOOL]);
      // Capability resolvida pelo MAPEAMENTO PERSISTIDO — o remoto nunca
      // declara capability canônica por conta própria.
      expect(result.tools[0].capability).toBe('crm.read');
      expect(result.negotiation).toMatchObject({
        declared: ['crm.read'],
        observed: ['crm.read'],
        unmappedTools: [],
        missingCapabilities: [],
      });

      // Persistido no banco (não só na resposta HTTP).
      const stored = await service.getConnection({ tenantId, id: created.id });
      // O inventário persistido carrega o fingerprint de schema POR TOOL
      // (SHA-256 real do contrato remoto) — é ele que detecta mudança depois.
      expect(stored.discovered_tools).toHaveLength(1);
      expect(stored.discovered_tools[0]).toMatchObject({ name: TOOL, capability: 'crm.read' });
      expect(stored.discovered_tools[0].schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.schema_fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.last_discovery_at).toBeTruthy();
      expect(stored.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(stored.consecutive_failures).toBe(0);
    });

    it('tool remota SEM mapeamento é reportada como não mapeada (não inventa semântica)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-unmapped-real');
      tenants.push(tenantId);
      const created = await createStoredConnection({
        tenantId,
        // Duas capabilities declaradas ⇒ `resolveCapability` não pode escolher a
        // primeira "no chute"; sem mapeamento explícito, a tool fica sem capability.
        input: connectionInput({
          allowedCapabilities: ['crm.read', 'billing.read'],
          allowedTools: [],
          toolCapabilityMap: {},
        }),
      });

      const { server } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(true);
      expect(result.tools[0].capability).toBeNull();
      expect(result.negotiation.unmappedTools).toEqual([TOOL]);
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.discovered_tools).toHaveLength(1);
      expect(stored.discovered_tools[0]).toMatchObject({ name: TOOL, capability: null });
    });

    it('inventário inválido do remoto é RECUSADO e não é persistido', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-invalid-inv');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      // Protocolo violado (o schema do SDK não pega): a MESMA tool dois vezes.
      // Persistir isso tornaria o inventário impossível de endereçar.
      const { server } = createFakeMcpServer({ tools: [REMOTE_TOOLS[0], REMOTE_TOOLS[0]] });
      const result = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_TOOL_INVENTORY_INVALID');
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.discovered_tools).toEqual([]);
      expect(stored.schema_fingerprint).toBeNull();
    });

    it('sem endpoint real o resultado é MCP_ENDPOINT_NOT_CONFIGURED — nunca sucesso', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-no-endpoint');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });
      // Linha LEGADA (escrita fora do control plane): o serviço exige endpoint
      // http(s) na escrita, então o único caminho para este estado é uma linha
      // anterior à validação — exatamente o que o runtime pode encontrar.
      await modelModule().update({ endpoint: '' }, { where: { id: created.id } });

      const { server } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_ENDPOINT_NOT_CONFIGURED');
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.schema_fingerprint).toBeNull();
      // A falha é REGISTRADA como saúde negativa — diagnóstico não é silêncio.
      expect(stored.last_error).toMatch(/MCP_ENDPOINT_NOT_CONFIGURED/);
    });

    it('endpoint proibido pela política (loopback) é bloqueado ANTES da rede', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-ssrf');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });
      await modelModule().update({ endpoint: 'https://127.0.0.1:9/rpc' }, { where: { id: created.id } });

      const { server, state } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_ENDPOINT_BLOCKED');
      // Nenhuma conexão foi aberta: a política age antes do transporte.
      expect(state.listCalls).toBe(0);
    });

    it('credencial não resolvida é falha EXPLÍCITA (nunca conexão anônima)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-no-cred');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const { server } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.discoverConnectionTools({
        tenantId,
        id: created.id,
        deps: { transportFactory: createFixtureTransportFactory({ server }), credentialResolver: () => null },
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_AUTH_UNAVAILABLE');
    });
  });

  // ── M10: /test é diagnóstico de verdade ──────────────────────────────────
  describe('M10 — teste de conexão REAL (endpoint + auth + MCP + negociação)', () => {
    it('conecta, negocia capabilities e autentica com o header REAL', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-probe');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const { server, state } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      let authHeaders = null;
      const result = await discovery.probeConnection({
        tenantId,
        id: created.id,
        deps: fixtureDeps({ server, onAuthHeaders: (h) => { authHeaders = h; } }),
      });

      expect(result.ok).toBe(true);
      expect(result.toolCount).toBe(1);
      expect(result.negotiation.observed).toEqual(['crm.read']);
      expect(result.serverVersion).toMatchObject({ name: 'fixture-external-mcp' });
      expect(typeof result.latencyMs).toBe('number');
      // A autenticação foi REALMENTE montada a partir de `credentialRef`.
      expect(authHeaders).toMatchObject({ Authorization: 'Bearer fixture-secret-token' });
      expect(state.listCalls).toBe(1);

      // Saúde persistida como sucesso.
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(stored.last_success_at).toBeTruthy();
      expect(stored.last_error).toBeNull();
    });

    it('falha de transporte NÃO vira sucesso: código explícito + saúde degradada', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-probe-fail');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const result = await discovery.probeConnection({
        tenantId,
        id: created.id,
        deps: {
          transportFactory: createFailingTransportFactory(),
          credentialResolver: () => 'fixture-secret-token',
        },
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_DISCOVERY_FAILED');
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.last_failure_at).toBeTruthy();
      expect(stored.last_error).toMatch(/ECONNREFUSED/);
      expect(stored.consecutive_failures).toBeGreaterThanOrEqual(1);
    });

    it('conexão desabilitada não é sondada por padrão, mas o diagnóstico explícito pode', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-probe-disabled');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });
      await service.setEnabled({ tenantId, id: created.id, enabled: false });

      const { server } = createFakeMcpServer({ tools: REMOTE_TOOLS });

      const blocked = await discovery.probeConnection({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.code).toBe('MCP_CONNECTION_DISABLED');

      // A rota `/test` passa `allowDisabledProbe`: diagnosticar antes de habilitar.
      const probed = await discovery.probeConnection({
        tenantId, id: created.id, deps: fixtureDeps({ server }), allowDisabledProbe: true,
      });
      expect(probed.ok).toBe(true);
      expect(probed.connectionEnabled).toBe(false);
      // Testar NÃO habilita a conexão.
      const stored = await service.getConnection({ tenantId, id: created.id });
      expect(stored.enabled).toBe(false);
      expect(stored.status).toBe(service.LIFECYCLE_STATES.DISABLED);
    });

    it('conexão inexistente devolve NOT_FOUND (sem vazar existência de outro tenant)', async () => {
      if (skipIfNoDatabase()) return;
      const error = await discovery.probeConnection({ tenantId: 'tenant-que-nao-existe', id: 'mcpc-x' })
        .then(() => null, (e) => e);
      expect(error).not.toBeNull();
      expect(error.code).toBe('mcp_connection_not_found');
    });
  });

  // ── M12: mudança de schema exige revalidação explícita ───────────────────
  describe('M12 — schema novo NUNCA é promovido sozinho', () => {
    it('inventário diferente vira SCHEMA_CHANGED e só revalidação explícita promove', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-schema-real');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      // 1ª descoberta: inventário A.
      const first = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const v1 = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server: first.server }),
      });
      expect(v1.ok).toBe(true);
      expect(v1.schemaChanged).toBe(false);
      const fingerprintV1 = v1.schemaFingerprint;
      expect(fingerprintV1).toMatch(/^[a-f0-9]{64}$/);

      // O remoto muda o contrato (novo campo obrigatório).
      const changed = [{
        ...REMOTE_TOOLS[0],
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, tenantScoped: { type: 'boolean' } },
          required: ['query', 'tenantScoped'],
          additionalProperties: false,
        },
      }];
      const second = createFakeMcpServer({ tools: changed });
      const v2 = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server: second.server }),
      });

      expect(v2.ok).toBe(true);
      expect(v2.schemaChanged).toBe(true);
      expect(v2.revalidationRequired).toBe(true);
      // §M12 — o contrato em VIGOR continua sendo o antigo: o contrato novo é
      // apenas OBSERVADO (auditável), nunca promovido automaticamente.
      expect(v2.schemaFingerprint).toBe(fingerprintV1);
      expect(v2.observedSchemaFingerprint).not.toBe(fingerprintV1);

      const pending = await service.getConnection({ tenantId, id: created.id });
      expect(pending.status).toBe(service.LIFECYCLE_STATES.SCHEMA_CHANGED);
      expect(pending.schema_fingerprint).toBe(fingerprintV1);
      expect(pending.metadata.revalidationRequired).toBe(true);
      expect(pending.metadata.pendingSchemaFingerprint).toBe(v2.observedSchemaFingerprint);
      expect(pending.schema_revalidated_at).toBeFalsy();

      // Repetir a descoberta NÃO promove nada: `schemaChanged` continua sendo
      // reportado contra o contrato ACEITO (a divergência persiste até alguém
      // decidir), e o contrato em vigor segue o antigo.
      const sameAgain = createFakeMcpServer({ tools: changed });
      const third = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server: sameAgain.server }),
      });
      expect(third.ok).toBe(true);
      expect(third.schemaChanged).toBe(true);
      expect(third.revalidationRequired).toBe(true);
      expect(third.schemaFingerprint).toBe(fingerprintV1);
      const stillPending = await service.getConnection({ tenantId, id: created.id });
      expect(stillPending.status).toBe(service.LIFECYCLE_STATES.SCHEMA_CHANGED);
      expect(stillPending.schema_fingerprint).toBe(fingerprintV1);
      expect(stillPending.schema_revalidated_at).toBeFalsy();

      // Revalidação EXPLÍCITA aceita o novo contrato.
      const accept = createFakeMcpServer({ tools: changed });
      const revalidated = await discovery.revalidateConnection({
        tenantId, id: created.id, deps: fixtureDeps({ server: accept.server }),
      });
      expect(revalidated.ok).toBe(true);
      expect(revalidated.mode).toBe('revalidate');
      expect(revalidated.connection.revalidated).toBe(true);
      expect(revalidated.connection.fingerprintChanged).toBe(true);

      const promoted = await service.getConnection({ tenantId, id: created.id });
      expect(promoted.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(promoted.schema_revalidated_at).toBeTruthy();
      expect(promoted.metadata.revalidationRequired).toBe(false);
      expect(promoted.schema_fingerprint).toBe(revalidated.schemaFingerprint);
    });

    it('revalidate sem mudança pendente responde MCP_REVALIDATION_NOT_REQUIRED', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-reval-noop');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const { server, state } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const result = await discovery.revalidateConnection({
        tenantId, id: created.id, deps: fixtureDeps({ server }),
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('MCP_REVALIDATION_NOT_REQUIRED');
      // Nem toca o servidor remoto: não há contrato novo para aceitar.
      expect(state.listCalls).toBe(0);
    });
  });

  // ── M18: estado do ecossistema externo, com honestidade ──────────────────
  describe('M18 — ecossistema externo reportado com honestidade', () => {
    it('tenant sem conexão habilitada é NOT_CONFIGURED (nunca LIVE)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-eco-empty');
      tenants.push(tenantId);

      const status = await getExternalEcosystemStatus({ tenantId });
      expect(status.status).toBe(MCP_EXTERNAL_ECOSYSTEM.NOT_CONFIGURED);
      expect(status.live).toBe(false);
      expect(status.evidence.enabledConnections).toBe(0);
    });

    it('conexão habilitada sem descoberta real é CONFIGURED_UNVERIFIED; a descoberta REAL vira LIVE', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-eco-live');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      const before = await getExternalEcosystemStatus({ tenantId });
      expect(before.status).toBe(MCP_EXTERNAL_ECOSYSTEM.CONFIGURED_UNVERIFIED);
      expect(before.live).toBe(false);

      // Um probe bem-sucedido prova conectividade, mas NÃO é descoberta
      // persistida: sem inventário/fingerprint o runtime não tem tool nenhuma
      // para consumir, então declarar LIVE seria mentira.
      const probedServer = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const probed = await discovery.probeConnection({
        tenantId, id: created.id, deps: fixtureDeps({ server: probedServer.server }),
      });
      expect(probed.ok).toBe(true);
      const afterProbe = await getExternalEcosystemStatus({ tenantId });
      expect(afterProbe.status).toBe(MCP_EXTERNAL_ECOSYSTEM.CONFIGURED_UNVERIFIED);

      // Descoberta REAL persistida (inventário + fingerprint) ⇒ LIVE.
      const discoveredServer = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const discovered = await discovery.discoverConnectionTools({
        tenantId, id: created.id, deps: fixtureDeps({ server: discoveredServer.server }),
      });
      expect(discovered.ok).toBe(true);

      const after = await getExternalEcosystemStatus({ tenantId });
      // LIVE exige EVIDÊNCIA (descoberta real + saúde), não declaração.
      expect(after.status).toBe(MCP_EXTERNAL_ECOSYSTEM.LIVE);
      expect(after.evidence.verifiedConnections).toBe(1);
      expect(after.connections[0]).toMatchObject({
        id: created.id,
        verified: true,
        discoveredToolCount: 1,
        mappingVersion: '1',
      });
    });
  });

  // ── M16/M17: cadeia completa até a EXECUÇÃO ──────────────────────────────
  describe('M16/M17 — persistido → reinício → descoberta → registry canônico → chamada MCP', () => {
    it('a conexão persistida sobrevive ao reinício, é descoberta e a tool é executada de verdade', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-chain');
      tenants.push(tenantId);
      const created = await createStoredConnection({ tenantId });

      // ── Reinício: registry de módulos ISOLADO (nenhum singleton em cache) ──
      let loaded = null;
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line global-require
        const freshSequelize = require('../../../api/db/sequelize');
        await freshSequelize.connect(2, 250);
        try {
          // eslint-disable-next-line global-require
          const freshRuntime = require('../../../api/runtime/startMcpClient');
          loaded = await freshRuntime.loadConnectionsFromPersistence();
        } finally {
          await freshSequelize.close();
        }
      });

      expect(loaded.source).toBe('control-plane');
      const restored = loaded.connections.filter((c) => c.connectionId === created.id);
      expect(restored).toHaveLength(1);
      // A config OPERACIONAL sobreviveu (política declarada por tool inclusive).
      expect(restored[0].toolPolicies[TOOL]).toMatchObject({ confirmationPolicy: 'autonomous' });
      expect(restored[0].toolCapabilityMap).toEqual({ [TOOL]: 'crm.read' });

      // ── Descoberta + registro no Canonical Tool Registry ──────────────────
      const { server, state } = createFakeMcpServer({
        tools: REMOTE_TOOLS,
        callTool: async (request) => ({
          content: [{ type: 'text', text: `cliente:${request.params.arguments?.query || '-'}` }],
        }),
      });
      const hub = createMcpClientHub({
        connections: restored,
        logger: silent,
        transportFactory: createFixtureTransportFactory({ server }),
        credentialResolver: () => 'fixture-secret-token',
      });

      const registry = createToolRegistry({ logger: silent });
      const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
      expect(registration.skipped).toEqual([]);
      expect(registration.registered).toHaveLength(1);

      const toolId = registration.registered[0];
      const canonical = registry.get(toolId);
      // A política DECLARADA na conexão chegou ao registry (não heurística por nome).
      expect(canonical).toMatchObject({
        capability: 'crm.read',
        sideEffects: false,
        confirmationPolicy: 'autonomous',
        metadata: expect.objectContaining({ source: 'external_mcp', descriptionTrusted: false }),
      });

      // ── Execução REAL pelo registry (proxy → hub → servidor MCP) ──────────
      const execution = await registry.execute(toolId, { query: 'ana' }, {
        tenantId,
        actor: { principalId: 'u-1', permissions: ['*'] },
        confirmed: false,
      });

      expect(state.callCalls).toBe(1);
      expect(execution.output).toMatchObject({ remote: 'erp', tool: TOOL });
      expect(execution.output.text).toBe('cliente:ana');
    });

    it('a MESMA capability canônica resolve para provider NATIVO (tenant A) e EXTERNO (tenant B)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantA = uniqueTenantKey('mcp-conv-a');
      const tenantB = uniqueTenantKey('mcp-conv-b');
      tenants.push(tenantA, tenantB);
      const created = await createStoredConnection({ tenantId: tenantB });

      const { server, state } = createFakeMcpServer({
        tools: REMOTE_TOOLS,
        callTool: async () => ({ content: [{ type: 'text', text: 'origem:mcp' }] }),
      });

      const loaded = await service.listAllEnabledConnections();
      const connectionB = loaded.filter((row) => row.tenant_key === tenantB).map((row) => service.toConnectionConfig(row));
      const hub = createMcpClientHub({
        connections: connectionB,
        logger: silent,
        transportFactory: createFixtureTransportFactory({ server }),
        credentialResolver: () => 'fixture-secret-token',
      });

      // Mesmo registry: catálogo nativo do copiloto + provider externo real.
      const registry = createToolRegistry({ logger: silent });
      const runners = {
        fitnessStudentSummary: async () => ({ toolId: 'askai.fitness.membershipSummary', found: true, facts: [], summary: 'nativo' }),
        fitnessAttendanceSummary: async () => ({ toolId: 'askai.fitness.attendanceSummary', found: true, facts: [], summary: 'nativo' }),
        fitnessBillingSummary: async () => ({ toolId: 'askai.billing.membershipHistory', found: true, facts: [], summary: 'nativo' }),
        fitnessChurnSignal: async () => ({ toolId: 'askai.churn.latestSignal', found: true, facts: [], summary: 'nativo' }),
      };
      ensureAskAiCapabilityTools(registry, runners);
      const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
      expect(registration.registered).toHaveLength(1);

      const entity = { type: 'FITNESS_STUDENT', id: 'aluno-1' };
      const tenantTokenB = externalMcpTenantToken(tenantB);

      // Tenant A: só enxerga o provider NATIVO da capability `crm.read`.
      const resultA = await executeCapability({
        registry,
        capability: 'crm.read',
        entityType: 'FITNESS_STUDENT',
        tenantId: tenantA,
        actor: { id: 'a-1', permissions: ['crm.read'] },
        entity,
      });
      expect(resultA.provider).toBe('native');
      expect(resultA.toolId).toBe('askai.fitness.membershipSummary');
      expect(resultA.reason).toBe('native_preferred');
      expect(state.callCalls).toBe(0);

      // Tenant B: a permissão é a da CONEXÃO dele (escopada por token de tenant).
      const resultB = await executeCapability({
        registry,
        capability: 'crm.read',
        entityType: 'FITNESS_STUDENT',
        tenantId: tenantB,
        actor: { id: 'b-1', permissions: [`mcp.t${tenantTokenB}.erp`] },
        entity,
      });
      expect(resultB.provider).toBe('external');
      expect(resultB.toolId).toBe(registration.registered[0]);
      expect(state.callCalls).toBe(1);

      // O provider externo NÃO é um universo paralelo: é o mesmo registry, a
      // mesma capability canônica, resolvida por PERMISSÃO.
      expect(registry.list({ permissions: ['crm.read'] }).map((t) => t.id)).toContain('askai.fitness.membershipSummary');
      expect(registry.list({ permissions: [`mcp.t${tenantTokenB}.erp`] }).map((t) => t.id)).toEqual([registration.registered[0]]);

      // Cross-tenant: a tool do tenant B nunca resolve para o tenant A.
      const crossTenant = await executeCapability({
        registry,
        capability: 'crm.read',
        entityType: 'FITNESS_STUDENT',
        tenantId: tenantA,
        actor: { id: 'a-1', permissions: [`mcp.t${tenantTokenB}.erp`] },
        entity,
      }).then(() => null, (error) => error);
      // Tenant A não tem provider externo registrado: a permissão existe, mas a
      // chamada falha ao validar o tenant da conexão (fail closed).
      expect(crossTenant).not.toBeNull();
      expect(String(crossTenant.message)).toMatch(/mcp_connection_tenant_mismatch|cognitive_tool/);
    });
  });

  // ── M13: a superfície HTTP REAL funciona ponta a ponta ───────────────────
  describe('M13 — rotas de administração reais (HTTP → serviço → banco → MCP)', () => {
    it('create → discover → health → ecosystem → test funcionam pelo caminho HTTP', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-http');
      tenants.push(tenantId);

      // Só a AUTENTICAÇÃO é substituída (não há sessão real neste teste); o
      // resto é o caminho de produção: rotas reais, serviço real, banco real.
      const { createMcpRoutes } = require('../../../api/modules/mcp/routes');
      const {
        sendJson, badRequest, hasJsonContentType, parseJsonBody,
      } = require('../../../api/express/httpHelpers');

      const { server: mcpServer, state: mcpState } = createFakeMcpServer({ tools: REMOTE_TOOLS });
      const deps = {
        requireAuth: (req) => {
          req.agent = { username: 'eng', platformClassification: 'DEVELOPMENT' };
          return { username: 'eng' };
        },
        sendJson,
        badRequest,
        hasJsonContentType,
        parseJsonBody,
        tenantFromRequest: () => tenantId,
        discoveryDeps: fixtureDeps({ server: mcpServer }),
      };

      const app = express();
      app.use(express.json());
      app.use(createMcpRoutes({ buildDeps: () => deps }));
      app.use((req, res) => res.status(404).json({ error: 'route_not_mounted' }));

      const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      try {
        // CREATE: o corpo JSON precisa chegar ao serviço como OBJETO (era uma
        // Promise antes da correção — a rota respondia `name obrigatório`).
        const created = await httpRequest(server, 'POST', '/mcp/connections', connectionInput({ name: 'http-erp' }));
        expect(created.status).toBe(201);
        const connectionId = created.body.connection.id;
        expect(created.body.connection.name).toBe('http-erp');
        expect(created.body.connection.toolPolicies[TOOL]).toMatchObject({ confirmationPolicy: 'autonomous' });

        // DISCOVER: inventário do cliente é RECUSADO no boundary HTTP.
        const rejected = await httpRequest(server, 'POST', `/mcp/connections/${connectionId}/discover`, {
          tools: [{ name: 'tool.inventada' }],
        });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error).toBe('MCP_CLIENT_TOOL_INVENTORY_FORBIDDEN');

        // DISCOVER real: o inventário vem do servidor MCP.
        const discovered = await httpRequest(server, 'POST', `/mcp/connections/${connectionId}/discover`, {});
        expect(discovered.status).toBe(200);
        expect(discovered.body.inventorySource).toBe('remote_tools_list');
        expect(discovered.body.tools.map((t) => t.name)).toEqual([TOOL]);
        expect(mcpState.listCalls).toBe(1);

        // HEALTH: leitura SUPPORT do estado PERSISTIDO (sem ida à rede).
        const health = await httpRequest(server, 'GET', `/mcp/connections/${connectionId}/health`);
        expect(health.status).toBe(200);
        expect(health.body.health).toMatchObject({
          status: 'HEALTHY',
          discoveredToolCount: 1,
          live: false,
        });

        // ECOSYSTEM: SUPPORT e escopado ao tenant autenticado.
        const ecosystem = await httpRequest(server, 'GET', '/mcp/ecosystem');
        expect(ecosystem.status).toBe(200);
        expect(ecosystem.body.status).toBe('LIVE');
        expect(ecosystem.body.tenantScope).toBe(tenantId);

        // TEST: diagnóstico real também pelo HTTP.
        const tested = await httpRequest(server, 'POST', `/mcp/connections/${connectionId}/test`, {});
        expect(tested.status).toBe(200);
        expect(tested.body.ok).toBe(true);

        // REVALIDATE sem mudança pendente: recusado, não é no-op silencioso.
        const revalidate = await httpRequest(server, 'POST', `/mcp/connections/${connectionId}/revalidate`, {});
        expect(revalidate.status).toBe(409);
        expect(revalidate.body.error).toBe('MCP_REVALIDATION_NOT_REQUIRED');

        // DISABLE: estado persistido de verdade.
        const disabled = await httpRequest(server, 'POST', `/mcp/connections/${connectionId}/disable`, {});
        expect(disabled.status).toBe(200);
        expect(disabled.body.connection.enabled).toBe(false);

        const afterDisable = await httpRequest(server, 'GET', '/mcp/ecosystem');
        expect(afterDisable.body.status).toBe('NOT_CONFIGURED');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});

/** Requisição HTTP real contra o servidor Express local do teste. */
function httpRequest(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const timer = setTimeout(() => reject(new Error(`timeout ${method} ${urlPath}`)), 8000);
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: urlPath,
      agent: false,
      headers: {
        Connection: 'close',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) { /* mantém string */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (error) => { clearTimeout(timer); reject(error); });
    if (payload) req.write(payload);
    req.end();
  });
}
