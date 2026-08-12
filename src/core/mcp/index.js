'use strict';

/**
 * RAP MCP — Agent Capability Interoperability Protocol.
 *
 * MCP NÃO substitui REST, WebSocket, Event Fabric, Domain Services nem o
 * Process Runtime. O Canonical Tool Registry é a fonte da verdade:
 *
 *              Canonical Tool Registry
 *                     │
 *       ┌─────────────┼─────────────┐
 *       │             │             │
 *  Native Agent   MCP Server    External MCP
 *  (Cognitive)   (adapter)      (Client Hub)
 */

const { createMcpServerAdapter } = require('./server-adapter');
const { createMcpClientHub, validateConnection } = require('./client-hub');
const { registerExternalMcpTools } = require('./external-tool-adapter');
const { buildMcpExecutionContext, stripTenantOverride } = require('./auth');

module.exports = {
  createMcpServerAdapter,
  createMcpClientHub,
  validateConnection,
  registerExternalMcpTools,
  buildMcpExecutionContext,
  stripTenantOverride,
};
