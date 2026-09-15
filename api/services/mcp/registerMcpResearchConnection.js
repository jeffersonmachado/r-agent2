'use strict';

/**
 * Auto-registro da conexão MCP do container de pesquisa (mcp-research).
 *
 * Quando `MCP_RESEARCH_ENDPOINT` está configurado (ex.:
 * `http://mcp-research:8080/mcp` no compose), o startup do MCP Client persiste
 * a conexão `system/mcp-research` — DEVELOPMENT, escopo fechado, delegação
 * EXPLÍCITA das 5 capabilities `research.*` — sem clique manual. Idempotente:
 * a chave (tenant, name) impede duplicação entre startups; drift de config é
 * reconciliado via update (o control plane é a autoridade).
 *
 * Fail-closed:
 *  - sem MCP_RESEARCH_ENDPOINT → ausência EXPLÍCITA (nunca conexão inventada);
 *  - endpoint fora da política → erro do control plane (propagado);
 *  - delegatedCapabilities com wildcard/fora do escopo → recusado pelo
 *    validador canônico (connection-delegation);
 *  - segredo nunca persistido: `credentialRef` é o NOME da env
 *    (`MCP_RESEARCH_TOKEN`), resolvido em runtime.
 *
 * Restrição de host: o endpoint é validado contra a política DEVELOPMENT
 * (plaintext http + rede privada permitidos APENAS porque o container vive na
 * rede interna do compose) e o hostname declarado é fixado em
 * `metadata.allowedHosts` para auditoria; a guarda de runtime continua sendo
 * DNS revalidado + política de endpoint do Client Hub.
 */

const logger = require('../../utils/logger');
const { RESEARCH_CAPABILITY_IDS } = require('../benchmark/researchCapabilities');

const CONNECTION_NAME = 'mcp-research';
const TENANT = 'system';
const CREDENTIAL_REF = 'MCP_RESEARCH_TOKEN';

/** Ferramentas expostas pelo container (paridade com TOOL_CAPABILITY_MAP). */
const RESEARCH_TOOLS = Object.freeze([
  Object.freeze({ name: 'research_search', capability: 'research.search' }),
  Object.freeze({ name: 'research_fetch', capability: 'research.fetch' }),
  Object.freeze({ name: 'research_inspect_documentation', capability: 'research.inspectDocumentation' }),
  Object.freeze({ name: 'research_inspect_api_docs', capability: 'research.inspectApiDocs' }),
  Object.freeze({ name: 'research_capture_evidence', capability: 'research.captureEvidence' }),
]);

const READ_ONLY_TOOL_POLICY = Object.freeze({
  sideEffects: false,
  riskLevel: 'low',
  confirmationPolicy: 'autonomous',
  idempotencyPolicy: 'none',
});

function buildConnectionInput(endpoint) {
  const normalized = String(endpoint || '').trim();
  return {
    name: CONNECTION_NAME,
    endpoint: normalized,
    transport: 'http',
    authType: 'bearer',
    credentialRef: CREDENTIAL_REF,
    enabled: true,
    classificationCeiling: 'DEVELOPMENT',
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    allowedTools: RESEARCH_TOOLS.map((tool) => tool.name),
    toolCapabilityMap: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, tool.capability])),
    toolPolicies: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, { ...READ_ONLY_TOOL_POLICY }])),
    delegatedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    endpointPolicy: {
      // O container vive na rede interna do compose (DNS `mcp-research` → IP
      // privado RFC1918) e fala HTTP plaintext interno — exceções EXPLÍCITAS,
      // válidas somente porque a classificação é DEVELOPMENT (nunca PRODUCTION).
      allowPlaintextHttp: true,
      allowPrivateNetwork: true,
      maxRedirects: 0,
    },
    timeoutMs: 30000,
    retryPolicy: { attempts: 2 },
  };
}

function shallowEqualJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Detecta drift entre a config persistida e a desejada (campos operacionais). */
function connectionDrift(record, desired) {
  const current = record || {};
  const currentEndpoint = String(current.endpoint || '');
  if (currentEndpoint !== desired.endpoint) return 'endpoint';
  if (String(current.classification_ceiling || current.classificationCeiling || '') !== desired.classificationCeiling) return 'classification';
  // `enabled` NÃO é drift: um disable administrativo é decisão do operador e
  // jamais é revertido pelo bootstrap.
  if (String(current.credential_ref || current.credentialRef || '') !== desired.credentialRef) return 'credentialRef';
  if (!shallowEqualJson(current.tool_capability_map || current.toolCapabilityMap, desired.toolCapabilityMap)) return 'toolCapabilityMap';
  if (!shallowEqualJson(current.delegated_capabilities || current.delegatedCapabilities, desired.delegatedCapabilities)) return 'delegatedCapabilities';
  if (!shallowEqualJson(current.allowed_capabilities || current.allowedCapabilities, desired.allowedCapabilities)) return 'allowedCapabilities';
  if (!shallowEqualJson(current.allowed_tools || current.allowedTools, desired.allowedTools)) return 'allowedTools';
  if (!shallowEqualJson(current.tool_policies || current.toolPolicies, desired.toolPolicies)) return 'toolPolicies';
  if (!shallowEqualJson(current.endpoint_policy || current.endpointPolicy, desired.endpointPolicy)) return 'endpointPolicy';
  return null;
}

/**
 * Registra (ou reconcilia) a conexão do container de pesquisa.
 *
 * @param {object} [args]
 * @param {string} [args.endpoint]  default: env MCP_RESEARCH_ENDPOINT
 * @param {string} [args.actor]
 * @param {object} [args.service]   default: api/services/mcp/mcpConnectionService
 * @param {object} [args.log]
 * @returns {Promise<{registered: boolean, action: string, reason?: string, id?: string, drift?: string}>}
 */
async function registerMcpResearchConnection({ endpoint, actor = 'mcp-research-bootstrap', service, log } = {}) {
  const logger_ = log || logger;
  const resolvedEndpoint = String(endpoint || process.env.MCP_RESEARCH_ENDPOINT || '').trim();
  if (!resolvedEndpoint) {
    return { registered: false, action: 'skipped', reason: 'mcp_research_endpoint_not_configured' };
  }

  const connectionService = service || require('./mcpConnectionService');
  const desired = buildConnectionInput(resolvedEndpoint);

  let hostname = null;
  try {
    hostname = new URL(desired.endpoint).hostname.toLowerCase();
  } catch (_) {
    throw new Error(`mcp_research_endpoint_invalid: ${desired.endpoint}`);
  }

  const existing = (await connectionService.listConnections({ tenantId: TENANT }))
    .find((record) => String(record.name) === CONNECTION_NAME);

  if (!existing) {
    const created = await connectionService.createConnection({ tenantId: TENANT, input: desired, actor });
    // Host pinning auditável (a guarda de runtime é DNS + política de endpoint).
    await connectionService.updateConnection({
      tenantId: TENANT,
      id: created.id,
      patch: { metadata: { allowedHosts: [hostname], provisionedBy: 'registerMcpResearchConnection' } },
      actor,
    });
    logger_.info('[McpResearchBootstrap] conexão mcp-research persistida', { id: created.id, endpoint: desired.endpoint });
    return { registered: true, action: 'created', id: created.id };
  }

  const drift = connectionDrift(existing, desired);
  if (!drift) {
    return { registered: true, action: 'already_registered', id: existing.id };
  }

  const updated = await connectionService.updateConnection({
    tenantId: TENANT,
    id: existing.id,
    patch: {
      endpoint: desired.endpoint,
      authType: desired.authType,
      credentialRef: desired.credentialRef,
      classificationCeiling: desired.classificationCeiling,
      allowedCapabilities: desired.allowedCapabilities,
      allowedTools: desired.allowedTools,
      toolCapabilityMap: desired.toolCapabilityMap,
      toolPolicies: desired.toolPolicies,
      delegatedCapabilities: desired.delegatedCapabilities,
      endpointPolicy: desired.endpointPolicy,
      timeoutMs: desired.timeoutMs,
      retryPolicy: desired.retryPolicy,
      metadata: { allowedHosts: [hostname], provisionedBy: 'registerMcpResearchConnection' },
    },
    actor,
  });
  logger_.info('[McpResearchBootstrap] conexão mcp-research reconciliada', { id: updated.id, drift });
  return { registered: true, action: 'updated', id: updated.id, drift };
}

module.exports = {
  CONNECTION_NAME,
  TENANT,
  CREDENTIAL_REF,
  RESEARCH_TOOLS,
  buildConnectionInput,
  registerMcpResearchConnection,
};
