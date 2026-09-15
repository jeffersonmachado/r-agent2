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
 *
 * O Control Plane (Client Hub) aplica, nesta ordem:
 *   política de endpoint (SSRF/TLS/DNS rebinding)
 *     → credencial por referência (nunca em claro)
 *     → descoberta de tools + fingerprint de schema
 *     → ciclo de vida (discovered/validated/enabled/degraded/schema_changed)
 *     → política POR TOOL (risco, side effect, confirmação, idempotência)
 *     → circuit breaker + timeout + retry policy
 *     → redaction de output + auditoria/métricas.
 */

const { createMcpServerAdapter } = require('./server-adapter');
const { createMcpClientHub, validateConnection, AUTH_MODES } = require('./client-hub');
const {
  registerExternalMcpTools,
  revokeExternalMcpConnection,
  externalMcpTenantToken,
  externalMcpConnectionScope,
  resolveCapability,
} = require('./external-tool-adapter');
const connectionDelegation = require('./connection-delegation');
const { buildMcpExecutionContext, stripTenantOverride } = require('./auth');
const endpointPolicy = require('./endpoint-policy');
const toolPolicy = require('./tool-policy');
const toolLifecycle = require('./tool-lifecycle');
const observability = require('./observability');

module.exports = {
  createMcpServerAdapter,
  createMcpClientHub,
  validateConnection,
  AUTH_MODES,
  registerExternalMcpTools,
  revokeExternalMcpConnection,
  externalMcpTenantToken,
  externalMcpConnectionScope,
  resolveCapability,
  connectionDelegation,
  buildMcpExecutionContext,
  stripTenantOverride,
  endpointPolicy,
  toolPolicy,
  toolLifecycle,
  observability,
};
