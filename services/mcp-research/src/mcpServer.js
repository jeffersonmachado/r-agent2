'use strict';

/**
 * Servidor MCP (SDK oficial @modelcontextprotocol/sdk) do container de
 * pesquisa. Mesmo padrão do server-adapter da plataforma
 * (src/core/mcp/server-adapter.js): Server + setRequestHandler para
 * ListToolsRequestSchema / CallToolRequestSchema; o HTTP Streamable fica no
 * transporte (httpServer.js), em modo STATELESS (um Server por request).
 *
 * Erros de tool NUNCA vazam stack nem segredo: { error, code } tipado com
 * isError:true — o cliente governado decide o que fazer.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const SERVER_INFO = Object.freeze({ name: 'rap-mcp-research', version: '1.0.0' });

/**
 * @param {object} args
 * @param {Array}  args.toolDefinitions  TOOL_DEFINITIONS
 * @param {object} args.handlers         nome da tool → função async (input)
 * @param {object} [args.logger]
 * @returns {Server}
 */
function createMcpResearchServer({ toolDefinitions, handlers, logger } = {}) {
  if (!Array.isArray(toolDefinitions) || toolDefinitions.length === 0) {
    throw new Error('mcp_research_server_tools_required');
  }
  if (!handlers || typeof handlers !== 'object') {
    throw new Error('mcp_research_server_handlers_required');
  }

  const server = new Server(
    { name: SERVER_INFO.name, version: SERVER_INFO.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params || {};
    const handler = handlers[name];
    if (typeof handler !== 'function') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `unknown tool: ${name}`, code: 'research_unknown_tool' }) }],
        isError: true,
      };
    }
    try {
      const output = await handler(args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(output ?? null) }],
        isError: false,
      };
    } catch (error) {
      logger?.warn?.('[mcp-research] tool call falhou', { tool: name, code: error?.code || 'tool_call_failed' });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error?.message || 'tool_call_failed',
            code: error?.code || 'tool_call_failed',
          }),
        }],
        isError: true,
      };
    }
  });

  return server;
}

module.exports = { SERVER_INFO, createMcpResearchServer };
