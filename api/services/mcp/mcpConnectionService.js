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

// O model exporta a FACTORY DIRETO (convenção dos models do projeto — ver
// `api/db/models/index.js`). Importar `{ getMcpConnectionModel }` deste módulo
// devolvia `undefined` e só "funcionava" porque o teste mockava o model com o
// formato errado: o mock escondia o defeito de contrato (M1).
const getMcpConnectionModel = require('../../db/models/McpConnection');
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

/**
 * Limites da config operacional persistida (§M6). Sem limite, uma conexão
 * poderia persistir um inventário/mapeamento ilimitado e transformar a leitura
 * do runtime num vetor de consumo de memória.
 */
const OPERATIONAL_LIMITS = Object.freeze({
  maxScopeEntries: 500,
  maxMapEntries: 2000,
  maxToolPolicies: 2000,
  maxTimeoutMs: 600000,
  maxAttempts: 10,
});

const MAPPING_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,32}$/;

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

/** Objeto simples (nunca array/null) — a config operacional não aceita lixo. */
function requirePlainObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(ERROR_CODES.INVALID, `${field} deve ser um objeto`);
  }
  return { ...value };
}

/** Lista de strings não vazias, sem duplicatas, com limite de cardinalidade. */
function requireStringArray(value, field, max = OPERATIONAL_LIMITS.maxScopeEntries) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(ERROR_CODES.INVALID, `${field} deve ser uma lista`);
  if (value.length > max) {
    throw serviceError(ERROR_CODES.INVALID, `${field} excede o limite de ${max} entradas`);
  }
  const normalized = value.map((item) => String(item ?? '').trim());
  if (normalized.some((item) => item.length === 0)) {
    throw serviceError(ERROR_CODES.INVALID, `${field} não aceita entradas vazias`);
  }
  return [...new Set(normalized)];
}

/** Mapa string→string (ex.: tool remota → capability canônica). */
function requireStringMap(value, field, max = OPERATIONAL_LIMITS.maxMapEntries) {
  const raw = requirePlainObject(value, field);
  const entries = Object.entries(raw);
  if (entries.length > max) {
    throw serviceError(ERROR_CODES.INVALID, `${field} excede o limite de ${max} entradas`);
  }
  const normalized = {};
  for (const [key, item] of entries) {
    const name = String(key).trim();
    const mapped = String(item ?? '').trim();
    if (!name || !mapped) {
      throw serviceError(ERROR_CODES.INVALID, `${field} exige chave e valor não vazios`);
    }
    normalized[name] = mapped;
  }
  return normalized;
}

/**
 * Incremento determinístico da versão do mapeamento (§M8). O mapeamento
 * tool-remota → capability canônica é persistente e VERSIONADO: uma alteração
 * de mapeamento sem bump tornaria impossível dizer qual configuração gerou uma
 * execução histórica.
 */
function bumpMappingVersion(current) {
  const raw = String(current || '').trim();
  if (/^\d+$/.test(raw)) return String(Number(raw) + 1);
  return '1';
}

/**
 * Normaliza a config OPERACIONAL persistida (§M6). Falha com erro explícito em
 * vez de coagir silenciosamente — config inválida que "funciona" é pior do que
 * config inválida que recusa.
 */
function normalizeOperationalConfig(input = {}, { currentMappingVersion = null, mappingTouched = null } = {}) {
  const timeoutRaw = input.timeoutMs;
  let timeoutMs = null;
  if (timeoutRaw !== undefined && timeoutRaw !== null && timeoutRaw !== '') {
    const parsed = Number(timeoutRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > OPERATIONAL_LIMITS.maxTimeoutMs) {
      throw serviceError(
        ERROR_CODES.INVALID,
        `timeoutMs deve ser inteiro entre 1 e ${OPERATIONAL_LIMITS.maxTimeoutMs}`,
      );
    }
    timeoutMs = parsed;
  }

  const retryPolicy = requirePlainObject(input.retryPolicy, 'retryPolicy');
  if (retryPolicy.attempts !== undefined) {
    const attempts = Number(retryPolicy.attempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > OPERATIONAL_LIMITS.maxAttempts) {
      throw serviceError(
        ERROR_CODES.INVALID,
        `retryPolicy.attempts deve ser inteiro entre 1 e ${OPERATIONAL_LIMITS.maxAttempts}`,
      );
    }
    retryPolicy.attempts = attempts;
  }

  let mappingVersion = null;
  if (input.mappingVersion !== undefined && input.mappingVersion !== null && input.mappingVersion !== '') {
    mappingVersion = String(input.mappingVersion).trim();
    if (!MAPPING_VERSION_PATTERN.test(mappingVersion)) {
      throw serviceError(ERROR_CODES.INVALID, 'mappingVersion deve casar com [a-zA-Z0-9._-]{1,32}');
    }
  }
  const toolCapabilityMap = requireStringMap(input.toolCapabilityMap, 'toolCapabilityMap');
  // `mappingTouched === null` ⇒ criação/uso direto: o mapeamento declarado é a
  // própria alteração. Num PATCH parcial, só um toque no mapa justifica bump —
  // alterar apenas o timeout não pode reescrever a versão do mapeamento.
  const touchedMapping = mappingTouched === null
    ? Object.keys(toolCapabilityMap).length > 0
    : mappingTouched === true;
  if (touchedMapping && !mappingVersion) {
    mappingVersion = currentMappingVersion ? bumpMappingVersion(currentMappingVersion) : '1';
  }

  const toolPolicies = requirePlainObject(input.toolPolicies, 'toolPolicies');
  if (Object.keys(toolPolicies).length > OPERATIONAL_LIMITS.maxToolPolicies) {
    throw serviceError(
      ERROR_CODES.INVALID,
      `toolPolicies excede o limite de ${OPERATIONAL_LIMITS.maxToolPolicies} entradas`,
    );
  }

  const quota = input.quota === undefined || input.quota === null ? null : requirePlainObject(input.quota, 'quota');

  return {
    allowedCapabilities: requireStringArray(input.allowedCapabilities, 'allowedCapabilities'),
    allowedTools: requireStringArray(input.allowedTools, 'allowedTools'),
    toolCapabilityMap,
    mappingVersion,
    toolPolicies,
    endpointPolicy: requirePlainObject(input.endpointPolicy, 'endpointPolicy'),
    quota,
    timeoutMs,
    retryPolicy,
  };
}

function normalizeConnectionInput(input = {}) {
  const operational = normalizeOperationalConfig(input, {
    currentMappingVersion: input.currentMappingVersion || null,
  });
  return {
    name: String(input.name || '').trim(),
    endpoint: String(input.endpoint || '').trim(),
    transport: String(input.transport || 'http').trim().toLowerCase(),
    authType: String(input.authType || 'bearer').trim().toLowerCase(),
    credentialRef: input.credentialRef ? String(input.credentialRef).trim() : null,
    enabled: input.enabled === true,
    classificationCeiling: String(input.classificationCeiling || 'PRODUCTION').toUpperCase(),
    allowedHosts: Array.isArray(input.allowedHosts) ? input.allowedHosts : undefined,
    ...operational,
  };
}

/**
 * Projeção da linha persistida para o contrato do serviço (§M6).
 * `listConnections()` NÃO pode devolver a linha crua: era exatamente assim que
 * `toolPolicies` (e o resto da config operacional) desaparecia antes de chegar
 * ao runtime — a política declarada por tool era descartada e a execução caía
 * na heurística por nome.
 */
function toConnectionRecord(row) {
  if (!row) return row;
  return {
    ...row,
    allowedCapabilities: row.allowed_capabilities || [],
    allowedTools: row.allowed_tools || [],
    toolCapabilityMap: row.tool_capability_map || {},
    mappingVersion: row.mapping_version || null,
    toolPolicies: row.tool_policies || {},
    endpointPolicy: row.endpoint_policy || {},
    quota: row.quota || null,
    timeoutMs: Number.isInteger(row.timeout_ms) ? row.timeout_ms : null,
    retryPolicy: row.retry_policy || {},
    discoveredTools: Array.isArray(row.discovered_tools) ? row.discovered_tools : [],
    schemaFingerprint: row.schema_fingerprint || null,
  };
}

/**
 * Projeção da linha persistida para a config do MCP Client Hub (§M6/§M7).
 * Aceita linha crua (snake_case) ou registro já normalizado, para que o mesmo
 * caminho sirva ao runtime e à API de administração.
 */
function toConnectionConfig(row) {
  const pick = (snake, camel) => (row?.[snake] !== undefined ? row[snake] : row?.[camel]);
  return {
    tenant: String(pick('tenant_key', 'tenant') || ''),
    name: String(pick('name', 'name') || ''),
    endpoint: String(pick('endpoint', 'endpoint') || ''),
    transport: pick('transport', 'transport') || 'http',
    enabled: pick('enabled', 'enabled') !== false,
    classification: String(pick('classification_ceiling', 'classification') || 'PRODUCTION'),
    authType: String(pick('auth_type', 'authType') || 'bearer'),
    credentialRef: pick('credential_ref', 'credentialRef') || null,
    connectionId: pick('id', 'id') || null,
    schemaFingerprint: pick('schema_fingerprint', 'schemaFingerprint') || null,
    allowedCapabilities: [...(pick('allowed_capabilities', 'allowedCapabilities') || [])],
    allowedTools: [...(pick('allowed_tools', 'allowedTools') || [])],
    toolCapabilityMap: { ...(pick('tool_capability_map', 'toolCapabilityMap') || {}) },
    mappingVersion: pick('mapping_version', 'mappingVersion') || null,
    toolPolicies: { ...(pick('tool_policies', 'toolPolicies') || {}) },
    endpointPolicy: { ...(pick('endpoint_policy', 'endpointPolicy') || {}) },
    quota: pick('quota', 'quota') || null,
    timeoutMs: pick('timeout_ms', 'timeoutMs') || null,
    retryPolicy: { ...(pick('retry_policy', 'retryPolicy') || {}) },
    discoveredTools: [...(pick('discovered_tools', 'discoveredTools') || [])],
  };
}

/**
 * Resumo do último inventário REAL (`tools/list`) para persistência (§M9/§M12).
 * A capability de cada tool é resolvida pelo mapeamento PERSISTIDO — o inventário
 * remoto nunca declara capability canônica por conta própria.
 */
function summarizeDiscoveredTools(tools, toolCapabilityMap = {}) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => {
      const name = String(tool?.name || tool?.toolName || '').trim();
      if (!name) return null;
      const mapped = toolCapabilityMap[name];
      return {
        name,
        capability: String(mapped || tool.capability || '').trim() || null,
        schemaFingerprint: tool.schemaFingerprint || tool.schema_fingerprint || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
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
  return rows.map((row) => toConnectionRecord(row.toJSON ? row.toJSON() : row));
}

/**
 * §M6 — conexões habilitadas de UM tenant (uso administrativo/consulta).
 *
 * NÃO é a autoridade de startup: o runtime usa `listAllEnabledConnections()`,
 * porque a lista de tenants não pode ser insumo (§M3/§M4). Manter as duas com a
 * mesma aparência foi o que tornou o defeito difícil de ver.
 */
async function listEnabledConnections({ tenantId }) {
  return listConnections({ tenantId, includeDisabled: false });
}

/**
 * §M3/§M4 — TODAS as conexões habilitadas, de TODOS os tenants.
 *
 * Antes o runtime recebia a lista de tenants por parâmetro (`deps.tenants`) e
 * carregava conexão por conexão. Isso tornava a descoberta de conexões
 * dependente de um INSUMO EXTERNO: um tenant habilitado depois do boot nunca era
 * visto, e um tenant esquecido na lista nunca era carregado. Aqui o banco é a
 * autoridade: quem está habilitado no banco é o que o runtime carrega.
 */
async function listAllEnabledConnections() {
  const Model = getMcpConnectionModel();
  if (!Model || typeof Model.findAll !== 'function') {
    throw serviceError(ERROR_CODES.PERSISTENCE_REQUIRED, 'modelo McpConnection indisponível');
  }
  const rows = await Model.findAll({
    where: { enabled: true },
    order: [['tenant_key', 'ASC'], ['name', 'ASC']],
  });
  return rows.map((row) => toConnectionRecord(row.toJSON ? row.toJSON() : row));
}

async function getConnection({ tenantId, id }) {
  const Model = getMcpConnectionModel();
  if (!Model || typeof Model.findOne !== 'function') {
    throw serviceError(ERROR_CODES.PERSISTENCE_REQUIRED, 'modelo McpConnection indisponível');
  }
  const row = await Model.findOne({ where: { id: String(id), tenant_key: String(tenantId) } });
  // Ausência de posse devolve NOT_FOUND — não vaza existência (§M cross-tenant).
  if (!row) throw serviceError(ERROR_CODES.NOT_FOUND, `conexão não encontrada: ${id}`);
  return toConnectionRecord(row.toJSON ? row.toJSON() : row);
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
    // §M6 — config operacional persistida: sem ela o reinício perdia escopo,
    // mapeamento de capability e política declarada por tool.
    allowed_capabilities: normalized.allowedCapabilities,
    allowed_tools: normalized.allowedTools,
    tool_capability_map: normalized.toolCapabilityMap,
    mapping_version: normalized.mappingVersion,
    tool_policies: normalized.toolPolicies,
    endpoint_policy: normalized.endpointPolicy,
    quota: normalized.quota,
    timeout_ms: normalized.timeoutMs,
    retry_policy: normalized.retryPolicy,
    source: 'control-plane',
    metadata: { createdBy: actor },
  });
  return toConnectionRecord(row.toJSON ? row.toJSON() : row);
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

  const OPERATIONAL_PATCH_FIELDS = [
    'allowedCapabilities', 'allowedTools', 'toolCapabilityMap', 'mappingVersion',
    'toolPolicies', 'endpointPolicy', 'quota', 'timeoutMs', 'retryPolicy',
  ];
  const touchesOperational = OPERATIONAL_PATCH_FIELDS.some((field) => patch[field] !== undefined);
  const operational = touchesOperational
    ? normalizeOperationalConfig(
      {
        allowedCapabilities: patch.allowedCapabilities !== undefined ? patch.allowedCapabilities : current.allowed_capabilities,
        allowedTools: patch.allowedTools !== undefined ? patch.allowedTools : current.allowed_tools,
        toolCapabilityMap: patch.toolCapabilityMap !== undefined ? patch.toolCapabilityMap : current.tool_capability_map,
        mappingVersion: patch.mappingVersion,
        toolPolicies: patch.toolPolicies !== undefined ? patch.toolPolicies : current.tool_policies,
        endpointPolicy: patch.endpointPolicy !== undefined ? patch.endpointPolicy : current.endpoint_policy,
        quota: patch.quota !== undefined ? patch.quota : current.quota,
        timeoutMs: patch.timeoutMs !== undefined ? patch.timeoutMs : current.timeout_ms,
        retryPolicy: patch.retryPolicy !== undefined ? patch.retryPolicy : current.retry_policy,
      },
      { currentMappingVersion: current.mapping_version || null, mappingTouched: patch.toolCapabilityMap !== undefined },
    )
    : null;

  const Model = getMcpConnectionModel();
  const updates = {};
  if (patch.endpoint !== undefined) updates.endpoint = nextEndpoint;
  if (patch.authType !== undefined) updates.auth_type = nextAuth;
  if (patch.credentialRef !== undefined) updates.credential_ref = patch.credentialRef ? String(patch.credentialRef) : null;
  if (patch.transport !== undefined) updates.transport = String(patch.transport).toLowerCase();
  if (patch.classificationCeiling !== undefined) updates.classification_ceiling = ceiling;
  if (patch.metadata !== undefined) updates.metadata = { ...(current.metadata || {}), ...patch.metadata, updatedBy: actor };
  if (operational) {
    updates.allowed_capabilities = operational.allowedCapabilities;
    updates.allowed_tools = operational.allowedTools;
    updates.tool_capability_map = operational.toolCapabilityMap;
    // §M8 — o mapeamento é versionado: alterar mapeamento sem bump tornaria
    // impossível auditar qual configuração gerou uma execução histórica.
    if (operational.mappingVersion) updates.mapping_version = operational.mappingVersion;
    updates.tool_policies = operational.toolPolicies;
    updates.endpoint_policy = operational.endpointPolicy;
    updates.quota = operational.quota;
    updates.timeout_ms = operational.timeoutMs;
    updates.retry_policy = operational.retryPolicy;
  }
  // Endpoint/auth alterados invalidam descoberta e schema conhecidos (§M12).
  if (patch.endpoint !== undefined || patch.authType !== undefined) {
    updates.schema_fingerprint = null;
    updates.discovered_tools = [];
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

/** §M8/§M12 — registra descoberta REAL e detecta mudança de schema. */
/**
 * §M12 — decisão PURA de aceitação de schema (sem I/O, por isso auditável e
 * executável pelo gate).
 *
 * Regra: `schema_fingerprint` é o contrato ACEITO (o que o runtime pode usar).
 * Uma descoberta pode OBSERVAR outro contrato, mas não pode promovê-lo:
 * promover exige `recordRevalidation` (decisão deliberada, com timestamp).
 *
 * Defeito real corrigido aqui: a primeira versão gravava o fingerprint
 * observado em toda descoberta. A segunda descoberta do mesmo inventário novo
 * então encontrava "fingerprint igual" e devolvia a conexão para HEALTHY — ou
 * seja, o contrato novo era promovido SOZINHO, sem revalidação de ninguém.
 * O comentário dizia "nunca promove sozinho" e o código promovia.
 *
 * @returns {{acceptedFingerprint: string|null, observedFingerprint: string|null,
 *            schemaChanged: boolean, status: string, pendingFingerprint: string|null}}
 */
function evaluateSchemaAcceptance({ acceptedFingerprint = null, observedFingerprint = null } = {}) {
  const accepted = acceptedFingerprint || null;
  const observed = observedFingerprint || null;
  if (!accepted) {
    // Primeira descoberta: não existe contrato em vigor para violar.
    return {
      acceptedFingerprint: observed,
      observedFingerprint: observed,
      schemaChanged: false,
      status: LIFECYCLE_STATES.HEALTHY,
      pendingFingerprint: null,
    };
  }
  if (accepted !== observed) {
    return {
      acceptedFingerprint: accepted,
      observedFingerprint: observed,
      schemaChanged: true,
      status: LIFECYCLE_STATES.SCHEMA_CHANGED,
      pendingFingerprint: observed,
    };
  }
  return {
    acceptedFingerprint: accepted,
    observedFingerprint: observed,
    schemaChanged: false,
    status: LIFECYCLE_STATES.HEALTHY,
    pendingFingerprint: null,
  };
}

async function recordDiscovery({ tenantId, id, tools = [], schemaFingerprint = null, capabilities = [] } = {}) {
  const current = await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  const fingerprint = schemaFingerprint || fingerprintTools(tools);

  const acceptance = evaluateSchemaAcceptance({
    acceptedFingerprint: current.schema_fingerprint || null,
    observedFingerprint: fingerprint,
  });
  const status = acceptance.status;
  const schemaChanged = acceptance.schemaChanged;
  const effectiveFingerprint = acceptance.acceptedFingerprint;

  const inventory = summarizeDiscoveredTools(tools, current.tool_capability_map || {});
  const unmappedTools = inventory.filter((tool) => !tool.capability).map((tool) => tool.name);
  const declared = new Set([...(current.allowed_capabilities || []), ...(capabilities || [])]);
  const observedCapabilities = [...new Set(inventory.map((tool) => tool.capability).filter(Boolean))];

  await Model.update(
    {
      schema_fingerprint: effectiveFingerprint,
      last_discovery_at: new Date(),
      discovered_tools: inventory,
      status: current.enabled === false ? LIFECYCLE_STATES.DISABLED : status,
      // A descoberta prova conectividade: zera a contagem de falhas.
      consecutive_failures: 0,
      last_error: null,
      last_success_at: new Date(),
      metadata: {
        ...(current.metadata || {}),
        revalidationRequired: schemaChanged,
        // O que o servidor oferece AGORA e que ainda NÃO foi aceito fica
        // registrado (auditável) sem virar autoridade de execução.
        pendingSchemaFingerprint: schemaChanged ? fingerprint : null,
        lastDiscoveryToolCount: inventory.length,
      },
    },
    { where: { id: String(id), tenant_key: String(tenantId) } },
  );
  const updated = await getConnection({ tenantId, id });
  return {
    ...updated,
    schemaChanged,
    revalidationRequired: schemaChanged,
    observedSchemaFingerprint: fingerprint,
    // Compatibilidade: o fingerprint devolvido é o ACEITO, exceto quando a
    // descoberta acabou de estabelecê-lo.
    acceptedSchemaFingerprint: effectiveFingerprint,
    toolCount: Array.isArray(tools) ? tools.length : 0,
    unmappedTools,
    mappedCapabilities: observedCapabilities,
    unmappedCapabilities: [...declared].filter((capability) => !observedCapabilities.includes(capability)),
  };
}

/**
 * §M12 — revalidação EXPLÍCITA do schema: aceita o novo fingerprint.
 *
 * Sem esta operação, uma conexão com `SCHEMA_CHANGED` nunca volta a HEALTHY — e
 * "voltar sozinho" seria pior: o contrato novo passaria a valer sem decisão de
 * ninguém. Aqui a aceitação é uma ação deliberada, com timestamp persistido.
 */
async function recordRevalidation({ tenantId, id, tools = [], schemaFingerprint = null } = {}) {
  const current = await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  const fingerprint = schemaFingerprint || fingerprintTools(tools);
  const now = new Date();

  await Model.update(
    {
      schema_fingerprint: fingerprint,
      schema_revalidated_at: now,
      last_discovery_at: now,
      discovered_tools: summarizeDiscoveredTools(tools, current.tool_capability_map || {}),
      status: current.enabled === false ? LIFECYCLE_STATES.DISABLED : LIFECYCLE_STATES.HEALTHY,
      consecutive_failures: 0,
      last_error: null,
      last_success_at: now,
      metadata: {
        ...(current.metadata || {}),
        revalidationRequired: false,
        // Aceito: não há mais contrato pendente.
        pendingSchemaFingerprint: null,
        revalidatedAt: now.toISOString(),
      },
    },
    { where: { id: String(id), tenant_key: String(tenantId) } },
  );
  const updated = await getConnection({ tenantId, id });
  return {
    ...updated,
    revalidated: true,
    previousFingerprint: current.schema_fingerprint || null,
    fingerprintChanged: (current.schema_fingerprint || null) !== fingerprint,
  };
}

/** §M11 — saúde persiste em campos próprios; erro explícito é registrado. */
async function recordHealth({ tenantId, id, ok, error = null, degradedAfter = 3 } = {}) {
  await getConnection({ tenantId, id });
  const Model = getMcpConnectionModel();
  const current = await getConnection({ tenantId, id });

  const failures = ok ? 0 : (Number(current.consecutive_failures) || 0) + 1;
  let status;
  if (current.enabled === false) status = LIFECYCLE_STATES.DISABLED;
  // §M12 × TAREFA 71 — SAÚDE NÃO SOBRESCREVE ESTADO PENDENTE DE AÇÃO.
  // `SCHEMA_CHANGED` não é um sintoma de saúde: é uma mudança de contrato
  // OBSERVADA que exige revalidação explícita do operador. Um health check bem
  // sucedido (o servidor respondeu) provava justamente que o servidor está no
  // ar — e apagava a pendência, fazendo o contrato novo parecer aceito. Os
  // sinais de saúde (lastSuccessAt, consecutiveFailures=0) continuam sendo
  // gravados; só o STATUS permanece pendente até a revalidação.
  else if (ok && current.status === LIFECYCLE_STATES.SCHEMA_CHANGED) status = LIFECYCLE_STATES.SCHEMA_CHANGED;
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
          // §M6/§M8 — bootstrap NÃO pode importar menos que o control plane:
          // sem isto, uma conexão legada voltava sem escopo, sem mapeamento de
          // capability e sem política declarada por tool.
          allowedCapabilities: raw.allowedCapabilities,
          allowedTools: raw.allowedTools,
          toolCapabilityMap: raw.toolCapabilityMap,
          mappingVersion: raw.mappingVersion,
          toolPolicies: raw.toolPolicies,
          endpointPolicy: raw.endpointPolicy,
          quota: raw.quota,
          timeoutMs: raw.timeoutMs,
          retryPolicy: raw.retryPolicy,
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
  OPERATIONAL_LIMITS,
  fingerprintTools,
  summarizeDiscoveredTools,
  toConnectionRecord,
  toConnectionConfig,
  assertEndpointAllowed,
  assertAuthAllowed,
  assertSecretNotInline,
  listConnections,
  listEnabledConnections,
  listAllEnabledConnections,
  getConnection,
  createConnection,
  updateConnection,
  setEnabled,
  evaluateSchemaAcceptance,
  recordDiscovery,
  recordHealth,
  markValidating,
  recordRevalidation,
  importFromConfigBootstrap,
  authCapabilitiesReport,
};
