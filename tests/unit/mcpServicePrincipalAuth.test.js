'use strict';

/**
 * MCP Service Principal (M31/M32/M33/M34) — identidade machine-to-machine para
 * agentes externos consumindo o RAP.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../api/services/authService', () => ({ validateToken: jest.fn() }));

const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const { validateToken } = require('../../api/services/authService');
const { mountMcpRoutes, buildMcpAuthContext, isServicePrincipalAuthEnabled } = require('../../api/runtime/startMcpServer');
const { resolveServicePrincipal } = require('../../api/runtime/mcpServicePrincipalAuth');
const {
  PRINCIPAL_INVALID_REASONS,
  validateServicePrincipal,
  applyClassificationCeiling,
  grantedCapabilities,
  filterToolsForPrincipal,
  extractBearerToken,
} = require('../../src/core/mcp/service-principal');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function makeRecord(overrides = {}) {
  return {
    id: 'pat_1',
    tenantId: 'tenant-a',
    kind: 'developer',
    active: true,
    revokedAt: null,
    expiresAt: null,
    meta: {
      name: 'integração-parceiro',
      mcp: {
        enabled: true,
        capabilityScopes: ['crm.read', 'schedule.read'],
        classificationCeiling: 'SUPPORT',
        auditIdentity: 'partner-agent-1',
      },
    },
    ...overrides,
  };
}

describe('Service principal — validação fail-closed', () => {
  test('developer key sem bloco mcp NÃO é principal MCP (opt-in explícito)', () => {
    const result = validateServicePrincipal(makeRecord({ meta: { name: 'key-comum' } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(PRINCIPAL_INVALID_REASONS.NOT_ENABLED);
  });

  test('scopes vazios ⇒ nenhum acesso (nunca acesso total)', () => {
    const result = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: [] } },
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(PRINCIPAL_INVALID_REASONS.SCOPES_REQUIRED);
  });

  test('wildcard é proibido para service principal', () => {
    const result = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: ['*'] } },
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(PRINCIPAL_INVALID_REASONS.WILDCARD_FORBIDDEN);
  });

  test('classification ceiling inválido é recusado', () => {
    const result = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: ['crm.read'], classificationCeiling: 'ROOT' } },
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(PRINCIPAL_INVALID_REASONS.CEILING_INVALID);
  });

  test('credencial expirada é recusada (mesmo antes do store)', () => {
    const result = validateServicePrincipal(
      makeRecord({ expiresAt: '2020-01-01T00:00:00.000Z' }),
      { now: Date.parse('2026-09-11T00:00:00.000Z') },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(PRINCIPAL_INVALID_REASONS.EXPIRED);
  });

  test('credencial revogada ou inativa é recusada', () => {
    expect(validateServicePrincipal(makeRecord({ revokedAt: '2026-01-01T00:00:00.000Z' })).reason)
      .toBe(PRINCIPAL_INVALID_REASONS.REVOKED);
    expect(validateServicePrincipal(makeRecord({ active: false })).reason)
      .toBe(PRINCIPAL_INVALID_REASONS.INACTIVE);
  });

  test('sem tenant não há principal', () => {
    expect(validateServicePrincipal(makeRecord({ tenantId: '' })).reason)
      .toBe(PRINCIPAL_INVALID_REASONS.TENANT_REQUIRED);
    expect(validateServicePrincipal(null).reason)
      .toBe(PRINCIPAL_INVALID_REASONS.RECORD_REQUIRED);
  });

  test('principal válido carrega tenant, escopos, teto e identidade de auditoria', () => {
    const { valid, principal } = validateServicePrincipal(makeRecord());
    expect(valid).toBe(true);
    expect(principal.tenantId).toBe('tenant-a');
    expect(principal.principalType).toBe('service');
    expect(principal.capabilityScopes).toEqual(['crm.read', 'schedule.read']);
    expect(principal.classification).toBe('SUPPORT');
    expect(principal.classificationCeiling).toBe('SUPPORT');
    expect(principal.auditIdentity).toBe('partner-agent-1');
    expect(principal.permissions).toEqual(['crm.read', 'schedule.read']);
    expect(principal.permissions).not.toContain('*');
  });

  test('ceiling default é o MENOR privilégio (PRODUCTION)', () => {
    const { principal } = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: ['crm.read'] } },
    }));
    expect(principal.classificationCeiling).toBe('PRODUCTION');
    expect(principal.classification).toBe('PRODUCTION');
  });
});

describe('Service principal — escopo e teto (M33/M34)', () => {
  test('o teto de classificação nunca é elevado pelo chamador', () => {
    expect(applyClassificationCeiling('DEVELOPMENT', 'PRODUCTION')).toBe('PRODUCTION');
    expect(applyClassificationCeiling('SUPPORT', 'SUPPORT')).toBe('SUPPORT');
    expect(applyClassificationCeiling('PRODUCTION', 'DEVELOPMENT')).toBe('PRODUCTION');
    expect(applyClassificationCeiling(undefined, 'SUPPORT')).toBe('SUPPORT');
  });

  test('capabilities fora do escopo não são concedidas (nem descobertas)', () => {
    const { principal } = validateServicePrincipal(makeRecord());
    const granted = grantedCapabilities({
      principal,
      availableCapabilities: ['crm.read', 'schedule.read', 'billing.read', 'qa.waves.read'],
    });
    expect(granted.sort()).toEqual(['crm.read', 'schedule.read']);
  });

  test('tool acima do teto de classificação não é visível nem executável', () => {
    const { principal } = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: ['crm.read', 'qa.waves.read'], classificationCeiling: 'PRODUCTION' } },
    }));
    const tools = [
      { id: 'crm.searchCustomer', capability: 'crm.read', permissions: ['crm.read'], visibility: 'PRODUCTION' },
      { id: 'qa.waves.run', capability: 'qa.waves.read', permissions: ['qa.waves.read'], visibility: 'DEVELOPMENT' },
      { id: 'replay.read', capability: 'replay.read', permissions: ['replay.read'], visibility: 'SUPPORT' },
    ];
    const { visible, hidden } = filterToolsForPrincipal({ tools, principal });
    expect(visible.map((t) => t.id)).toEqual(['crm.searchCustomer']);
    expect(hidden.find((h) => h.id === 'qa.waves.run').reason).toBe('classification_above_ceiling');
    expect(hidden.find((h) => h.id === 'replay.read').reason).toBe('classification_above_ceiling');
  });

  test('capability fora do escopo é ocultada mesmo dentro do teto', () => {
    const { principal } = validateServicePrincipal(makeRecord({
      meta: { mcp: { enabled: true, capabilityScopes: ['crm.read'], classificationCeiling: 'DEVELOPMENT' } },
    }));
    const tools = [
      { id: 'crm.searchCustomer', capability: 'crm.read', permissions: ['crm.read'], visibility: 'PRODUCTION' },
      { id: 'billing.read', capability: 'billing.read', permissions: ['billing.read'], visibility: 'PRODUCTION' },
    ];
    const { visible, hidden } = filterToolsForPrincipal({ tools, principal });
    expect(visible.map((t) => t.id)).toEqual(['crm.searchCustomer']);
    expect(hidden[0].reason).toBe('capability_out_of_scope');
  });
});

describe('Service principal — resolução de credencial', () => {
  test('Bearer é obrigatório; token em querystring não é aceito', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
  });

  test('credencial válida produz authContext com tenant, escopos e teto', async () => {
    const result = await resolveServicePrincipal({
      authorizationHeader: 'Bearer tok-1',
      resolveToken: async () => ({ ok: true, record: makeRecord() }),
      correlationId: 'corr-1',
    });
    expect(result.ok).toBe(true);
    expect(result.authContext).toEqual(expect.objectContaining({
      tenantId: 'tenant-a',
      principalType: 'service',
      classification: 'SUPPORT',
      permissions: ['crm.read', 'schedule.read'],
      capabilities: ['crm.read', 'schedule.read'],
      correlationId: 'corr-1',
    }));
    // A credencial em si nunca é propagada ao contexto.
    expect(JSON.stringify(result.authContext)).not.toContain('tok-1');
  });

  test('sem header não há resolução (nunca anônimo)', async () => {
    const result = await resolveServicePrincipal({ authorizationHeader: undefined, resolveToken: async () => ({ ok: true }) });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('mcp_credential_required');
  });

  test('token desconhecido/inativo no store é recusado com código genérico', async () => {
    const result = await resolveServicePrincipal({
      authorizationHeader: 'Bearer nope',
      resolveToken: async () => ({ ok: false, error: 'token_inactive' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('mcp_credential_invalid');
    expect(result.detail).toBe('token_inactive');
    expect(result.authContext).toBeNull();
  });

  test('credencial expirada é recusada como expirada', async () => {
    const result = await resolveServicePrincipal({
      authorizationHeader: 'Bearer old',
      resolveToken: async () => ({ ok: true, record: makeRecord({ expiresAt: '2020-01-01T00:00:00.000Z' }) }),
      now: Date.parse('2026-09-11T00:00:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('mcp_credential_expired');
  });

  test('developer key sem bloco mcp não autentica (opt-in)', async () => {
    const result = await resolveServicePrincipal({
      authorizationHeader: 'Bearer plain',
      resolveToken: async () => ({ ok: true, record: makeRecord({ meta: { name: 'comum' } }) }),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(PRINCIPAL_INVALID_REASONS.NOT_ENABLED);
  });

  test('falha do resolver não vira 500 silencioso', async () => {
    const result = await resolveServicePrincipal({
      authorizationHeader: 'Bearer x',
      resolveToken: async () => { throw new Error('db down'); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('mcp_credential_resolution_failed');
  });
});

describe('Service principal — boundary HTTP /mcp', () => {
  let server;
  let baseUrl;

  afterEach(async () => {
    validateToken.mockReset();
    delete process.env.MCP_SERVICE_PRINCIPAL_AUTH;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  function buildApp(deps = {}) {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'crm.searchCustomer', capability: 'crm.read', visibility: 'PRODUCTION',
      permissions: ['crm.read'], description: 'busca cliente', execute: async () => ({ customers: [] }),
    });
    registry.register({
      id: 'qa.waves.run', capability: 'qa.waves.read', visibility: 'DEVELOPMENT',
      permissions: ['qa.waves.read'], description: 'roda wave', execute: async () => ({ ok: true }),
    });

    const app = express();
    app.use(express.json());
    mountMcpRoutes(app, { orchestrator: { toolRegistry: registry }, ...deps });
    return app;
  }

  async function startHttp(app) {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    return baseUrl;
  }

  async function listToolsAsPrincipal(token) {
    const client = new Client({ name: 'ext-agent', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const result = await client.listTools();
    await client.close();
    return result.tools.map((t) => t.name);
  }

  test('M2M desabilitado por padrão fora de produção → 401 (sem tocar credencial)', async () => {
    expect(isServicePrincipalAuthEnabled({})).toBe(false);
    const app = buildApp();
    await startHttp(app);
    validateToken.mockReturnValue({ valid: false });

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer qualquer' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('mcp_authentication_required');
  });

  test('agente externo autentica SEM sessão humana e só vê tools do seu escopo/teto', async () => {
    validateToken.mockReturnValue({ valid: false }); // nenhuma sessão humana
    const app = buildApp({
      orchestrator: null,
      resolveServicePrincipalToken: async () => ({ ok: true, record: makeRecord({
        meta: { mcp: { enabled: true, capabilityScopes: ['crm.read'], classificationCeiling: 'PRODUCTION' } },
      }) }),
    });
    // registry injetado separadamente para o bridge de auth não perder o adapter
    await startHttp(app);

    const tools = await listToolsAsPrincipal('tok-parceiro');
    expect(tools).toContain('crm.searchCustomer');
    expect(tools).not.toContain('qa.waves.run');
  });

  test('credencial inválida → 401 com o MESMO código (sem oráculo)', async () => {
    validateToken.mockReturnValue({ valid: false });
    const app = buildApp({
      resolveServicePrincipalToken: async () => ({ ok: false, error: 'token_inactive' }),
    });
    await startHttp(app);

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer revogado' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('mcp_authentication_required');
  });

  test('buildMcpAuthContext do principal de serviço não aceita elevação de classificação', () => {
    const ctx = buildMcpAuthContext({
      mcpAuthContext: {
        tenantId: 'tenant-a', principalId: 'sp-1', principalType: 'service',
        classification: 'PRODUCTION', permissions: ['crm.read'], capabilities: ['crm.read'],
      },
    });
    expect(ctx.classification).toBe('PRODUCTION');
    expect(ctx.permissions).toEqual(['crm.read']);
  });
});
