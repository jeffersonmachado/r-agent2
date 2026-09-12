'use strict';

/**
 * MCP Service Principal — identidade MACHINE-TO-MACHINE para agentes externos
 * que consomem o RAP via MCP (ou outra superfície de capability).
 *
 * PROBLEMA (M31/M32): o boundary `/mcp` autenticava apenas SESSÃO HUMANA
 * (`requireAuth`). Isso tem duas consequências ruins:
 *   1. um agente externo precisaria de uma credencial de pessoa — e gente
 *      compartilha senha, rotaciona mal e não tem escopo;
 *   2. sem escopo por capability, qualquer integração autorizada enxergaria
 *      TUDO que o humano enxerga.
 *
 * DESIGN: um service principal é um registro versionado e revogável com
 *   tenant · capability scopes · classification CEILING · expiração ·
 *   revogação · identidade de auditoria.
 *
 * Invariantes (fail-closed):
 *  - NUNCA reutiliza token de super-admin: o principal é o próprio registro.
 *  - `classificationCeiling` é um TETO: o principal nunca recebe classificação
 *    acima dele, e o default é o MENOR privilégio (PRODUCTION).
 *  - `capabilityScopes` vazio ⇒ principal sem acesso (não "acesso total").
 *    Wildcard `*` é proibido para service principal.
 *  - Opt-in explícito (`meta.mcp.enabled === true`): uma developer key comum
 *    NÃO vira principal MCP só por existir.
 *  - Expiração/revogação são revalidadas aqui (defesa em profundidade), mesmo
 *    que o store já valide.
 *  - O principal carrega identidade de auditoria estável — as ações externas
 *    precisam ser atribuíveis a um agente, não a "usuário desconhecido".
 */

const { VISIBILITY_RANK, isValidVisibility } = require('../cognitive/visibility');

const SERVICE_PRINCIPAL_KIND = 'developer';
const MCP_PRINCIPAL_META_KEY = 'mcp';
const DEFAULT_CLASSIFICATION_CEILING = 'PRODUCTION';

const PRINCIPAL_INVALID_REASONS = Object.freeze({
  RECORD_REQUIRED: 'mcp_principal_record_required',
  TENANT_REQUIRED: 'mcp_principal_tenant_required',
  NOT_ENABLED: 'mcp_principal_not_enabled',
  SCOPES_REQUIRED: 'mcp_principal_capability_scopes_required',
  WILDCARD_FORBIDDEN: 'mcp_principal_wildcard_scope_forbidden',
  CEILING_INVALID: 'mcp_principal_classification_ceiling_invalid',
  EXPIRED: 'mcp_principal_expired',
  REVOKED: 'mcp_principal_revoked',
  INACTIVE: 'mcp_principal_inactive',
  AUDIT_IDENTITY_REQUIRED: 'mcp_principal_audit_identity_required',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeScopes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((s) => String(s || '').trim()).filter(Boolean))];
}

/**
 * Valida um registro de service principal (formato do store de credenciais:
 * `{ tenantId, kind, active, revokedAt, expiresAt, meta }`).
 *
 * @param {object} record
 * @param {object} [options]
 * @param {number} [options.now] epoch ms (injetável p/ teste determinístico)
 * @returns {{valid: boolean, reason: string|null, principal: object|null}}
 */
function validateServicePrincipal(record, { now = Date.now() } = {}) {
  const deny = (reason) => ({ valid: false, reason, principal: null });

  if (!record || typeof record !== 'object') return deny(PRINCIPAL_INVALID_REASONS.RECORD_REQUIRED);
  if (!isNonEmptyString(record.tenantId)) return deny(PRINCIPAL_INVALID_REASONS.TENANT_REQUIRED);
  if (record.active === false) return deny(PRINCIPAL_INVALID_REASONS.INACTIVE);
  if (record.revokedAt) return deny(PRINCIPAL_INVALID_REASONS.REVOKED);

  if (record.expiresAt) {
    const expiresAt = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now) {
      return deny(PRINCIPAL_INVALID_REASONS.EXPIRED);
    }
  }

  const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
  const mcp = meta[MCP_PRINCIPAL_META_KEY] && typeof meta[MCP_PRINCIPAL_META_KEY] === 'object'
    ? meta[MCP_PRINCIPAL_META_KEY]
    : null;

  // Opt-in explícito: developer key sem bloco `mcp` NÃO é principal MCP.
  if (!mcp || mcp.enabled !== true) return deny(PRINCIPAL_INVALID_REASONS.NOT_ENABLED);

  const capabilityScopes = normalizeScopes(mcp.capabilityScopes);
  if (capabilityScopes.length === 0) return deny(PRINCIPAL_INVALID_REASONS.SCOPES_REQUIRED);
  if (capabilityScopes.includes('*')) return deny(PRINCIPAL_INVALID_REASONS.WILDCARD_FORBIDDEN);

  const ceiling = String(mcp.classificationCeiling || DEFAULT_CLASSIFICATION_CEILING).toUpperCase();
  if (!isValidVisibility(ceiling)) return deny(PRINCIPAL_INVALID_REASONS.CEILING_INVALID);

  const auditIdentity = mcp.auditIdentity || meta.name || record.id || null;
  if (!isNonEmptyString(auditIdentity)) return deny(PRINCIPAL_INVALID_REASONS.AUDIT_IDENTITY_REQUIRED);

  return {
    valid: true,
    reason: null,
    principal: Object.freeze({
      principalId: String(record.id || `sp:${record.tenantId}:${auditIdentity}`),
      principalType: 'service',
      tenantId: String(record.tenantId),
      agentId: String(auditIdentity),
      auditIdentity: String(auditIdentity),
      classification: ceiling, // teto EFETIVO (não elevável pelo cliente)
      classificationCeiling: ceiling,
      capabilityScopes: Object.freeze(capabilityScopes),
      // Permissões concedidas == scopes declarados. NUNCA `*`.
      permissions: Object.freeze([...capabilityScopes]),
      expiresAt: record.expiresAt || null,
      credentialId: String(record.id || ''),
      label: isNonEmptyString(meta.name) ? String(meta.name) : null,
    }),
  };
}

/**
 * Filtra as capabilities que o principal REALMENTE pode exercer, dadas as
 * capabilities existentes no catálogo canônico.
 *
 * Isto é discovery-side enforcement (§33): o principal não "descobre" uma
 * capability que não pode executar.
 */
function grantedCapabilities({ principal, availableCapabilities = [] } = {}) {
  const scopes = new Set(principal?.capabilityScopes || []);
  return [...new Set(availableCapabilities.filter((capability) => scopes.has(String(capability))))];
}

/**
 * Aplica o teto de classificação: o principal nunca recebe uma classificação
 * acima do ceiling, mesmo que o chamador tente elevar.
 */
function applyClassificationCeiling(requested, ceiling) {
  const requestedRank = VISIBILITY_RANK[String(requested || '').toUpperCase()];
  const ceilingRank = VISIBILITY_RANK[String(ceiling || '').toUpperCase()];
  if (ceilingRank === undefined) return DEFAULT_CLASSIFICATION_CEILING;
  if (requestedRank === undefined) return String(ceiling).toUpperCase();
  return requestedRank <= ceilingRank ? String(requested).toUpperCase() : String(ceiling).toUpperCase();
}

/**
 * Contexto de execução MCP derivado de um service principal — mesmo shape
 * aceito por `buildMcpExecutionContext`.
 */
function buildServicePrincipalAuthContext({ principal, correlationId = null, sessionId = null } = {}) {
  if (!principal) throw new Error(PRINCIPAL_INVALID_REASONS.RECORD_REQUIRED);
  return {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    principalType: 'service',
    agentId: principal.agentId,
    classification: principal.classification,
    permissions: [...principal.permissions],
    capabilities: [...principal.capabilityScopes],
    sessionId,
    correlationId,
  };
}

/**
 * Filtra a listagem de tools para o principal — a checagem é explícita e
 * auditável, para não depender só do filtro interno do registry.
 *
 * @param {object} args
 * @param {Array<object>} args.tools        projeção de tools (`{id, capability, permissions, visibility}`)
 * @param {object} args.principal
 * @returns {{visible: Array<object>, hidden: Array<{id, reason}>}}
 */
function filterToolsForPrincipal({ tools = [], principal } = {}) {
  if (!principal) return { visible: [], hidden: (tools || []).map((t) => ({ id: t.id, reason: 'no_principal' })) };

  const scopes = new Set(principal.capabilityScopes || []);
  const ceilingRank = VISIBILITY_RANK[String(principal.classificationCeiling || DEFAULT_CLASSIFICATION_CEILING).toUpperCase()];
  const visible = [];
  const hidden = [];

  for (const tool of tools) {
    const toolRank = VISIBILITY_RANK[String(tool.visibility || '').toUpperCase()];
    if (toolRank === undefined || toolRank > ceilingRank) {
      hidden.push({ id: tool.id, reason: 'classification_above_ceiling' });
      continue;
    }
    const required = Array.isArray(tool.permissions) ? tool.permissions : [];
    const capability = tool.capability ? String(tool.capability) : null;
    const coveredByScope = required.length === 0
      || required.every((permission) => scopes.has(permission));
    const capabilityInScope = capability === null || scopes.has(capability);
    if (!coveredByScope || !capabilityInScope) {
      hidden.push({ id: tool.id, reason: 'capability_out_of_scope' });
      continue;
    }
    visible.push(tool);
  }

  return { visible, hidden };
}

/**
 * Extrai o token do header Authorization. Só `Bearer` é aceito; nada de token
 * em querystring (não vaza em log/Referer).
 */
function extractBearerToken(authorizationHeader) {
  if (!isNonEmptyString(authorizationHeader)) return null;
  const match = String(authorizationHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

module.exports = {
  SERVICE_PRINCIPAL_KIND,
  MCP_PRINCIPAL_META_KEY,
  DEFAULT_CLASSIFICATION_CEILING,
  PRINCIPAL_INVALID_REASONS,
  normalizeScopes,
  validateServicePrincipal,
  grantedCapabilities,
  applyClassificationCeiling,
  buildServicePrincipalAuthContext,
  filterToolsForPrincipal,
  extractBearerToken,
};
