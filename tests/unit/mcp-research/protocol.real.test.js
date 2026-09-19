'use strict';

/**
 * Protocolo REAL do container mcp-research — prova final SEM InMemoryTransport:
 * o servidor sobe em porta efêmera e o MCP Client Hub fala StreamableHTTP de
 * verdade (DNS revalidado, política de endpoint, bearer serviço-a-serviço).
 *
 * Cobre: initialize, tools/list, tools/call real de fetch contra fixture HTTP
 * local (exceção de política TEST-ONLY documentada no servidor), ligação de
 * hash fetch=inspect=evidence, rejeição de input malformado, rejeição de token
 * não autorizado, recusa de conexão desabilitada, schema change →
 * SCHEMA_CHANGED/REVALIDATION_REQUIRED, e a resolução do research principal
 * pelo caminho real adapter+registry+delegation (espelho de
 * tests/unit/mcp/mcpResearchDelegation.test.js, mas sobre HTTP real).
 */

const http = require('http');

const {
  silent,
  TEST_TOKEN,
  startRealService,
  researchConnectionConfig,
  buildRealHub,
  buildReadyHub,
} = require('./helpers');
const {
  registerExternalMcpTools,
  externalMcpTenantToken,
} = require('../../../src/core/mcp/external-tool-adapter');
const { resolveProvider } = require('../../../src/core/mcp/capability-resolution');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const {
  buildResearchPrincipal,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const {
  RESEARCH_CAPABILITY_IDS,
  executeResearchCapability,
} = require('../../../api/services/benchmark/researchCapabilities');
const mcpConnectionService = require('../../../api/services/mcp/mcpConnectionService');
const { RESEARCH_TOOLS } = require('../../../api/services/mcp/registerMcpResearchConnection');

const FIXTURE_HTML = '<!doctype html><html><head><title>Fixture Docs</title></head><body>'
  + '<h1>Fixture Platform</h1><p>Billing e cobranças para academias.</p>'
  + '<h2>Recursos</h2><ul><li>Check-ins com catraca</li><li>Agendamentos de aulas coletivas</li></ul>'
  + '</body></html>';

/** Fixture HTTP local (página de documentação) — alvo real do research_fetch. */
function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/docs') {
      const body = Buffer.from(FIXTURE_HTML, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => resolve(server));
  });
}

function parseToolResult(result) {
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { isError: result.isError === true, text, json: text ? JSON.parse(text) : null };
}

describe('mcp-research — protocolo REAL sobre StreamableHTTP', () => {
  let running;
  let fixture;
  let fixtureUrl;

  beforeAll(async () => {
    // Política TEST-ONLY no servidor: necessária para o fetch alcançar a
    // fixture local (faixa privada + plaintext). O default de produção
    // permanece estrito — verificado na suíte de segurança e no gate.
    running = await startRealService({ mode: 'ONLINE', testPolicy: true });
    fixture = await startFixtureServer();
    fixtureUrl = `http://${running.host}:${fixture.address().port}/docs`;
  });

  afterAll(async () => {
    await new Promise((resolve) => fixture.close(resolve));
    await running.stop();
  });

  test('initialize + tools/list reais via hub (5 tools com contrato)', async () => {
    const hub = buildRealHub([researchConnectionConfig(running.endpoint)]);
    const { discovery } = await hub.discoverTools('mcp-research', { tenantId: 'system' });
    const names = discovery.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(RESEARCH_TOOLS.map((tool) => tool.name).sort());
    for (const tool of discovery.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  test('research_fetch REAL contra fixture HTTP: contrato completo + hash', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const result = await hub.callTool('mcp-research', 'research_fetch', { url: fixtureUrl }, { tenantId: 'system' });
    const { isError, json } = parseToolResult(result);
    expect(isError).toBe(false);
    expect(json.httpStatus).toBe(200);
    expect(json.url).toBe(fixtureUrl);
    expect(json.canonicalUrl).toBe(fixtureUrl);
    expect(json.contentType).toContain('text/html');
    expect(json.title).toBe('Fixture Docs');
    expect(json.sizeBytes).toBe(Buffer.byteLength(json.content, 'utf8'));
    expect(json.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(json.retrievedAt).toBeTruthy();
    // O hash é do conteúdo EFETIVAMENTE devolvido.
    const crypto = require('crypto');
    expect(json.contentHash).toBe(`sha256:${crypto.createHash('sha256').update(json.content, 'utf8').digest('hex')}`);
  });

  test('ligação de hash: fetch = inspect = evidence', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const fetched = parseToolResult(await hub.callTool('mcp-research', 'research_fetch', { url: fixtureUrl }, { tenantId: 'system' })).json;

    const inspected = parseToolResult(await hub.callTool('mcp-research', 'research_inspect_documentation', {
      content: fetched.content,
      contentHash: fetched.contentHash,
      url: fetched.canonicalUrl,
    }, { tenantId: 'system' }));
    expect(inspected.isError).toBe(false);
    expect(inspected.json.contentHash).toBe(fetched.contentHash);
    expect(inspected.json.sections).toContain('Recursos');
    expect(inspected.json.capabilities.length).toBeGreaterThan(0);

    const evidence = parseToolResult(await hub.callTool('mcp-research', 'research_capture_evidence', {
      url: fetched.canonicalUrl,
      contentHash: fetched.contentHash,
      contentType: fetched.contentType,
    }, { tenantId: 'system' }));
    expect(evidence.isError).toBe(false);
    expect(evidence.json.evidenceRef).toMatch(/^ev-[0-9a-f]{40}$/);
    expect(evidence.json.contentHash).toBe(fetched.contentHash);
    expect(evidence.json.sourceUrl).toBe(fetched.canonicalUrl);

    // Determinismo: mesma (url, hash) → mesma evidência.
    const again = parseToolResult(await hub.callTool('mcp-research', 'research_capture_evidence', {
      url: fetched.canonicalUrl,
      contentHash: fetched.contentHash,
    }, { tenantId: 'system' }));
    expect(again.json.evidenceId).toBe(evidence.json.evidenceId);
  });

  test('hash divergente na inspeção é RECUSADO (research_content_hash_mismatch)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const result = await hub.callTool('mcp-research', 'research_inspect_documentation', {
      content: '<p>outro documento</p>',
      contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      url: fixtureUrl,
    }, { tenantId: 'system' });
    const { isError, json } = parseToolResult(result);
    expect(isError).toBe(true);
    expect(json.code).toBe('research_content_hash_mismatch');
  });

  test('schema malformado é rejeitado com erro tipado (nunca executado)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);

    const missing = parseToolResult(await hub.callTool('mcp-research', 'research_fetch', {}, { tenantId: 'system' }));
    expect(missing.isError).toBe(true);
    expect(missing.json.code).toBe('research_invalid_input');

    const wrongType = parseToolResult(await hub.callTool('mcp-research', 'research_fetch', { url: 123 }, { tenantId: 'system' }));
    expect(wrongType.isError).toBe(true);
    expect(wrongType.json.code).toBe('research_invalid_input');

    const unknownField = parseToolResult(await hub.callTool('mcp-research', 'research_fetch', { url: fixtureUrl, admin: true }, { tenantId: 'system' }));
    expect(unknownField.isError).toBe(true);
    expect(unknownField.json.code).toBe('research_invalid_input');

    const badMax = parseToolResult(await hub.callTool('mcp-research', 'research_search', { query: 'fitness', maxResults: 999 }, { tenantId: 'system' }));
    expect(badMax.isError).toBe(true);
    expect(badMax.json.code).toBe('research_invalid_input');
  });

  test('token não autorizado é rejeitado (401 real; hub falha fechado)', async () => {
    // Chamada HTTP crua sem bearer → 401.
    const raw = await fetch(running.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(raw.status).toBe(401);

    // Hub com credencial ERRADA: a descoberta falha — nunca degrada para anônimo.
    const wrongEnv = 'MCP_RESEARCH_WRONG_TOKEN';
    process.env[wrongEnv] = 'wrong-token-value';
    const hub = buildRealHub([researchConnectionConfig(running.endpoint, { authRef: wrongEnv })]);
    await expect(hub.discoverTools('mcp-research', { tenantId: 'system' })).rejects.toThrow();
    delete process.env[wrongEnv];
  });

  test('conexão desabilitada → recusa explícita do hub (mcp_connection_disabled)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    hub.setConnectionEnabled('mcp-research', { tenantId: 'system', enabled: false });
    await expect(
      hub.callTool('mcp-research', 'research_fetch', { url: fixtureUrl }, { tenantId: 'system' }),
    ).rejects.toThrow(/mcp_connection_disabled/);
  });

  test('mudança de schema remoto → SCHEMA_CHANGED + REVALIDATION_REQUIRED (fail-closed)', async () => {
    const hub = buildRealHub([researchConnectionConfig(running.endpoint)]);
    const { discovery } = await hub.discoverTools('mcp-research', { tenantId: 'system' });
    hub.lifecycle.validateTool('system:mcp-research', 'research_fetch');

    // O servidor passa a anunciar um CONTRATO diferente para research_fetch
    // (inputSchema alterado — o fingerprint da tool muda).
    const changedTools = discovery.tools.map((tool) => (tool.name === 'research_fetch'
      ? { ...tool, inputSchema: { type: 'object', properties: { url: { type: 'string' }, adminOverride: { type: 'boolean' } } } }
      : tool));
    hub.applyDiscovery('system', 'mcp-research', { remoteTools: changedTools });

    const availability = hub.lifecycle.getToolAvailability('system:mcp-research', 'research_fetch');
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe('mcp_tool_schema_revalidation_required');

    await expect(
      hub.callTool('mcp-research', 'research_fetch', { url: fixtureUrl }, { tenantId: 'system' }),
    ).rejects.toThrow(/mcp_tool_schema_revalidation_required/);

    // Decisão PURA de aceitação (control plane): fingerprint aceito ≠ observado
    // → SCHEMA_CHANGED com pendência; nunca promove sozinho.
    const acceptance = mcpConnectionService.evaluateSchemaAcceptance({
      acceptedFingerprint: mcpConnectionService.fingerprintTools(discovery.tools),
      observedFingerprint: mcpConnectionService.fingerprintTools(changedTools),
    });
    expect(acceptance.schemaChanged).toBe(true);
    expect(acceptance.status).toBe('SCHEMA_CHANGED');
    expect(acceptance.pendingFingerprint).toBe(acceptance.observedFingerprint);
    expect(acceptance.acceptedFingerprint).not.toBe(acceptance.observedFingerprint);
  });

  test('research principal resolve e EXECUTA pelo caminho real (adapter+registry+delegation, HTTP)', async () => {
    const hub = buildRealHub([researchConnectionConfig(running.endpoint)]);
    const registry = createToolRegistry({ logger: silent });
    const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    expect(registration.registered).toHaveLength(RESEARCH_TOOLS.length);
    expect(registration.skipped).toEqual([]);

    const principal = buildResearchPrincipal();
    const resolution = resolveProvider({ registry, capability: 'research.fetch', actor: principal });
    expect(resolution.provider).toBeTruthy();
    expect(resolution.provider.id).toBe(
      `mcp.t${externalMcpTenantToken('system')}.mcp-research.research_fetch`,
    );
    expect(resolution.reason).toBe('external_read_only_provider_selected');

    const result = await executeResearchCapability({
      registry,
      capability: 'research.fetch',
      tenantId: 'system',
      actor: principal,
      input: { url: fixtureUrl },
    });
    expect(result.provider).toBe('external');
    // O output da capability é o PAYLOAD projetado (contrato declarado), não o
    // envelope cru do adapter: a projeção vive em executeResearchCapability.
    expect(result.toolId).toMatch(/^mcp\.t/);
    expect(result.output.httpStatus).toBe(200);
    expect(result.output.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('as 5 capabilities research.* resolvem pelo proxy HTTP real', async () => {
    const hub = buildRealHub([researchConnectionConfig(running.endpoint)]);
    const registry = createToolRegistry({ logger: silent });
    await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    const principal = buildResearchPrincipal();
    for (const capability of RESEARCH_CAPABILITY_IDS) {
      const resolution = resolveProvider({ registry, capability, actor: principal });
      expect(resolution.provider).toBeTruthy();
      expect(resolution.provider.id).toContain('.mcp-research.');
    }
  });
});
