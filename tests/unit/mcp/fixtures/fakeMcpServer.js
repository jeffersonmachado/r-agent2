'use strict';

/**
 * Fixture de teste: servidor MCP externo FAKE porém REAL no protocolo.
 *
 * Usa o SDK oficial (`Server` + `InMemoryTransport`): os handlers são de verdade,
 * o protocolo é o de verdade, e o cliente do RAP (client-hub) fala com ele pelo
 * caminho real de conexão/`tools/list`/`callTool`. Nada aqui é mock de negócio.
 *
 * REGRA: este arquivo vive em `tests/` e NUNCA é usado por código de runtime. O
 * gate `validate:mcp-control-plane` (invariante `no_fake_mcp_in_production`)
 * proíbe qualquer fallback fake nos arquivos de runtime MCP.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

/**
 * @param {object} args
 * @param {Array|Function} args.tools  inventário fixo ou função (permite mudar schema entre descobertas)
 * @param {Function} [args.callTool]   handler de `tools/call`
 * @param {object} [args.serverInfo]
 * @param {Array} [args.capabilities]  capabilities anunciadas pelo servidor
 */
function createFakeMcpServer({ tools = [], callTool = null, serverInfo, capabilities } = {}) {
  const state = { listCalls: 0, callCalls: 0 };
  const server = new Server(
    serverInfo || { name: 'fixture-external-mcp', version: '1.0.0' },
    capabilities || { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    state.listCalls += 1;
    const inventory = typeof tools === 'function' ? tools() : tools;
    return { tools: Array.isArray(inventory) ? inventory : [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    state.callCalls += 1;
    if (typeof callTool === 'function') return callTool(request);
    return { content: [{ type: 'text', text: `fixture:${request.params.name}` }] };
  });

  return { server, state };
}

/**
 * Transport factory para o `createMcpClientHub`/discovery service: cria um par
 * ligado NOVO por conexão (o cliente fecha o transporte ao final de cada
 * operação) e captura os headers de autenticação realmente montados.
 */
function createFixtureTransportFactory({ server, state = null, onAuthHeaders = null } = {}) {
  const calls = [];
  const factory = (connection, authHeaders) => {
    calls.push({ connection: connection?.name || null, authHeaders: { ...(authHeaders || {}) } });
    if (typeof onAuthHeaders === 'function') onAuthHeaders(authHeaders || {});
    const pair = InMemoryTransport.createLinkedPair();
    server.connect(pair[1]);
    return pair[0];
  };
  factory.calls = calls;
  return factory;
}

/** Transport factory que sempre falha — prova que falha de transporte NÃO vira sucesso. */
function createFailingTransportFactory(message = 'ECONNREFUSED: fixture indisponível') {
  return () => { throw new Error(message); };
}

module.exports = {
  createFakeMcpServer,
  createFixtureTransportFactory,
  createFailingTransportFactory,
};
