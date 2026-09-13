'use strict';

/**
 * TAREFA 70/73/74/75/90 — STARTUP → DB (o lifecycle que só existia em memória).
 *
 * GAP CONFIRMADO (auditoria 2026-09-13): o startup criava o hub, registrava as
 * tools no Canonical Tool Registry e NÃO gravava nada — `discovery`, `health`,
 * `schemaFingerprint` e timestamps (`lastDiscoveryAt`/`lastSuccessAt`/
 * `lastHealthAt`) existiam apenas no processo. O caminho administrativo
 * (`POST /mcp/connections/:id/discover`) persistia. Duas semânticas para a
 * mesma operação: após um restart, o que o startup havia "descoberto"
 * desaparecia, e o banco contava outra história.
 *
 * Este arquivo prova o lifecycle REAL:
 *
 *   conexão persistida → startup (`persistStartupDiscovery`)
 *     → `runDiscoveryCycle` (rotina ÚNICA, a mesma do admin)
 *     → discovery + health + schemaFingerprint GRAVADOS no Postgres
 *     → releitura do banco (simulando restart) devolve o mesmo estado
 *     → mudança de schema vira SCHEMA_CHANGED (nunca promovida sozinha)
 *
 * O único elemento substituído é o TRANSPORTE (socket): o servidor MCP é uma
 * fixture em `tests/` com o SDK oficial, e o protocolo exercitado é o de
 * verdade. Nenhum model ou serviço é dublê.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO e reportado (nunca verde silencioso).
 */

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
} = require('./fixtures/fakeMcpServer');

const service = require('../../../api/services/mcp/mcpConnectionService');
const discovery = require('../../../api/services/mcp/mcpDiscoveryService');
const { persistStartupDiscovery } = require('../../../api/runtime/startMcpClient');
const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const { DISCOVERY_CODES } = require('../../../api/services/mcp/mcpDiscoveryCore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const PUBLIC_ENDPOINT = 'https://mcp.startup.exemplo.com/rpc';
const TOOL = 'crm.lookupCustomer';

const REMOTE_TOOLS = [
  {
    name: TOOL,
    description: 'Consulta cliente',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
];


/**
 * Servidor MCP fixture (SDK oficial) + fechamento explícito. O transporte é o
 * único elemento substituído: o protocolo exercitado é o de verdade.
 */
function makeServer({ tools }) {
  const fixture = createFakeMcpServer({ tools });
  return {
    fixture,
    mcpServer: fixture.server,
    close: async () => {
      try { await fixture.server.close?.(); } catch (_) { /* já fechado */ }
    },
  };
}

const tenants = [];
let dbAvailable = false;
let dbReason = null;

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[mcp-startup-persistence] PULADO: ${DB_SKIP_REASON} (${dbReason})`);
  return true;
}

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
        sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
      },
    },
    endpointPolicy: { allowPrivateNetwork: false },
    timeoutMs: 15000,
    ...overrides,
  };
}

/** Um hub REAL apontando para a fixture (só o socket é substituído). */
function buildHub({ connections, server }) {
  return createMcpClientHub({
    connections: connections.map((connection) => ({ ...connection, enabled: true })),
    logger: silent,
    credentialResolver: () => 'fixture-secret-token',
    transportFactory: createFixtureTransportFactory({ server: server.mcpServer }),
  });
}

async function storedConnection({ tenantId, input = connectionInput() } = {}) {
  return service.createConnection({ tenantId, input });
}

describe('TAREFA 70/71/72/73/74 — startup persiste o lifecycle no banco', () => {
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

  test('RED — o startup GRAVA discovery + health (não só memória)', async () => {
    if (skipIfNoDatabase()) return;
    const tenantId = uniqueTenantKey('mcp-startup');
    tenants.push(tenantId);

    const server = makeServer({ tools: REMOTE_TOOLS });
    const created = await storedConnection({ tenantId });
    const config = service.toConnectionConfig(await service.getConnection({ tenantId, id: created.id }));
    const hub = buildHub({ connections: [config], server });
    try {
      const results = await persistStartupDiscovery({ connections: [config], hub });

      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(true);
      expect(results[0].persisted).toBe(true);
      expect(results[0].toolCount).toBeGreaterThan(0);

      // A PROVA é a releitura do banco, não o retorno da função.
      const persisted = await service.getConnection({ tenantId, id: created.id });
      expect(persisted.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
      expect(persisted.last_discovery_at).toBeTruthy();
      expect(persisted.last_health_at).toBeTruthy();
      expect(persisted.last_success_at).toBeTruthy();
      expect(persisted.schema_fingerprint).toBeTruthy();
      expect(Array.isArray(persisted.discovered_tools)).toBe(true);
      expect(persisted.discovered_tools.map((tool) => tool.name)).toContain(TOOL);
    } finally {
      await server.close();
      await hub.closeAll?.();
    }
  });

  test('RED — startup e admin produzem o MESMO resultado (TAREFA 73)', async () => {
    if (skipIfNoDatabase()) return;
    const tenantId = uniqueTenantKey('mcp-parity');
    tenants.push(tenantId);

    const server = makeServer({ tools: REMOTE_TOOLS });
    const startupConn = await storedConnection({ tenantId, input: connectionInput({ name: 'startup-path' }) });
    const adminConn = await storedConnection({ tenantId, input: connectionInput({ name: 'admin-path' }) });

    const startupConfig = service.toConnectionConfig(await service.getConnection({ tenantId, id: startupConn.id }));
    const startupHub = buildHub({ connections: [startupConfig], server });
    try {
      const startupResults = await persistStartupDiscovery({ connections: [startupConfig], hub: startupHub });
      const adminResult = await discovery.discoverConnectionTools({
        tenantId,
        id: adminConn.id,
        deps: { transportFactory: createFixtureTransportFactory({ server: server.mcpServer }), credentialResolver: () => 'fixture-secret-token' },
      });

      expect(startupResults[0].ok).toBe(true);
      expect(adminResult.ok).toBe(true);
      expect(startupResults[0].toolCount).toBe(adminResult.toolCount);

      const startupState = await service.getConnection({ tenantId, id: startupConn.id });
      const adminState = await service.getConnection({ tenantId, id: adminConn.id });
      expect(startupState.schema_fingerprint).toBe(adminState.schema_fingerprint);
      expect(startupState.status).toBe(adminState.status);
      expect(startupState.discovered_tools.map((tool) => tool.name).sort())
        .toEqual(adminState.discovered_tools.map((tool) => tool.name).sort());
    } finally {
      await server.close();
      await startupHub.closeAll?.();
    }
  });

  test('RED — restart: o estado do startup sobrevive (TAREFA 74)', async () => {
    if (skipIfNoDatabase()) return;
    const tenantId = uniqueTenantKey('mcp-restart');
    tenants.push(tenantId);

    const server = makeServer({ tools: REMOTE_TOOLS });
    const created = await storedConnection({ tenantId });
    const config = service.toConnectionConfig(await service.getConnection({ tenantId, id: created.id }));
    const hub = buildHub({ connections: [config], server });
    try {
      await persistStartupDiscovery({ connections: [config], hub });
    } finally {
      await server.close();
      await hub.closeAll?.();
    }

    // ---- "restart": NENHUMA referência anterior sobrevive ------------------
    const reloaded = await service.listAllEnabledConnections();
    const afterRestart = reloaded.find((row) => row.tenant_key === tenantId);
    expect(afterRestart).toBeTruthy();
    expect(afterRestart.last_discovery_at).toBeTruthy();
    expect(afterRestart.schema_fingerprint).toBeTruthy();
    expect(afterRestart.status).toBe(service.LIFECYCLE_STATES.HEALTHY);
    expect(afterRestart.discovered_tools.map((tool) => tool.name)).toContain(TOOL);
  });

  test('RED — mudança de schema no startup é DETECTADA, não promovida (TAREFA 72/90)', async () => {
    if (skipIfNoDatabase()) return;
    const tenantId = uniqueTenantKey('mcp-drift');
    tenants.push(tenantId);

    const first = makeServer({ tools: REMOTE_TOOLS });
    const created = await storedConnection({ tenantId });
    const config = service.toConnectionConfig(await service.getConnection({ tenantId, id: created.id }));
    const hub1 = buildHub({ connections: [config], server: first });
    try {
      await persistStartupDiscovery({ connections: [config], hub: hub1 });
    } finally {
      await first.close();
      await hub1.closeAll?.();
    }
    const v1 = await service.getConnection({ tenantId, id: created.id });
    const fingerprintV1 = v1.schema_fingerprint;

    // O contrato do servidor MUDOU (novo campo obrigatório).
    const changed = [
      {
        name: TOOL,
        description: 'Consulta cliente (v2)',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, tenantScoped: { type: 'boolean' } },
          required: ['id', 'tenantScoped'],
          additionalProperties: false,
        },
      },
    ];
    const second = makeServer({ tools: changed });
    const hub2 = buildHub({ connections: [config], server: second });
    try {
      const results = await persistStartupDiscovery({ connections: [config], hub: hub2 });
      expect(results[0].schemaChanged).toBe(true);
      expect(results[0].revalidationRequired).toBe(true);
    } finally {
      await second.close();
      await hub2.closeAll?.();
    }

    const drifted = await service.getConnection({ tenantId, id: created.id });
    // O contrato em VIGOR continua o antigo; o novo é apenas OBSERVADO.
    expect(drifted.schema_fingerprint).toBe(fingerprintV1);
    expect(drifted.status).toBe(service.LIFECYCLE_STATES.SCHEMA_CHANGED);
    expect(drifted.metadata.revalidationRequired).toBe(true);
    // A saúde do servidor foi registrada mesmo com o contrato pendente: o
    // servidor RESPONDEU (o que falta é revalidação explícita).
    expect(drifted.last_health_at).toBeTruthy();
  });

  test('conexão SEM relação persistida é reportada — nunca gravada por engano (TAREFA 75)', async () => {
    if (skipIfNoDatabase()) return;
    const tenantId = uniqueTenantKey('mcp-unpersisted');
    tenants.push(tenantId);

    const server = makeServer({ tools: REMOTE_TOOLS });
    const created = await storedConnection({ tenantId });
    const config = service.toConnectionConfig(await service.getConnection({ tenantId, id: created.id }));
    const hub = buildHub({ connections: [config], server });
    try {
      const results = await persistStartupDiscovery({
        connections: [{ ...config, connectionId: null }],
        hub,
      });
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].code).toBe(DISCOVERY_CODES.CONNECTION_NOT_PERSISTED);
    } finally {
      await server.close();
      await hub.closeAll?.();
    }

    // Nada foi gravado para a conexão real.
    const untouched = await service.getConnection({ tenantId, id: created.id });
    expect(untouched.last_discovery_at).toBeNull();
    expect(untouched.schema_fingerprint).toBeNull();
  });
});
