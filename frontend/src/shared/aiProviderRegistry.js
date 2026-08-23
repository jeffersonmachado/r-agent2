/**
 * Wrapper ES module para engine/aiProviderRegistry.js (CommonJS)
 *
 * Permite que o frontend consuma o registry central de providers de IA
 * (fonte única) como um ES module.
 */

import * as backendModule from '../../../engine/aiProviderRegistry.js';

const module = backendModule.default || backendModule;

export const AI_PROVIDERS = module.AI_PROVIDERS || {};
export const SUPPORTED_PROVIDER_IDS = module.SUPPORTED_PROVIDER_IDS || [];

export function getProvider(id) {
  return (module.getProvider && module.getProvider(id)) || null;
}

export function isSupportedProvider(id) {
  return Boolean(module.isSupportedProvider && module.isSupportedProvider(id));
}

export function getProviders() {
  return (module.getProviders && module.getProviders()) || Object.values(AI_PROVIDERS);
}

export function getProviderIds() {
  return (module.getProviderIds && module.getProviderIds()) || Object.keys(AI_PROVIDERS);
}
