'use strict';

/**
 * Contrato provider-neutral da camada de integração (R-Bridge).
 *
 * O domínio RAP NUNCA conhece formato bruto de provedor: ele consome DTOs
 * normalizados produzidos pelo adapter. Todo provider registrado precisa
 * satisfazer este contrato — o registro valida e `assertProviderContract`
 * falha alto (código `integration_provider_contract_violation`).
 *
 * Contrato (todos obrigatórios):
 *
 *  providerId(): string
 *  capabilities(): { provider, readOnly, supportsWebhooks, supportsIncremental, resources: string[] }
 *  validateConnection({ connection, credentials, http }): Promise<{ ok, status?, detail? }>
 *  fetchPage({ connection, credentials, resource, cursor, since, limit, http }): Promise<{
 *      items, nextCursor, hasMore, watermark, requestId? }>
 *  fetchOne({ connection, credentials, resource, externalId, http }): Promise<object|null>
 *  verifyWebhookSignature({ connection, credentials, headers, rawBody }): { ok, reason? }
 *  normalizeWebhook({ connection, headers, rawBody, parsedBody }): {
 *      eventType, idempotencyKey, externalEventId, resourceType, externalResourceId, payload }
 *
 * Recursos padronizados (o adapter mapeia para os recursos reais do provedor):
 *   members, prospects, memberships, plans, entries, sales, receivables,
 *   activities, schedules, employees
 */

const { IntegrationError, INTEGRATION_ERROR_CODES } = require('./integrationRedaction');

const RESOURCE_TYPES = Object.freeze([
  'members',
  'prospects',
  'memberships',
  'plans',
  'entries',
  'sales',
  'receivables',
  'activities',
  'schedules',
  'employees',
]);

const REQUIRED_PROVIDER_METHODS = Object.freeze([
  'providerId',
  'capabilities',
  'validateConnection',
  'fetchPage',
  'fetchOne',
  'verifyWebhookSignature',
  'normalizeWebhook',
]);

const IMPLEMENTED_PROVIDER_METHODS = Object.freeze(REQUIRED_PROVIDER_METHODS.filter((m) => m !== 'providerId'));

/**
 * @returns {{ ok: boolean, missing: string[], invalid: string[] }}
 *
 * Nota: a checagem é de PRESENÇA dos métodos. Aridade não é sinal confiável
 * (arrow function com parâmetro desestruturado tem `length === 0`) e usá-la
 * seria heurística frágil.
 */
function checkProviderContract(provider) {
  const missing = [];
  const invalid = [];
  if (!provider || typeof provider !== 'object') {
    return { ok: false, missing: [...REQUIRED_PROVIDER_METHODS], invalid: [] };
  }
  for (const method of REQUIRED_PROVIDER_METHODS) {
    if (typeof provider[method] !== 'function') missing.push(method);
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

function assertProviderContract(provider, providerId = null) {
  const result = checkProviderContract(provider);
  if (!result.ok) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION,
      `provider ${providerId || (provider && provider.providerId && provider.providerId()) || 'unknown'} viola o contrato`,
      { missing: result.missing, invalid: result.invalid },
    );
  }
  return true;
}

/** Valida o shape de uma página normalizada devolvida por `fetchPage`. */
function assertNormalizedPage(page, { providerId = 'unknown', resource = 'unknown' } = {}) {
  if (!page || typeof page !== 'object') {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
      `página inválida de ${providerId}/${resource}`,
      { providerId, resource },
    );
  }
  if (!Array.isArray(page.items)) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
      `página sem array items de ${providerId}/${resource}`,
      { providerId, resource },
    );
  }
  if (page.hasMore === true && !page.nextCursor) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
      `página com hasMore=true sem nextCursor de ${providerId}/${resource}`,
      { providerId, resource },
    );
  }
  return page;
}

module.exports = {
  RESOURCE_TYPES,
  REQUIRED_PROVIDER_METHODS,
  IMPLEMENTED_PROVIDER_METHODS,
  checkProviderContract,
  assertProviderContract,
  assertNormalizedPage,
};
