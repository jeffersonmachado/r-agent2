'use strict';

/**
 * Capability Resolution — resolução provider-neutral de capabilities.
 *
 * Uma CAPABILITY canônica (`crm.read`, `research.search`, `schedule.read`) pode
 * ser atendida por mais de um PROVIDER: a implementação nativa do RAP, uma tool
 * de MCP externo, ou (no futuro) um fornecedor alternativo. Quem consome pede a
 * CAPABILITY — nunca o provider, o host ou o nome da conexão.
 *
 * Regras (§53 do Control Plane MCP):
 *  - seleção DETERMINÍSTICA (nunca "o LLM escolheu");
 *  - `native` tem precedência quando disponível;
 *  - fallback automático para provider externo é permitido apenas quando
 *    semanticamente seguro (operação sem side effect);
 *  - a decisão é AUDITÁVEL: devolve `reason`, não um booleano opaco;
 *  - provider com escopo de entidade declarado só é elegível para os tipos
 *    declarados; provider SEM escopo declarado é elegível (não é entity-bound);
 *  - provider de MCP externo (`metadata.source = 'external_mcp'`) é ligado ao
 *    tenant da conexão (`metadata.tenantId`): nunca é elegível para ator de
 *    outro tenant ou sem tenant (fail closed; cross-tenant exigiria delegação
 *    persistida explícita, que não existe).
 */

const NATIVE_PROVIDER = 'native';

/**
 * Provider de uma tool canônica: `native` (metadado explícito ou namespace
 * `askai.`/`rap.`) ou o provider declarado (ex.: `external`/`mcp`).
 * Nunca inferido de hostname.
 */
function providerOf(tool) {
  const declared = tool?.metadata?.provider;
  if (declared) return String(declared);
  const id = String(tool?.id || '');
  if (id.startsWith('askai.') || id.startsWith('rap.')) return NATIVE_PROVIDER;
  return 'external';
}

/**
 * Lista os providers disponíveis para uma capability.
 *
 * @param {object} args
 * @param {object} args.registry    Canonical Tool Registry
 * @param {string} args.capability  capability canônica
 * @param {string} [args.entityType]
 * @param {object} [args.actor]     `{ classification, permissions }`
 * @returns {Array<{id, capability, provider, sideEffects, tool}>}
 */
function resolveCapabilityProviders({ registry, capability, entityType = null, actor = null } = {}) {
  if (!registry || typeof registry.list !== 'function') {
    throw new Error('capability_resolution_registry_required');
  }
  const target = String(capability || '');
  const candidates = registry.list({
    classification: actor?.classification,
    permissions: actor?.permissions,
  });

  // Binding de tenant: um proxy de MCP externo declarado para o tenant X
  // (metadata.tenantId, gravado pelo External MCP Tool Adapter) só é elegível
  // para atores DESSE tenant. Ator sem tenant nunca resolve provider externo
  // (fail closed) — uso cross-tenant exigiria delegação persistida explícita,
  // que não existe: ausência de delegação é recusa, não exceção.
  const actorTenant = actor?.tenant || actor?.tenantId || null;

  return candidates
    .filter((tool) => tool.capability === target)
    .map((tool) => ({ tool, canonical: registry.get(tool.id) }))
    .filter(({ canonical }) => {
      if (canonical?.metadata?.source !== 'external_mcp') return true;
      const boundTenant = canonical?.metadata?.tenantId;
      if (!boundTenant) return true;
      return actorTenant !== null && String(actorTenant) === String(boundTenant);
    })
    .filter(({ canonical }) => {
      if (!entityType) return true;
      const entityTypes = canonical?.metadata?.entityTypes;
      if (!Array.isArray(entityTypes) || entityTypes.length === 0) return true;
      return entityTypes.includes(entityType);
    })
    .map(({ tool, canonical }) => ({
      id: tool.id,
      capability: tool.capability,
      provider: providerOf(canonical),
      sideEffects: tool.sideEffects === true,
      tool,
    }));
}

/**
 * Seleção determinística de provider.
 *
 * @param {Array<object>} providers
 * @param {object} [options]
 * @param {boolean} [options.requireSideEffectSafety=true] nunca faz fallback
 *   automático quando TODOS os candidatos têm side effect.
 * @param {boolean} [options.allowSideEffectFallback=false] opt-in EXPLÍCITO de
 *   política para permitir o fallback inseguro (ex.: contingência declarada).
 * @returns {{provider: object|null, reason: string, fallbackUsed: boolean, semanticSafety: string}}
 */
function selectProvider(providers = [], { requireSideEffectSafety = true, allowSideEffectFallback = false } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    return { provider: null, reason: 'no_provider_available', fallbackUsed: false, semanticSafety: 'no_candidate' };
  }

  const native = providers.find((p) => p.provider === NATIVE_PROVIDER);
  if (native) {
    return { provider: native, reason: 'native_preferred', fallbackUsed: false, semanticSafety: 'primary_provider' };
  }

  if (requireSideEffectSafety) {
    const allSideEffects = providers.every((p) => p.sideEffects);
    if (allSideEffects && !allowSideEffectFallback) {
      // Repetir uma mutação em outro provider pode duplicar a operação —
      // pior do que falhar. Fallback inseguro exige decisão de POLÍTICA.
      return {
        provider: null,
        reason: 'side_effect_provider_fallback_not_safe',
        fallbackUsed: false,
        semanticSafety: 'unsafe_requires_explicit_policy',
      };
    }
    const readOnly = providers.find((p) => !p.sideEffects);
    if (readOnly) {
      return {
        provider: readOnly,
        reason: 'external_read_only_provider_selected',
        fallbackUsed: true,
        semanticSafety: 'safe_read_only_fallback',
      };
    }
    if (allSideEffects && allowSideEffectFallback) {
      return {
        provider: providers[0],
        reason: 'side_effect_fallback_allowed_by_policy',
        fallbackUsed: true,
        semanticSafety: 'unsafe_allowed_by_explicit_policy',
      };
    }
  }

  return {
    provider: providers[0],
    reason: 'external_provider_selected',
    fallbackUsed: true,
    semanticSafety: providers[0].sideEffects ? 'unsafe_explicitly_allowed' : 'safe_read_only_fallback',
  };
}

/**
 * Resolve + seleciona em um passo.
 * @returns {{provider, reason, fallbackUsed, semanticSafety, providers}}
 */
function resolveProvider({ registry, capability, entityType = null, actor = null, options = {} } = {}) {
  const providers = resolveCapabilityProviders({ registry, capability, entityType, actor });
  const selection = selectProvider(providers, options);
  return { ...selection, providers };
}

module.exports = {
  NATIVE_PROVIDER,
  providerOf,
  resolveCapabilityProviders,
  selectProvider,
  resolveProvider,
};
