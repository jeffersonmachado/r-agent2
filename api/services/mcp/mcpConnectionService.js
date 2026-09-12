'use strict';

/**
 * mcpConnectionService — CONTROL PLANE PERSISTENTE das conexões MCP externas
 * (§M1–M12 da missão corretiva).
 *
 * Antes: conexões vinham de `config.get('mcp.connections')` (config estática) e
 * viviam no estado em memória do client hub. Não havia ciclo de vida, histórico
 * de saúde, detecção de mudança de schema, auditoria por tenant nem
 * habilitar/desabilitar sem reiniciar.
 *
 * Agora o BANCO é a autoridade (§M6). A config legada permanece suportada apenas
 * como bootstrap determinístico e idempotente (§M7) — nunca reimportando a cada
 * startup (a chave `(tenant_key, name)` impede duplicação).
 *
 * Provider-neutral: nada aqui conhece vendor, remote tool name ou provider. O
 * Canonical Tool Registry continua sendo a autoridade de runtime dos tools (§M5).
 *
 * Segredo: apenas `credential_ref` (§M4). Endpoint restrito é recusado na
 * criação e na alteração reusando a política canônica (§M19/§M20).
 */

const crypto = require('crypto');

const { getMcpConnectionModel } = require('../../db/models/McpConnection');
const { evaluateEndpoint } = require('../../../src/core/mcp/endpoint-policy');
const { evaluateAuthModeUse, AUTH_CAPABILITIES } = require('../../../src/core/mcp/auth-capabilities');

/** §M10 — estados de ciclo de vida persistidos (nunca só memória). */
const LIFECYCLE_STATES = Object.freeze({
  CONFIGURED: 'CONFIGURED',
  VALIDATING: 'VALIDATING',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  SCHEMA_CHANGED: 'SCHEMA_CHANGED',
  DISABLED: 'DISABLED',
});

const ERROR_CODES = Object.freeze({
  INVALID: 'mcp_connection_invalid',
  NOT_FOUND: 'mcp_connection_not_found',
  DUPLICATE: 'mcp_connection_duplicate',
  ENDPOINT_BLOCKED: 'mcp_endpoint_blocked',
  AUTH_FORBIDDEN: 'mcp_auth_forbidden',
  PERSISTENCE_REQUIRED: 'persistence_required',
});

function serviceError(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/** Fingerprint estável do inventário de tools remotas (§M12). */
function fingerprintTools(tools) {
  const names = (Array.isArray(tools) ? tools : [])
    .map((tool) => ({
      name: String(tool && (tool.name || tool.toolName) || ''),
      input: String(tool && tool.inputSchema ? JSON.stringify(tool.inputSchema) : ''),
      output: String(tool && tool.outputSchema ? JSON.stringify(tool.outputSchema) : ''),
    }))
    .filter((tool) => tool.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return crypto.createHash('sha256').update(JSON.stringify(names)).digest('hex');
}

function normalizeConnectionInput(input = {}) {
  return {
    name: String(input.name || '').trim(),
    endpoint: String(input.endpoint || '').trim(),
    transport: String(input.transport || 'http').trim().toLowerCase(),
    authType: String(input.authType || 'bearer').trim().toLowerCase(),
    credentialRef: input.credentialRef ? String(input.credentialRef).trim() : null,
    enabled: input.enabled === true,
    classificationCeiling: String(input.classificationCeiling || 'PRODUCTION').toUpperCase(),
    allowedHosts: Array.isArray(input.allowedHosts) ? input.allowedHosts : undefined,
  };
}

/**
 * Valida endpoint contra a política canônica (SSRF, loopback, link-local,
 * metadata, faixas privadas, protocolo) na classificação de teto da conexão.
 * Reusada na criação, na alteração e antes da conexão (§M20).
 */
function assertEndpointAllowed(endpoint, { classification = 'PRODUCTION', allowedHosts, policy } = {}) {
  const decision = evaluateEndpoint({ endpoint, classification, policy });
  if (!decision || decision.allowed !== true) {
    throw serviceError(
      ERROR_CODES.ENDPOINT_BLOCKED,
      `endpoint recusado pela política (${decision && decision.code ? decision.code : 'unknown'})`,
      { decision },
    );
  }
  return decision;
}

/** §M13/§M14: recusa modo não implementado e no_auth em PRODUCTION. */
function assertAuthAllowed(authType, classification) {
  const use = evaluateAuthModeUse(authType, { classification });
  if (!use.ok) {
    throw serviceError(ERROR_CODES.AUTH_FORBIDDEN, use.reason || 'auth mode recusado', { authState: use.state });
  }
  return use;
}

function assertSecretNotInline(input) {
  const raw = JSON.stringify(input || {});
  // Nenhum campo pode carregar segredo em claro (§M4).
  const suspicious = /("(?:secret|password|apiKey|api_key|token|clientSecret)"\s*:\s*"[^"]{4,}")/i;
  if (suspicious.test(raw)) {
    throw serviceError(ERROR_CODES.INVALID, 'segredo em claro recusado — use credentialRef');
  }
}

async function listConnections({ tenantId, includeDisabled = true } = {}) {
  const Model = getMcpConnectionModel();
  if (!Model || typeof Model.findAll !== 'function') {
    throw serviceError(ERROR_CODES.PERSISTENCE_REQUIRED, 'modelo McpConnection indisponível');
  }
  const where = { tenant_key: String(tenantId) };
  if (!includeDisabled) where.enabled = true;
  const rows = await Model.findAll({ where, order: [['name', 'ASC']] });
  return rows.map((row) => (row.toJSON ? row.toJSON() : row));
}

/** §M6 — o runtime carrega da fonte persistente oficial. */
async function listEnabledConnections({ tenantId }) {
  return listConnections({ tenantId, includeDisabled: false });
}

async function getConnection({ tenantId, id }) {
  const Model = getMcpConnectionModel();
  const row = await Model.findOne({ where: { id: String(id), tenant_key: String(tenantId) } });
  // Ausência de posse devolve NOT_FOUND — não vaza existência (§M cross-tenant).
  if (!row) throw serviceError(ERROR_CODES.NOT_FOUND, `conexão não encontrada: ${id}`);
  return row.toJSON ? row.toJSON() : row;
}

async function createConnection({ tenantId, input, actor = null } = {}) {
  assertSecretNotInline(input);
  const normalized = normalizeConnectionInput(input);
  if (!normalized.name) throw serviceError(ERROR_CODES.INVALID, 'name obrigatório');
  if (!normalized.endpoint) throw serviceError(ERROR_CODES.INVALID, 'endpoint obrigatório');

  assertEndpointAllowed(normalized.endpoint, {
    classification: normalized.classificationCeiling,
    allowedHosts: normalized.allowedHosts,
  });
  assertAuthAllowed(normalized.authType, normalized.classificationCeiling);

  const Model = getMcpConnectionModel();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId), name: normalized.name } });
  if (existing) {
    throw serviceError(ERROR_CODES.DUPLICATE, `já existe conexão '${normalized.name}' para o tenant`);
  }

  const id = `mcpc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const row = await Model.create({
    id,
    tenant_key: String(tenantId),
    name: normalized.name,
    endpoint: normalized.endpoint,
    transport: normalized.transport,
    auth_type: normalized.authType,
    credential_ref: normalized.credentialRef,
    enabled: normalized.enabled,
    classification_ceiling: normalized.classificationCeiling,
    status: normalized.enabled ? LIFECYCLE_STATES.CONFIGURED : LIFECYCLE_STATES.DISABLED,
    source: 'control-plane',
    metadata: { createdBy: actor },
  });
  return row.toJSON ? row.toJSON() : row;
}

async function updateConnection({ tenantId, id, patch = {}, actor = null } = {}) {
  assertSecretNotInline(patch);
  const current = await getConnection({ tenantId, id });

  const nextEndpoint = patch.endpoint !== undefined ? String(patch.endpoint).trim() : current.endpoint;
  const nextAuth = patch.authType !== undefined ? String(patch.authType).toLowerCase() : current.auth_type;
  const ceiling = patch.classificationCeiling !== undefined
    ? String(patch.classificationCeiling).toUpperCase()
    : current.classification_ceiling;

  if (patch.endpoint !== undefined) {
    assertEndpointAllowed(nextEndpoint, { classification: ceiling, allowedHosts: patch.allowedHosts });
  }
  if (patch.authType !== undefined) {
    assertAuthAllowed(nextAuth, ceiling);
  }

  const Model = getMcpConnectionModel();
  const updates = {};
  if (patch.endpoint !== undefined) updates.endpoint = nextEndpoint;
  if (patch.authType !== undefined) updates.auth_type = nextAuth;
  if (patch.credentialRef !== undefined) updates.credential_ref = patch.credentialRef ? String(patch.credentialRef) : null;
  if (patch.transport !== undefined) updates.transport = String(patch.transport).toLowerCase();
  if (patch.classificationCeiling !== undefined) updates.classification_ceiling = ceiling;
  if (patch.metadata !== undefined) updates.metadata = { ...(current.metadata || {}), ...patch.metadata, updatedBy: actor };
  // Endpoint/auth alterados invalidam descoberta e schema conhecidos (§M12).
  if (patch.endpoint !== undefined || patch.authType !== undefined) {
    updates.schema_fingerprint = null;
    updates.status = LIFECYCLE_STATES.CONFIGURED;
  }

  await Model.update(updates, { where: { id: String(id), tenant_key: String(tenantId) } });
  return getConnection({ tenantId, id });
}

/** §M8 — enable/disable persistidos; disable é estado, não remoção. */
async function setEnabled({ tenantId, id, enabled }) {
  await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  await Model.update(
    { enabled: enabled === true, status: enabled === true ? LIFECYCLE_STATES.CONFIGURED : LIFECYCLE_STATES.DISABLED },
    { where: { id: String(id), tenant_key: String(tenantId) } },
  );
  return getConnection({ tenantId, id });
}

/** §M8/§M12 — registra descoberta e detecta mudança de schema. */
async function recordDiscovery({ tenantId, id, tools = [], schemaFingerprint = null } = {}) {
  await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  const fingerprint = schemaFingerprint || fingerprintTools(tools);
  const current = await getConnection({ tenantId, id });

  let status = LIFECYCLE_STATES.HEALTHY;
  let schemaChanged = false;
  if (current.schema_fingerprint && current.schema_fingerprint !== fingerprint) {
    // §M12: mudança de schema NUNCA é aceita silenciosamente.
    status = LIFECYCLE_STATES.SCHEMA_CHANGED;
    schemaChanged = true;
  }

  await Model.update(
    {
      schema_fingerprint: fingerprint,
      last_discovery_at: new Date(),
      status: current.enabled === false ? LIFECYCLE_STATES.DISABLED : status,
    },
    { where: { id: String(id), tenant_key: String(tenantId) } },
  );
  return { ...(await getConnection({ tenantId, id })), schemaChanged, toolCount: Array.isArray(tools) ? tools.length : 0 };
}

/** §M11 — saúde persiste em campos próprios; erro explícito é registrado. */
async function recordHealth({ tenantId, id, ok, error = null, degradedAfter = 3 } = {}) {
  await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  const current = await getConnection({ tenantId, id });

  const failures = ok ? 0 : (Number(current.consecutive_failures) || 0) + 1;
  let status;
  if (current.enabled === false) status = LIFECYCLE_STATES.DISABLED;
  else if (ok) status = LIFECYCLE_STATES.HEALTHY;
  else if (failures >= degradedAfter) status = LIFECYCLE_STATES.UNAVAILABLE;
  else status = LIFECYCLE_STATES.DEGRADED;

  const now = new Date();
  await Model.update(
    {
      status,
      consecutive_failures: failures,
      last_health_at: now,
      last_error: ok ? null : (error ? String(error).slice(0, 2000) : 'health check failed'),
      ...(ok ? { last_success_at: now } : { last_failure_at: now }),
    },
    { where: { id: String(id), tenant_key: String(tenantId) } },
  );
  return getConnection({ tenantId, id });
}

/** §M8/§M10 — marca validação em andamento (estado persistido). */
async function markValidating({ tenantId, id }) {
  await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  await Model.update({ status: LIFECYCLE_STATES.VALIDATING }, { where: { id: String(id), tenant_key: String(tenantId) } });
  return getConnection({ tenantId, id });
}

/**
 * §M7 — bootstrap determinístico da config legada (`mcp.connections`).
 * Idempotente por `(tenant_key, name)`: reexecutar não duplica. Conexões já
 * presentes no banco NÃO são sobrescritas (o banco é autoridade).
 */
async function importFromConfigBootstrap({ tenantId, connections = [], actor = 'config-bootstrap' } = {}) {
  const results = { imported: [], skipped: [], invalid: [] };
  for (const raw of Array.isArray(connections) ? connections : []) {
    const name = String(raw && raw.name || '').trim();
    if (!name) { results.invalid.push({ reason: 'name_missing' }); continue; }
    try {
      const Model = getMcpConnectionModel();
      const existing = await Model.findOne({ where: { tenant_key: String(tenantId), name } });
      if (existing) { results.skipped.push({ name, reason: 'already_persisted' }); continue; }
      const created = await createConnection({
        tenantId,
        actor,
        input: {
          name,
          endpoint: raw.endpoint,
          transport: raw.transport,
          authType: raw.authType || raw.auth_type || 'bearer',
          credentialRef: raw.credentialRef || raw.authRef || null,
          enabled: raw.enabled !== false,
          classificationCeiling: raw.classification || 'PRODUCTION',
        },
      });
      const Model2 = getMcpConnectionModel();
      await Model2.update({ source: 'config-bootstrap' }, { where: { id: created.id } });
      results.imported.push(name);
    } catch (error) {
      results.invalid.push({ name, reason: error.code || error.message });
    }
  }
  return results;
}

/** §M13/§M14 — relatório honesto de capacidades (para API e gate). */
function authCapabilitiesReport() {
  return Object.entries(AUTH_CAPABILITIES).map(([mode, capability]) => ({
    mode,
    state: capability.state,
    transport: capability.transport,
    limitation: capability.limitation,
  }));
}

module.exports = {
  LIFECYCLE_STATES,
  ERROR_CODES,
  fingerprintTools,
  assertEndpointAllowed,
  assertAuthAllowed,
  assertSecretNotInline,
  listConnections,
  listEnabledConnections,
  getConnection,
  createConnection,
  updateConnection,
  setEnabled,
  recordDiscovery,
  recordHealth,
  markValidating,
  importFromConfigBootstrap,
  authCapabilitiesReport,
};
