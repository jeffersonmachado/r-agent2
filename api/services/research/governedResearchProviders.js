'use strict';

/**
 * Governed Research Providers — egress de pesquisa pelo provider GOVERNADO.
 *
 * PROBLEMA (P0 medido 2026-09-18): os módulos de rotas de benchmark e de
 * descoberta de mercado injetavam o provider NATIVO como DEFAULT
 * (`defaultResearchProviders` → `createNativeResearchProvider()`). O caminho
 * padrão de pesquisa pública do RAP Core era, portanto:
 *
 *   Benchmark/Market Discovery → provider nativo → Internet
 *
 * O provider nativo faz egress de rede direto de dentro do Core. Ele não passa
 * pelo Canonical Tool Registry, não passa pelo MCP Control Plane e não pode ser
 * revogado por configuração — um agente que "pede `research.search`" recebia,
 * na prática, acesso irrestrito a partir do processo do Core.
 *
 * Caminho correto:
 *
 *   Benchmark/Market Discovery
 *     → Canonical Tool Registry
 *     → capability canônica `research.*`
 *     → resolução de provider (determinística, auditável)
 *     → MCP `mcp-research` (ou outro provider externo AUTORIZADO)
 *
 * Regras:
 *  - os runners abaixo delegam ao REGISTRY: quem executa é a tool registrada
 *    (com tenant, permissão, visibilidade, schema, política e auditoria);
 *  - apenas providers EXTERNOS são considerados aqui. Incluir o nativo
 *    causaria recursão (as capabilities nativas `rap.research.*` chamam os
 *    runners) e reintroduziria o caminho que esta camada existe para fechar;
 *  - o provider NATIVO continua existindo, mas só como OPT-IN EXPLÍCITO
 *    (`RESEARCH_NATIVE_PROVIDER_ENABLED`), auditável em log;
 *  - sem provider governado e sem opt-in, o conjunto de runners é VAZIO e o
 *    supervisor reporta `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS` com a lista
 *    nominal das capabilities ausentes — fail closed, nunca fallback silencioso
 *    para egress direto do Core.
 */

const {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
} = require('../benchmark/researchCapabilities');
const { resolveCapabilityProviders } = require('../../../src/core/mcp/capability-resolution');

/** Fonte que identifica um proxy de MCP externo no Canonical Tool Registry. */
const EXTERNAL_MCP_SOURCE = 'external_mcp';

/** Opt-in EXPLÍCITO de egress nativo. Nunca default, nunca implícito. */
const NATIVE_OPT_IN_ENV = 'RESEARCH_NATIVE_PROVIDER_ENABLED';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Egress nativo foi explicitamente autorizado? `1`/`true` apenas.
 * Qualquer outro valor (inclusive ausente) mantém o fechamento.
 */
function isNativeResearchProviderEnabled(env = process.env) {
  const raw = String(env?.[NATIVE_OPT_IN_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * Providers EXTERNOS registrados para uma capability de pesquisa.
 *
 * @returns {Array<object>} candidatos com `metadata.source === 'external_mcp'`
 */
function externalProvidersFor({ registry, capability, actor }) {
  if (!registry || typeof registry.list !== 'function') return [];
  let candidates = [];
  try {
    candidates = resolveCapabilityProviders({ registry, capability, actor });
  } catch (_) {
    return [];
  }
  return candidates.filter((candidate) => {
    const canonical = candidate?.tool ? registry.get(candidate.id) : null;
    return canonical?.metadata?.source === EXTERNAL_MCP_SOURCE;
  });
}

/**
 * Runners de pesquisa resolvidos pelo REGISTRY (nunca por cliente HTTP próprio).
 *
 * @param {object} args
 * @param {object} args.registry Canonical Tool Registry (com as tools MCP já registradas)
 * @param {object} args.actor    principal governado (permissões + classificação)
 * @param {string} args.tenantId tenant do run (SYSTEM para pesquisa)
 * @returns {{runners: object, available: string[], missing: string[], toolIds: object}}
 */
function resolveGovernedResearchRunners({ registry, actor, tenantId } = {}) {
  const runners = {};
  const available = [];
  const missing = [];
  const toolIds = {};

  for (const definition of RESEARCH_CAPABILITIES) {
    const providers = externalProvidersFor({ registry, capability: definition.capability, actor });
    if (providers.length === 0) {
      missing.push(definition.capability);
      continue;
    }
    const provider = providers[0];
    toolIds[definition.capability] = provider.id;
    available.push(definition.capability);
    runners[definition.runner] = async (input = {}) => {
      const result = await registry.execute(provider.id, input, {
        tenantId,
        actor,
        confirmed: false,
      });
      return result.output;
    };
  }

  return { runners, available, missing, toolIds };
}

module.exports = {
  EXTERNAL_MCP_SOURCE,
  NATIVE_OPT_IN_ENV,
  isNativeResearchProviderEnabled,
  externalProvidersFor,
  resolveGovernedResearchRunners,
  RESEARCH_CAPABILITY_IDS,
  isNonEmptyString,
};
