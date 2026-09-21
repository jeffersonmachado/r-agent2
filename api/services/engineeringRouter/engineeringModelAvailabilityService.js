'use strict';

/**
 * api/services/engineeringRouter/engineeringModelAvailabilityService.js
 *
 * Ponte de I/O entre a infraestrutura de IA real (registry + control plane + credenciais por
 * tenant) e o `modelSelector` puro do Engineering Model Router. Não reimplementa nada disso —
 * apenas junta três fontes já existentes:
 *   1. `engine/engineeringRouter/modelCapabilities.js` (capabilities/roles por modelo, V1)
 *   2. `api/services/aiProviderRegistryService.getRuntimeProviders()` (enabled real, built-in+custom)
 *   3. `api/services/aiControlPlaneStatus.getBreakerStates()` (saúde real por circuit breaker)
 *   4. `api/services/tenantAIService.hasCredentials(tenantId, provider)` (credencial real por tenant)
 *
 * O tenant usado para checagem de credencial é configurável (`ENGINEERING_ROUTER_TENANT_ID`,
 * default `'system'` — o mesmo tenant interno já usado para chamadas de IA sem tenant real em
 * `api/modules/tenant/aiWorkflows.js`).
 */

const { listCapabilityEntries } = require('../../../engine/engineeringRouter/modelCapabilities');
const { getRuntimeProviders } = require('../aiProviderRegistryService');
const { getBreakerStates } = require('../aiControlPlaneStatus');
const { hasCredentials } = require('../tenantAIService');
const logger = require('../../utils/logger');

const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';

/**
 * Constrói a lista de candidatos (`availableModels`) usada pelo `modelSelector` puro.
 * Nunca lança: uma falha ao resolver credencial/health de um provider específico apenas o
 * marca como indisponível (fail-closed), não interrompe a montagem da lista inteira.
 *
 * @param {{tenantId?: string}} [options]
 * @returns {Promise<Object[]>}
 */
async function buildAvailableModels({ tenantId = DEFAULT_TENANT_ID } = {}) {
  let runtimeProviders = {};
  try {
    runtimeProviders = await getRuntimeProviders();
  } catch (err) {
    logger.warn('[engineeringModelAvailability] falha ao carregar runtime providers', { error: err.message });
  }

  let breakerStates = [];
  try {
    breakerStates = getBreakerStates();
  } catch (err) {
    logger.warn('[engineeringModelAvailability] falha ao ler circuit breakers', { error: err.message });
  }
  const breakerByProvider = new Map(breakerStates.map((b) => [b.provider, b.state]));

  const entries = listCapabilityEntries();
  const results = [];

  for (const entry of entries) {
    const providerDef = runtimeProviders[entry.providerId];
    const enabled = Boolean(providerDef) && providerDef.enabled !== false;

    const breakerState = breakerByProvider.get(entry.providerId);
    // Sem breaker registrado ainda (provider nunca chamado nesta instância): trata como
    // saudável por ausência de evidência de falha (mesma leitura usada pelo restante do
    // sistema — o breaker só abre após falhas reais).
    const healthy = breakerState !== 'OPEN';

    let hasCredential = false;
    try {
      hasCredential = await hasCredentials(tenantId, entry.providerId);
    } catch (err) {
      logger.warn('[engineeringModelAvailability] falha ao checar credencial', { providerId: entry.providerId, error: err.message });
      hasCredential = false;
    }

    results.push({
      providerId: entry.providerId,
      modelId: entry.modelId,
      roles: entry.roles,
      capabilities: entry.capabilities,
      contextClass: entry.contextClass,
      costClass: entry.costClass,
      enabled,
      healthy,
      hasCredential,
    });
  }

  return results;
}

module.exports = {
  DEFAULT_TENANT_ID,
  buildAvailableModels,
};
