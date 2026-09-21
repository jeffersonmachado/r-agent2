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
 *   4. `api/services/tenantAIService.getCredentialDetailsMap(tenantId)` (credencial real por
 *      tenant + status do último teste real — ver nota abaixo)
 *
 * O tenant usado para checagem de credencial é configurável (`ENGINEERING_ROUTER_TENANT_ID`,
 * default `'system'` — o mesmo tenant interno já usado para chamadas de IA sem tenant real em
 * `api/modules/tenant/aiWorkflows.js`).
 *
 * Achado real: o circuit breaker do AI Control Plane (`aiControlPlaneStatus`) NÃO abre para
 * erros de billing/auth (402/401 — `BUDGET_BLOCK`/`AUTH` em `classifyProviderError`), de
 * propósito, porque esses erros são de uma CREDENCIAL específica, não de o provider estar fora
 * do ar para todo mundo. Sem isso, uma credencial restaurada sem saldo (ver
 * POST_RELEASE_MODEL_ROUTER_BACKLOG.md / manual §1) continuava sendo escolhida como CODER mais
 * barato indefinidamente, gastando tentativas reais em toda task nova. Por isso o `status`
 * persistido em `tenant_ai_credentials` (POST /tenants/:id/ai-credentials/test) também entra na
 * elegibilidade aqui: uma credencial com o último teste real confirmando `no_credit` ou
 * `invalid_token` não é tratada como "tem credencial usável" para fins de roteamento — mas
 * continua salva e visível na UI, nunca é apagada.
 */

const { listCapabilityEntries } = require('../../../engine/engineeringRouter/modelCapabilities');
const { getRuntimeProviders } = require('../aiProviderRegistryService');
const { getBreakerStates } = require('../aiControlPlaneStatus');
const { getCredentialDetailsMap } = require('../tenantAIService');
const modelAvailabilityStore = require('./modelAvailabilityStore');
const logger = require('../../utils/logger');

const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';
const KNOWN_BAD_CREDENTIAL_STATUSES = new Set(['no_credit', 'invalid_token']);

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

  let credentialDetails = {};
  try {
    credentialDetails = await getCredentialDetailsMap(tenantId);
  } catch (err) {
    logger.warn('[engineeringModelAvailability] falha ao checar credenciais', { error: err.message });
    credentialDetails = {};
  }

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

    const credentialInfo = credentialDetails[entry.providerId];
    // Credencial existe, mas o último teste real confirmou que está sem saldo/inválida: não
    // conta como "usável" para roteamento (o breaker global não cobre esse caso — ver nota no
    // topo do arquivo). Continua aparecendo como credencial configurada em qualquer outra tela.
    const hasCredential = Boolean(credentialInfo?.hasCredential)
      && !KNOWN_BAD_CREDENTIAL_STATUSES.has(credentialInfo?.status);

    // ERV1-CLOSE-008: provider healthy (breaker fechado) não implica que ESTE modelId
    // específico funcione — ver nota no topo do arquivo (gpt-5.5-pro/gpt-5-codex 404 reais
    // enquanto openai em si estava saudável). `available` é `false` quando uma falha real
    // recente marcou este providerId:modelId como RETIRED/AUTH_DENIED/RATE_LIMITED/etc.
    const modelAvailability = modelAvailabilityStore.getAvailability(entry.providerId, entry.modelId);
    const available = modelAvailabilityStore.isUsable(entry.providerId, entry.modelId);

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
      available,
      availabilityReason: available ? null : (modelAvailability.reason || modelAvailability.availability),
    });
  }

  return results;
}

module.exports = {
  DEFAULT_TENANT_ID,
  buildAvailableModels,
};
