'use strict';

/**
 * Registry de providers de integração (R-Bridge).
 *
 * Fonte única de providers disponíveis. Nenhum serviço de domínio importa um
 * adapter diretamente — todos resolvem via registry, o que mantém a camada
 * provider-neutral e testável (o fake EVO dos testes se registra aqui).
 */

const { IntegrationError, INTEGRATION_ERROR_CODES } = require('./integrationRedaction');
const { assertProviderContract } = require('./providerContract');

const providers = new Map();

function registerProvider(provider) {
  assertProviderContract(provider);
  const id = String(provider.providerId()).trim().toLowerCase();
  if (!id) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'provider sem providerId');
  }
  providers.set(id, provider);
  return provider;
}

/** Registro idempotente (usado no bootstrap e nos testes). */
function ensureProvider(provider) {
  const id = String(provider.providerId()).trim().toLowerCase();
  if (!providers.has(id)) registerProvider(provider);
  return providers.get(id);
}

function getProvider(providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  const provider = providers.get(id);
  if (!provider) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.PROVIDER_UNKNOWN,
      `provider de integração desconhecido: ${id || '(vazio)'}`,
      { providerId: id || null, available: [...providers.keys()] },
    );
  }
  return provider;
}

function hasProvider(providerId) {
  return providers.has(String(providerId || '').trim().toLowerCase());
}

function listProviderIds() {
  return [...providers.keys()].sort();
}

/** Somente para testes: limpa o registry. */
function resetRegistry() {
  providers.clear();
}

module.exports = {
  registerProvider,
  ensureProvider,
  getProvider,
  hasProvider,
  listProviderIds,
  resetRegistry,
};
