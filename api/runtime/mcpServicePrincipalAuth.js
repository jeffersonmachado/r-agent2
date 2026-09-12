'use strict';

/**
 * MCP Service Principal Auth — resolução de credencial MACHINE-TO-MACHINE no
 * boundary MCP.
 *
 * O boundary `/mcp` aceita dois tipos de principal:
 *   1. SESSÃO HUMANA — `requireAuth` (comportamento preservado);
 *   2. SERVICE PRINCIPAL — credencial de integração (`kind: 'developer'`) com
 *      bloco `meta.mcp` habilitado, escopos de capability e teto de
 *      classificação.
 *
 * Regras:
 *  - a resolução de token é INJETÁVEL (testes não tocam o banco);
 *  - falha de resolução nunca vira principal anônimo: 401 explícito;
 *  - o motivo é devolvido como código estável (`mcp_principal_expired`, ...)
 *    para auditoria, sem revelar se o token existe;
 *  - a credencial de serviço NÃO é registrada em log nem devolvida.
 */

const {
  SERVICE_PRINCIPAL_KIND,
  PRINCIPAL_INVALID_REASONS,
  validateServicePrincipal,
  buildServicePrincipalAuthContext,
  extractBearerToken,
} = require('../../src/core/mcp/service-principal');

/**
 * Resolver default: usa o store de credenciais existente
 * (`public_access_tokens`, kind `developer`). Carregado lazy para não acoplar
 * o runtime a Sequelize em contextos que injetam o resolver.
 */
async function defaultResolveToken(token) {
  const publicAccessTokenService = require('../services/publicAccessTokenService');
  const result = await publicAccessTokenService.resolvePublicToken({
    token,
    allowedKinds: [SERVICE_PRINCIPAL_KIND],
  });
  if (!result?.ok) return { ok: false, error: result?.error || 'invalid_token' };
  return {
    ok: true,
    record: {
      id: result.tokenId,
      tenantId: result.tenantId,
      kind: result.kind,
      locationId: result.locationId || null,
      active: true, // resolvido agora e ainda ativo
      revokedAt: null,
      expiresAt: result.expiresAt,
      meta: result.meta || {},
    },
  };
}

/**
 * Resolve o service principal a partir do header Authorization.
 *
 * @param {object} args
 * @param {string} args.authorizationHeader
 * @param {Function} [args.resolveToken]
 * @param {number} [args.now]
 * @param {string} [args.correlationId]
 * @returns {Promise<{ok: boolean, error: string|null, principal: object|null, authContext: object|null}>}
 */
async function resolveServicePrincipal({
  authorizationHeader,
  resolveToken,
  now,
  correlationId = null,
} = {}) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return { ok: false, error: 'mcp_credential_required', principal: null, authContext: null };

  const resolver = typeof resolveToken === 'function' ? resolveToken : defaultResolveToken;

  let resolved;
  try {
    resolved = await resolver(token);
  } catch (error) {
    return { ok: false, error: 'mcp_credential_resolution_failed', principal: null, authContext: null };
  }

  if (!resolved?.ok) {
    // Código genérico para o cliente; o motivo real fica no detalhe auditável.
    return {
      ok: false,
      error: 'mcp_credential_invalid',
      detail: resolved?.error || 'invalid_token',
      principal: null,
      authContext: null,
    };
  }

  const validation = validateServicePrincipal(resolved.record, { now });
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.reason === PRINCIPAL_INVALID_REASONS.EXPIRED
        ? 'mcp_credential_expired'
        : 'mcp_credential_invalid',
      detail: validation.reason,
      principal: null,
      authContext: null,
    };
  }

  return {
    ok: true,
    error: null,
    principal: validation.principal,
    authContext: buildServicePrincipalAuthContext({ principal: validation.principal, correlationId }),
  };
}

module.exports = { SERVICE_PRINCIPAL_KIND, resolveServicePrincipal, defaultResolveToken };
