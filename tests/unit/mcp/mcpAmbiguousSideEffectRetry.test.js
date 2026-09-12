'use strict';

/**
 * T9 — resultado AMBÍGUO após timeout não pode ser repetido às cegas.
 *
 * Defeito reproduzido (2026-09-12): `src/core/mcp/client-hub.js` documenta no
 * loop de retry:
 *
 *   "Side effect sem idempotência garantida NUNCA é reexecutado às cegas
 *    (operação ambígua) — 1 tentativa."
 *
 * …mas o código NÃO implementava a regra: `attempts` vinha apenas de
 * `toolPolicy.retryPolicy.attempts` / `connection.retryPolicy.attempts`, sem
 * olhar `sideEffects`. Uma política explícita com `attempts: 3` em tool de
 * escrita repetia a operação 3 vezes — e, num timeout, a primeira tentativa pode
 * TER SIDO APLICADA no provedor remoto. O retry cego duplicaria o efeito.
 *
 * O servidor externo é FAKE porém REAL no protocolo (SDK oficial via
 * `InMemoryTransport`): o transporte é o de verdade, não um mock de negócio.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'tenant-a';
const CONNECTION_KEY = `${TENANT}:erp`;

const SIDE_EFFECT_POLICY = {
  sideEffects: true,
  confirmationPolicy: 'autonomous',
  retryPolicy: { attempts: 3 },
};
const IDEMPOTENT_POLICY = { ...SIDE_EFFECT_POLICY, idempotent: true };
const READ_ONLY_POLICY = {
  sideEffects: false,
  confirmationPolicy: 'autonomous',
  retryPolicy: { attempts: 3 },
};

/** Servidor MCP externo real no protocolo; toda chamada conta e falha (timeout). */
function createCountingServer(toolName) {
  const state = { calls: 0 };
  const server = new Server({ name: 'fake-external-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: toolName,
      description: 'tool de teste',
      inputSchema: { type: 'object', additionalProperties: true },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    state.calls += 1;
    // Timeout: a operação pode ter sido aplicada no remoto — resultado AMBÍGUO.
    throw new Error('timeout: resposta do provedor não recebida');
  });
  return { server, state };
}

/**
 * Hub pronto para executar: descobre E valida a tool (o hub é fail-closed e
 * exige `validated`, senão a chamada nem chega ao loop de retry).
 */
async function readyHub(server, toolName, callAudit) {
  const hub = createMcpClientHub({
    logger: silent,
    audit: callAudit,
    connections: [{
      tenant: TENANT,
      name: 'erp',
      endpoint: 'https://erp.example.com/mcp',
      enabled: true,
      classification: 'PRODUCTION',
      allowedCapabilities: ['payments.write', 'crm.read'],
      toolCapabilityMap: { 'payments.refund': 'payments.write', 'crm.lookupCustomer': 'crm.read' },
    }],
    transportFactory: () => {
      const pair = InMemoryTransport.createLinkedPair();
      server.connect(pair[1]);
      return pair[0];
    },
  });
  await hub.discoverTools('erp', { tenantId: TENANT });
  hub.lifecycle.validateTool(CONNECTION_KEY, toolName);
  return hub;
}

describe('T9 — ambiguidade pós-timeout em MCP externo', () => {
  test('side effect NÃO é reexecutado: 1 tentativa mesmo com retryPolicy.attempts=3', async () => {
    const { server, state } = createCountingServer('payments.refund');
    const hub = await readyHub(server, 'payments.refund');

    await expect(hub.callTool('erp', 'payments.refund', { amount: 10 }, {
      tenantId: TENANT,
      toolPolicy: SIDE_EFFECT_POLICY,
    })).rejects.toThrow(/mcp_call_failed/);

    // A REGRA: operação ambígua de escrita não se repete. Antes da correção
    // este valor era 3.
    expect(state.calls).toBe(1);
  });

  test('a decisão de não repetir é AUDITÁVEL (não é silêncio)', async () => {
    const { server } = createCountingServer('payments.refund');
    const events = [];
    const hub = await readyHub(server, 'payments.refund', (event) => events.push(event));

    await expect(hub.callTool('erp', 'payments.refund', { amount: 10 }, {
      tenantId: TENANT,
      toolPolicy: SIDE_EFFECT_POLICY,
    })).rejects.toThrow(/mcp_call_failed/);

    const withheld = events.find((e) => e.outcome === 'retry_withheld');
    expect(withheld).toBeTruthy();
    expect(withheld.reason).toMatch(/ambiguous|side_effect/i);
  });

  test('leitura (sem side effect) CONTINUA repetindo conforme a política', async () => {
    const { server, state } = createCountingServer('crm.lookupCustomer');
    const hub = await readyHub(server, 'crm.lookupCustomer');

    await expect(hub.callTool('erp', 'crm.lookupCustomer', {}, {
      tenantId: TENANT,
      toolPolicy: READ_ONLY_POLICY,
    })).rejects.toThrow(/mcp_call_failed/);

    // Controle positivo: a correção não pode matar retry legítimo de leitura.
    expect(state.calls).toBe(3);
  });

  test('side effect IDEMPOTENTE declarado pode repetir', async () => {
    const { server, state } = createCountingServer('payments.refund');
    const hub = await readyHub(server, 'payments.refund');

    await expect(hub.callTool('erp', 'payments.refund', { amount: 10 }, {
      tenantId: TENANT,
      toolPolicy: IDEMPOTENT_POLICY,
    })).rejects.toThrow(/mcp_call_failed/);

    expect(state.calls).toBe(3);
  });
});
