#!/usr/bin/env node
'use strict';

/**
 * Smoke REAL do container mcp-research — o MCP Client Hub da plataforma
 * (StreamableHTTPClientTransport, DNS revalidado, política de endpoint, bearer)
 * fala com o container Docker em execução.
 *
 * Uso:
 *   node scripts/smoke/mcp-research-container-smoke.js --endpoint http://<ip>:8080/mcp
 *
 * Env:
 *   MCP_RESEARCH_SMOKE_ENDPOINT   endpoint MCP do container (alternativa ao flag)
 *   MCP_RESEARCH_TOKEN            bearer serviço-a-serviço (o mesmo do container)
 *
 * O endpoint NUNCA é loopback: a política do hub bloqueia 127.0.0.1 em qualquer
 * classificação. Use o IP do container na rede docker (privado RFC1918 —
 * exceção explícita allowPrivateNetwork + classificação DEVELOPMENT, a mesma
 * da conexão persistida em produção).
 *
 * Provas executadas:
 *   1. tools/list real (5 tools research_*);
 *   2. tools/call research_fetch real (container em OFFLINE lê o snapshot);
 *   3. ligação de hash fetch → inspect;
 *   4. token errado → recusa;
 *   5. conexão desabilitada → mcp_connection_disabled.
 */

const dns = require('dns');

const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { RESEARCH_TOOLS } = require('../../api/services/mcp/registerMcpResearchConnection');
const { RESEARCH_CAPABILITY_IDS } = require('../../api/services/benchmark/researchCapabilities');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function defaultDnsLookup(hostname) {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((entry) => entry.address);
}

function parseArgs(argv) {
  const args = { endpoint: process.env.MCP_RESEARCH_SMOKE_ENDPOINT || null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--endpoint') args.endpoint = argv[i + 1];
  }
  return args;
}

function parseToolResult(result) {
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { isError: result.isError === true, json: text ? JSON.parse(text) : null };
}

async function main() {
  const { endpoint } = parseArgs(process.argv);
  const token = process.env.MCP_RESEARCH_TOKEN;
  if (!endpoint) throw new Error('endpoint obrigatório (--endpoint ou MCP_RESEARCH_SMOKE_ENDPOINT)');
  if (!token) throw new Error('MCP_RESEARCH_TOKEN obrigatória');

  // A credencial é REFERÊNCIA (nome de env), nunca valor — mesmo contrato do hub.
  process.env.MCP_RESEARCH_SMOKE_TOKEN = token;

  const connection = {
    tenant: 'system',
    name: 'mcp-research',
    endpoint,
    enabled: true,
    classification: 'DEVELOPMENT',
    authType: 'bearer',
    authRef: 'MCP_RESEARCH_SMOKE_TOKEN',
    endpointPolicy: { allowPlaintextHttp: true, allowPrivateNetwork: true, maxRedirects: 0 },
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    allowedTools: RESEARCH_TOOLS.map((tool) => tool.name),
    toolCapabilityMap: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, tool.capability])),
    toolPolicies: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, {
      sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
    }])),
    delegatedCapabilities: [...RESEARCH_CAPABILITY_IDS],
  };

  const hub = createMcpClientHub({ connections: [connection], logger: silent, dnsLookup: defaultDnsLookup });
  const summary = { endpoint, checks: {} };

  // 1. tools/list REAL
  const { discovery } = await hub.discoverTools('mcp-research', { tenantId: 'system' });
  const names = discovery.tools.map((tool) => tool.name).sort();
  for (const tool of discovery.tools) {
    hub.lifecycle.validateTool('system:mcp-research', tool.name);
  }
  summary.checks.toolsList = names;
  if (names.length !== 5) throw new Error(`esperava 5 tools, veio ${names.length}: ${names.join(',')}`);

  // 2. tools/call REAL (container OFFLINE lê o snapshot montado)
  const fetched = parseToolResult(await hub.callTool('mcp-research', 'research_fetch', {
    url: 'https://docs.acme-fitness.example/platform',
  }, { tenantId: 'system' }));
  if (fetched.isError) throw new Error(`research_fetch falhou: ${JSON.stringify(fetched.json)}`);
  summary.checks.fetch = {
    status: fetched.json.status,
    contentHash: fetched.json.contentHash,
    title: fetched.json.title,
    mode: fetched.json.providerMetadata?.mode,
  };

  // 3. ligação de hash fetch → inspect
  const inspected = parseToolResult(await hub.callTool('mcp-research', 'research_inspect_documentation', {
    content: fetched.json.content,
    contentHash: fetched.json.contentHash,
    url: fetched.json.canonicalUrl,
  }, { tenantId: 'system' }));
  if (inspected.isError) throw new Error(`inspect falhou: ${JSON.stringify(inspected.json)}`);
  summary.checks.hashBinding = {
    inspectedHash: inspected.json.contentHash,
    matches: inspected.json.contentHash === fetched.json.contentHash,
    capabilities: inspected.json.capabilities.length,
  };
  if (!summary.checks.hashBinding.matches) throw new Error('hash binding quebrado fetch→inspect');

  // 4. token errado → recusa
  process.env.MCP_RESEARCH_SMOKE_TOKEN = 'wrong-token';
  const badHub = createMcpClientHub({ connections: [connection], logger: silent, dnsLookup: defaultDnsLookup });
  let rejected = false;
  try {
    await badHub.discoverTools('mcp-research', { tenantId: 'system' });
  } catch (_) {
    rejected = true;
  }
  summary.checks.wrongTokenRejected = rejected;
  if (!rejected) throw new Error('token errado NÃO foi rejeitado');
  process.env.MCP_RESEARCH_SMOKE_TOKEN = token;

  // 5. conexão desabilitada → recusa do hub
  hub.setConnectionEnabled('mcp-research', { tenantId: 'system', enabled: false });
  let disabledRefused = false;
  try {
    await hub.callTool('mcp-research', 'research_fetch', { url: 'https://docs.acme-fitness.example/platform' }, { tenantId: 'system' });
  } catch (error) {
    disabledRefused = /mcp_connection_disabled/.test(error.message);
  }
  summary.checks.disabledRefused = disabledRefused;
  if (!disabledRefused) throw new Error('conexão desabilitada NÃO foi recusada');

  summary.ok = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`mcp-research container smoke FALHOU: ${error.message}\n`);
  process.exit(1);
});
