'use strict';

/**
 * Helpers da suíte mcp-research — caminho de REDE REAL (sem InMemoryTransport
 * como prova final): o servidor do container sobe numa porta efêmera e o MCP
 * Client Hub fala com ele via StreamableHTTPClientTransport de verdade.
 *
 * Política de endpoint em teste: o hub bloqueia loopback SEMPRE (127.0.0.1 não
 * é exceção nem com allowPrivateNetwork). Por isso os testes sobem o servidor
 * em 0.0.0.0 e conectam pelo IPv4 PRIVADO não-loopback da máquina (ex.: a
 * interface docker0, 172.17.0.1) — faixa privada é exceção EXPLÍCITA e
 * auditável da política (allowPrivateNetwork, apenas não-PRODUCTION), a mesma
 * exceção usada em produção para alcançar o container na rede do compose.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const dns = require('dns');
const os = require('os');
const path = require('path');

const { createService } = require('../../../services/mcp-research/src/index.js');
const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const {
  RESEARCH_TOOLS,
} = require('../../../api/services/mcp/registerMcpResearchConnection');
const {
  RESEARCH_CAPABILITY_IDS,
} = require('../../../api/services/benchmark/researchCapabilities');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const TEST_TOKEN = 'jest-mcp-research-token-0123456789abcdef';
const TOKEN_ENV = 'MCP_RESEARCH_TEST_TOKEN';
process.env[TOKEN_ENV] = TEST_TOKEN;

const SNAPSHOT_DIR = path.join(__dirname, 'fixtures', 'snapshot');

/** IPv4 PRIVADO não-loopback da máquina (única faixa que a política excetua). */
function findPrivateTestHost() {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const entry of list || []) {
      const family = typeof entry.family === 'string' ? entry.family : (entry.family === 4 ? 'IPv4' : 'IPv6');
      if (family !== 'IPv4' || entry.internal) continue;
      const [a, b] = String(entry.address).split('.').map(Number);
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return entry.address;
      }
    }
  }
  throw new Error('mcp_research_test_host_unavailable: nenhuma interface IPv4 privada não-loopback');
}

async function defaultDnsLookup(hostname) {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((entry) => entry.address);
}

/**
 * Sobe o serviço REAL numa porta efêmera.
 *
 * @param {object} [args]
 * @param {string} [args.mode] ONLINE|OFFLINE (default ONLINE)
 * @param {object} [args.providerDeps] injeção do provider (testes de política)
 * @param {boolean} [args.testPolicy] habilita as exceções TEST-ONLY de política
 *   de endpoint NO SERVIDOR (necessário para o fetch real contra fixture local)
 */
async function startRealService({ mode = 'ONLINE', providerDeps = {}, testPolicy = false, token = TEST_TOKEN } = {}) {
  const env = {
    MCP_RESEARCH_TOKEN: token,
    MCP_RESEARCH_MODE: mode,
    MCP_RESEARCH_PORT: '0',
    MCP_RESEARCH_HOST: '0.0.0.0',
    MCP_RESEARCH_SNAPSHOT_DIR: SNAPSHOT_DIR,
  };
  if (testPolicy) {
    env.MCP_RESEARCH_ALLOW_PRIVATE_NETWORK = 'true';
    env.MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP = 'true';
  }
  const service = createService({ env, providerDeps, logger: silent });
  await service.http.start();
  const port = service.http.server.address().port;
  const host = findPrivateTestHost();
  return {
    service,
    host,
    port,
    endpoint: `http://${host}:${port}/mcp`,
    stop: () => service.http.stop(),
  };
}

/** Config de conexão PERSISTÍVEL-equivalente para o hub (escopo fechado real). */
function researchConnectionConfig(endpoint, overrides = {}) {
  return {
    tenant: 'system',
    name: 'mcp-research',
    endpoint,
    enabled: true,
    classification: 'DEVELOPMENT',
    authType: 'bearer',
    authRef: TOKEN_ENV,
    endpointPolicy: { allowPlaintextHttp: true, allowPrivateNetwork: true, maxRedirects: 0 },
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    allowedTools: RESEARCH_TOOLS.map((tool) => tool.name),
    toolCapabilityMap: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, tool.capability])),
    toolPolicies: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, {
      sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
    }])),
    delegatedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    ...overrides,
  };
}

/** Hub REAL (sem transportFactory): StreamableHTTP + DNS revalidado. */
function buildRealHub(connections, { audit } = {}) {
  return createMcpClientHub({
    connections,
    logger: silent,
    audit,
    dnsLookup: defaultDnsLookup,
  });
}

/**
 * Hub pronto para callTool: descoberta REAL + validação explícita das tools
 * (a mesma ativação que registerExternalMcpTools faz no caminho de produção).
 */
async function buildReadyHub(endpoint, overrides = {}) {
  const hub = buildRealHub([researchConnectionConfig(endpoint, overrides)]);
  const { discovery } = await hub.discoverTools('mcp-research', { tenantId: 'system' });
  for (const tool of discovery.tools) {
    hub.lifecycle.validateTool('system:mcp-research', tool.name);
  }
  return { hub, discovery };
}

module.exports = {
  silent,
  TEST_TOKEN,
  TOKEN_ENV,
  SNAPSHOT_DIR,
  findPrivateTestHost,
  startRealService,
  researchConnectionConfig,
  buildRealHub,
  buildReadyHub,
};
