'use strict';

/**
 * M1/M3/M4/M5/M6/M11/M12 — contrato REAL do Control Plane persistente.
 *
 * Diferença em relação a `mcpControlPlane.test.js`: aqui NÃO há dublê do model
 * nem do serviço. O model real (`api/db/models/McpConnection`) e o serviço real
 * falam com o Postgres configurado. Isso é necessário porque o dublê em memória
 * aceitava qualquer formato e escondia exatamente os defeitos de contrato desta
 * missão:
 *
 *   - export da FACTORY do model x `getMcpConnectionModel()` (se o módulo
 *     exportasse uma instância, `require(...)` devolveria um objeto congelado no
 *     boot e a tabela nunca seria resolvida após `connect()`);
 *   - `listConnections()` devolvia a linha CRUA e dropava a config operacional
 *     (`toolPolicies`, `allowedTools`, `toolCapabilityMap`, ...) — por isso a
 *     política declarada por tool nunca chegava ao runtime;
 *   - não havia `listAllEnabledConnections()`: o runtime dependia de
 *     `deps.tenants`, um insumo externo, para saber o que carregar.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO e reportado (nunca verde silencioso).
 */

const crypto = require('crypto');

const {
  DB_SKIP_REASON,
  tryConnectDatabase,
  closeDatabase,
  uniqueTenantKey,
  purgeTenants,
} = require('./helpers/realDatabase');

const modelModule = require('../../../api/db/models/McpConnection');
const service = require('../../../api/services/mcp/mcpConnectionService');
const { loadConnectionsFromPersistence } = require('../../../api/runtime/startMcpClient');
const { getExternalEcosystemStatus, MCP_EXTERNAL_ECOSYSTEM } = require('../../../api/services/mcp/mcpEcosystemStatus');

const ENDPOINT = 'https://mcp.contrato.exemplo.com/rpc';

let dbAvailable = false;
let dbReason = null;
const tenants = [];

/** Pulo honesto: reportado no output, nunca um "verde" silencioso. */
function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[mcp-persistence-contract] PULADO: ${DB_SKIP_REASON} (${dbReason})`);
  return true;
}

function operationalInput(overrides = {}) {
  return {
    name: `provedor-${crypto.randomBytes(3).toString('hex')}`,
    endpoint: ENDPOINT,
    transport: 'http',
    authType: 'bearer',
    credentialRef: 'MCP_CONTRACT_TOKEN',
    enabled: true,
    classificationCeiling: 'PRODUCTION',
    allowedCapabilities: ['crm.read'],
    allowedTools: ['crm.byId'],
    toolCapabilityMap: { 'crm.byId': 'crm.read' },
    toolPolicies: {
      'crm.byId': {
        sideEffects: false,
        riskLevel: 'low',
        confirmationPolicy: 'autonomous',
        idempotencyPolicy: 'none',
      },
    },
    endpointPolicy: { allowPrivateNetwork: false, maxRedirects: 0 },
    quota: { tenant: 100, connection: 50, tool: 10 },
    timeoutMs: 15000,
    retryPolicy: { attempts: 2 },
    ...overrides,
  };
}

describe('M1/M3–M6/M11/M12 — contrato REAL (model + serviço + Postgres)', () => {
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

  describe('M1 — contrato de export/import do model', () => {
    it('o módulo exporta a FACTORY (função), não uma instância resolvida', () => {
      // Se exportasse a instância, o model ficaria congelado ANTES de
      // `connect()` e nunca enxergaria a tabela real.
      expect(typeof modelModule).toBe('function');
      // Um model do Sequelize É uma função (classe) — o contrato é: a factory
      // devolve o model utilizável, com a superfície de query.
      expect(typeof modelModule()).toBe('function');
      expect(typeof modelModule().findAll).toBe('function');
    });

    it('a factory devolve a MESMA instância (singleton por processo)', () => {
      expect(modelModule()).toBe(modelModule());
    });

    it('sem Sequelize inicializado a factory falha de forma explícita', () => {
      // `getSequelize()` é nulo antes de `connect()`; o model devolve um Proxy
      // que falha ao ser usado — nunca um objeto que silenciosamente "não tem"
      // a tabela.
      let isolatedFactory = null;
      jest.isolateModules(() => {
        // eslint-disable-next-line global-require
        isolatedFactory = require('../../../api/db/models/McpConnection');
      });
      expect(typeof isolatedFactory).toBe('function');
      const model = isolatedFactory();
      expect(() => model.findAll).toThrow(/Sequelize não inicializado/);
    });

    it('o model real aponta para a tabela `mcp_connections` com a config operacional', () => {
      if (skipIfNoDatabase()) return;
      const Model = modelModule();
      expect(Model.getTableName()).toBe('mcp_connections');
      const attributes = Object.keys(Model.rawAttributes);
      for (const column of [
        'allowed_capabilities', 'allowed_tools', 'tool_capability_map', 'mapping_version',
        'tool_policies', 'endpoint_policy', 'quota', 'timeout_ms', 'retry_policy',
        'discovered_tools', 'schema_revalidated_at', 'credential_ref',
      ]) {
        expect(attributes).toContain(column);
      }
      // §M4: o model NUNCA guarda o segredo — apenas a referência.
      for (const forbidden of ['token', 'api_key', 'secret', 'password', 'client_secret']) {
        expect(attributes).not.toContain(forbidden);
      }
    });
  });

  describe('M6 — config operacional persiste e volta completa', () => {
    it('create → read preserva TUDO (não só identidade e saúde)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-opconfig');
      tenants.push(tenantId);

      const created = await service.createConnection({ tenantId, input: operationalInput() });

      expect(created.allowedCapabilities).toEqual(['crm.read']);
      expect(created.allowedTools).toEqual(['crm.byId']);
      expect(created.toolCapabilityMap).toEqual({ 'crm.byId': 'crm.read' });
      expect(created.toolPolicies['crm.byId']).toMatchObject({ riskLevel: 'low', sideEffects: false });
      expect(created.endpointPolicy).toEqual({ allowPrivateNetwork: false, maxRedirects: 0 });
      expect(created.quota).toEqual({ tenant: 100, connection: 50, tool: 10 });
      expect(created.timeoutMs).toBe(15000);
      expect(created.retryPolicy).toEqual({ attempts: 2 });
      // §M8 — mapeamento versionado.
      expect(created.mappingVersion).toBe('1');

      const reread = await service.getConnection({ tenantId, id: created.id });
      expect(reread.toolPolicies).toEqual(created.toolPolicies);
      expect(reread.allowedTools).toEqual(['crm.byId']);
    });

    it('listConnections NÃO dropa a config operacional (regressão do defeito real)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-list');
      tenants.push(tenantId);
      await service.createConnection({ tenantId, input: operationalInput({ name: 'listada' }) });

      const [row] = await service.listConnections({ tenantId });

      // Sem estas asserções, a política declarada por tool era descartada e uma
      // mutação declarada autônoma voltava a exigir confirmação.
      expect(row.toolPolicies).toEqual(expect.objectContaining({ 'crm.byId': expect.any(Object) }));
      expect(row.allowedCapabilities).toEqual(['crm.read']);
      expect(row.toolCapabilityMap).toEqual({ 'crm.byId': 'crm.read' });
      expect(row.mappingVersion).toBe('1');
      expect(row.timeoutMs).toBe(15000);
      expect(row.retryPolicy).toEqual({ attempts: 2 });
    });

    it('toConnectionConfig entrega ao hub a política por tool e o mapeamento', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-hubcfg');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'hubcfg' }) });

      const config = service.toConnectionConfig(created);

      expect(config).toMatchObject({
        tenant: tenantId,
        name: 'hubcfg',
        endpoint: ENDPOINT,
        classification: 'PRODUCTION',
        authType: 'bearer',
        connectionId: created.id,
      });
      expect(config.toolPolicies['crm.byId']).toMatchObject({ riskLevel: 'low' });
      expect(config.toolCapabilityMap).toEqual({ 'crm.byId': 'crm.read' });
      expect(config.allowedTools).toEqual(['crm.byId']);
      expect(config.timeoutMs).toBe(15000);
      expect(config.retryPolicy).toEqual({ attempts: 2 });
    });

    it('alterar o mapeamento incrementa mappingVersion; alterar só o timeout NÃO', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-mapver');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'mapver' }) });

      const timeoutOnly = await service.updateConnection({
        tenantId, id: created.id, patch: { timeoutMs: 20000 },
      });
      expect(timeoutOnly.mappingVersion).toBe('1');

      const remapped = await service.updateConnection({
        tenantId, id: created.id, patch: { toolCapabilityMap: { 'crm.byId': 'crm.read', 'crm.byDoc': 'crm.read' } },
      });
      expect(remapped.mappingVersion).toBe('2');
    });
  });

  describe('M3/M4 — o banco é a autoridade no startup (sem `deps.tenants`)', () => {
    it('listAllEnabledConnections devolve TODOS os tenants habilitados e ignora desabilitados', async () => {
      if (skipIfNoDatabase()) return;
      const tenantA = uniqueTenantKey('mcp-all-a');
      const tenantB = uniqueTenantKey('mcp-all-b');
      tenants.push(tenantA, tenantB);

      const a = await service.createConnection({ tenantId: tenantA, input: operationalInput({ name: 'a-enabled' }) });
      await service.createConnection({ tenantId: tenantB, input: operationalInput({ name: 'b-enabled' }) });
      const disabled = await service.createConnection({
        tenantId: tenantA,
        input: operationalInput({ name: 'a-disabled', enabled: false }),
      });

      const rows = await service.listAllEnabledConnections();
      const mine = rows.filter((row) => row.tenant_key === tenantA || row.tenant_key === tenantB);

      expect(mine.map((row) => row.name).sort()).toEqual(['a-enabled', 'b-enabled']);
      expect(mine.some((row) => row.id === disabled.id)).toBe(false);
      // `toHaveProperty` interpreta ponto como caminho aninhado; a chave aqui É
      // literal ('crm.byId'), então a asserção é por chave exata.
      expect(Object.keys(mine.find((row) => row.id === a.id).toolPolicies)).toContain('crm.byId');
    });

    it('M5 — reinício: processo NOVO sem cache vê a conexão persistida e com a config completa', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-restart');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'sobrevive' }) });

      // Processo novo: registry de módulos ISOLADO (nenhum singleton compartilhado
      // com esta suíte) falando com o MESMO banco. É o cenário de reinício real.
      // `jest.isolateModulesAsync` não devolve o valor do callback — o resultado
      // é capturado por closure.
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
      const restored = loaded.connections.find((c) => c.connectionId === created.id);
      expect(restored).toMatchObject({
        tenant: tenantId,
        name: 'sobrevive',
        authType: 'bearer',
        credentialRef: 'MCP_CONTRACT_TOKEN',
        classification: 'PRODUCTION',
        enabled: true,
      });
      // A config operacional sobrevive ao reinício — é ela que o hub consome.
      expect(restored.toolPolicies['crm.byId']).toMatchObject({ riskLevel: 'low' });
      expect(restored.toolCapabilityMap).toEqual({ 'crm.byId': 'crm.read' });
      expect(restored.allowedTools).toEqual(['crm.byId']);
    });

    it('a carga do runtime NÃO depende de uma lista de tenants', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-notenants');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'sem-lista' }) });

      // Sem `tenants`: se a lista fosse insumo, este tenant nunca apareceria.
      const loaded = await loadConnectionsFromPersistence();
      expect(loaded.connections.some((c) => c.connectionId === created.id)).toBe(true);
    });
  });

  describe('M8/§M11/§M12 — descoberta, saúde e revalidação persistidas', () => {
    it('descoberta persiste inventário, fingerprint e sucesso', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-disc');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'disc' }) });

      const tools = [{ name: 'crm.byId', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }];
      const result = await service.recordDiscovery({ tenantId, id: created.id, tools });

      expect(result.schemaChanged).toBe(false);
      expect(result.toolCount).toBe(1);
      expect(result.schema_fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(result.discovered_tools).toEqual([
        { name: 'crm.byId', capability: 'crm.read', schemaFingerprint: null },
      ]);
      expect(result.last_discovery_at).toBeTruthy();
      expect(result.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(result.unmappedTools).toEqual([]);
    });

    it('M12 — mudança de schema vira SCHEMA_CHANGED e exige revalidação (nunca promove sozinho)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-schema');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'schema' }) });

      await service.recordDiscovery({
        tenantId,
        id: created.id,
        tools: [{ name: 'crm.byId', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }],
      });
      const changed = await service.recordDiscovery({
        tenantId,
        id: created.id,
        tools: [{
          name: 'crm.byId',
          inputSchema: { type: 'object', properties: { id: { type: 'string' }, extra: { type: 'integer' } } },
        }],
      });

      expect(changed.schemaChanged).toBe(true);
      expect(changed.revalidationRequired).toBe(true);
      expect(changed.status).toBe(service.LIFECYCLE_STATES.SCHEMA_CHANGED);
      expect(changed.metadata.revalidationRequired).toBe(true);

      const revalidated = await service.recordRevalidation({ tenantId, id: created.id, tools: changed.discovered_tools });
      expect(revalidated.revalidated).toBe(true);
      expect(revalidated.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(revalidated.metadata.revalidationRequired).toBe(false);
      expect(revalidated.schema_revalidated_at).toBeTruthy();
    });

    it('tool sem capability mapeada é reportada como não mapeada (não inventa semântica)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-unmapped');
      tenants.push(tenantId);
      const created = await service.createConnection({
        tenantId,
        input: operationalInput({ name: 'unmapped', allowedCapabilities: ['crm.read'], toolCapabilityMap: {} }),
      });

      const result = await service.recordDiscovery({
        tenantId,
        id: created.id,
        tools: [{ name: 'crm.byId' }, { name: 'outra.tool' }],
      });

      expect(result.unmappedTools.sort()).toEqual(['crm.byId', 'outra.tool']);
      expect(result.discovered_tools.every((tool) => tool.capability === null)).toBe(true);
    });

    it('saúde persiste falha com erro explícito e degrada', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-health');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'health' }) });

      const failed = await service.recordHealth({ tenantId, id: created.id, ok: false, error: 'ECONNREFUSED', degradedAfter: 1 });
      expect(failed.status).toBe(service.LIFECYCLE_STATES.UNAVAILABLE);
      expect(failed.consecutive_failures).toBe(1);
      expect(failed.last_error).toMatch(/ECONNREFUSED/);
      expect(failed.last_failure_at).toBeTruthy();

      const healthy = await service.recordHealth({ tenantId, id: created.id, ok: true });
      expect(healthy.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(healthy.consecutive_failures).toBe(0);
      expect(healthy.last_error).toBeNull();
    });

    it('update de endpoint invalida schema e inventário conhecidos', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-invalidate');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'invalida' }) });
      await service.recordDiscovery({ tenantId, id: created.id, tools: [{ name: 'crm.byId' }] });

      const updated = await service.updateConnection({
        tenantId,
        id: created.id,
        patch: { endpoint: 'https://mcp.outro.exemplo.com/rpc' },
      });

      expect(updated.schema_fingerprint).toBeNull();
      expect(updated.discovered_tools).toEqual([]);
      expect(updated.status).toBe(service.LIFECYCLE_STATES.CONFIGURED);
    });
  });

  describe('§M4 — isolamento por tenant', () => {
    it('conexão de outro tenant resolve NOT_FOUND (sem vazar existência)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantA = uniqueTenantKey('mcp-iso-a');
      const tenantB = uniqueTenantKey('mcp-iso-b');
      tenants.push(tenantA, tenantB);
      const created = await service.createConnection({ tenantId: tenantA, input: operationalInput({ name: 'privada' }) });

      await expect(service.getConnection({ tenantId: tenantB, id: created.id }))
        .rejects.toMatchObject({ code: service.ERROR_CODES.NOT_FOUND });
      await expect(service.updateConnection({ tenantId: tenantB, id: created.id, patch: { timeoutMs: 1000 } }))
        .rejects.toMatchObject({ code: service.ERROR_CODES.NOT_FOUND });
      await expect(service.setEnabled({ tenantId: tenantB, id: created.id, enabled: false }))
        .rejects.toMatchObject({ code: service.ERROR_CODES.NOT_FOUND });
    });

    it('a violação da chave única (tenant, name) é do BANCO, não só do código', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-uq');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'unica' }) });

      const getMcpConnectionModel = require('../../../api/db/models/McpConnection');
      const Model = getMcpConnectionModel();
      // A unicidade é garantida pelo ÍNDICE do banco (não por um `findOne`
      // otimista do serviço): o erro real do Postgres/Sequelize precisa aparecer.
      await expect(Model.create({
        id: `dup-${crypto.randomBytes(4).toString('hex')}`,
        tenant_key: tenantId,
        name: 'unica',
        endpoint: ENDPOINT,
        transport: 'http',
        auth_type: 'bearer',
        enabled: true,
        classification_ceiling: 'PRODUCTION',
        status: 'CONFIGURED',
      })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
      expect(await Model.count({ where: { tenant_key: tenantId, name: 'unica' } })).toBe(1);
      expect(created.id).toBeTruthy();
    });
  });

  describe('§M18 — ecossistema externo reportado com honestidade (banco real)', () => {
    it('tenant sem conexão habilitada é NOT_CONFIGURED — nunca LIVE', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-eco-empty');
      tenants.push(tenantId);

      const status = await getExternalEcosystemStatus({ tenantId });

      expect(status.status).toBe(MCP_EXTERNAL_ECOSYSTEM.NOT_CONFIGURED);
      expect(status.evidence.enabledConnections).toBe(0);
      expect(status.live).toBe(false);
    });

    it('conexão habilitada sem descoberta real é CONFIGURED_UNVERIFIED (nunca LIVE)', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-eco-unv');
      tenants.push(tenantId);
      await service.createConnection({ tenantId, input: operationalInput({ name: 'nao-verificada' }) });

      const status = await getExternalEcosystemStatus({ tenantId });

      expect(status.status).toBe(MCP_EXTERNAL_ECOSYSTEM.CONFIGURED_UNVERIFIED);
      expect(status.evidence.verifiedConnections).toBe(0);
    });

    it('só com descoberta REAL persistida e saúde o tenant é LIVE', async () => {
      if (skipIfNoDatabase()) return;
      const tenantId = uniqueTenantKey('mcp-eco-live');
      tenants.push(tenantId);
      const created = await service.createConnection({ tenantId, input: operationalInput({ name: 'verificada' }) });
      await service.recordDiscovery({ tenantId, id: created.id, tools: [{ name: 'crm.byId' }] });

      const status = await getExternalEcosystemStatus({ tenantId });

      expect(status.status).toBe(MCP_EXTERNAL_ECOSYSTEM.LIVE);
      expect(status.evidence.verifiedConnections).toBe(1);
      expect(status.connections[0].verified).toBe(true);
      expect(status.connections[0].discoveredToolCount).toBe(1);
    });
  });
});
