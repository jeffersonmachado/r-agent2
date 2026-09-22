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
const modelCatalogService = require('./modelCatalogService');
const { getRuntimeProviders } = require('../aiProviderRegistryService');
const { getBreakerStates } = require('../aiControlPlaneStatus');
const { getCredentialDetailsMap, getDecryptedAPIKey } = require('../tenantAIService');
const modelAvailabilityStore = require('./modelAvailabilityStore');
const providerModelDiscoveryCache = require('./providerModelDiscoveryCache');
const logger = require('../../utils/logger');

const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';
const KNOWN_BAD_CREDENTIAL_STATUSES = new Set(['no_credit', 'invalid_token']);

/**
 * ER-V1-FINAL-008: reconcilia o catálogo governado para um provider cuja lista real de modelos
 * (`knownModelIds`, resultado positivo e recente do discovery real) acabou de ser obtida.
 * Best-effort — nunca lança (cada `reconcileDiscoveredModel` já engole a própria falha).
 */
async function reconcileProviderCatalog(providerId, knownModelIds) {
  const mappedEntriesForProvider = listCapabilityEntries().filter((e) => e.providerId === providerId);
  const mappedModelIds = new Set(mappedEntriesForProvider.map((e) => e.modelId));

  const jobs = [];
  for (const entry of mappedEntriesForProvider) {
    jobs.push(modelCatalogService.reconcileDiscoveredModel({
      providerId,
      modelId: entry.modelId,
      isMapped: true,
      listedByProviderNow: knownModelIds.has(entry.modelId),
      evidence: { source: 'provider_discovery', checkedAt: new Date().toISOString() },
    }));
  }
  for (const modelId of knownModelIds) {
    if (mappedModelIds.has(modelId)) continue;
    jobs.push(modelCatalogService.reconcileDiscoveredModel({
      providerId,
      modelId,
      isMapped: false,
      listedByProviderNow: true,
      evidence: { source: 'provider_discovery', checkedAt: new Date().toISOString() },
    }));
  }
  await Promise.all(jobs);
}

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

  // Achado real de um pilot com providers de IA reais: um modelo mapeado em
  // modelCapabilities.js (allowlist estática de segurança, nunca removida) pode não estar mais
  // habilitado para a credencial configurada — a V1 só descobria isso de forma REATIVA (tentava
  // rotear, gastava uma chamada real, falhava com "model not found/permission denied"). Consulta
  // PROATIVA (com cache de 15min — nunca uma chamada de rede por seleção) de quais modelIds a
  // credencial de cada provider distinto usado nesta lista realmente pode usar agora. Fail-open
  // por design: quando a consulta falha/não é suportada pelo provider, `knownModelIds` é `null`
  // e NENHUM filtro extra é aplicado (o comportamento reativo pré-existente continua sendo o
  // fallback) — esta camada só pode EXCLUIR um candidato da allowlist estática, nunca incluir um
  // modelo não mapeado.
  const distinctProviderIds = [...new Set(entries.map((e) => e.providerId))];
  const knownModelIdsByProvider = new Map();
  await Promise.all(distinctProviderIds.map(async (providerId) => {
    const credentialInfo = credentialDetails[providerId];
    // Discovery só roda para credencial já confirmada `valid` por um teste real anterior —
    // nunca para `unknown` (nunca testada). Achado real ao integrar isto: os testes E2E do
    // Router salvam credenciais FAKE (status `unknown` por padrão, nunca testadas de verdade) —
    // sem esta restrição, cada attempt disparava uma chamada de REDE REAL contra a API do
    // provider com uma chave fake (sempre caindo em fail-open depois de um timeout), tornando
    // testes que deveriam ser herméticos lentos e dependentes de rede externa à toa.
    if (credentialInfo?.status !== 'valid') return;
    try {
      const apiKey = await getDecryptedAPIKey(tenantId, providerId);
      if (!apiKey) return;
      const modelIds = await providerModelDiscoveryCache.resolveKnownModelIds(providerId, tenantId, apiKey);
      if (modelIds) {
        const knownSet = new Set(modelIds);
        knownModelIdsByProvider.set(providerId, knownSet);
        // ER-V1-FINAL-008 (Current Model Catalog): o discovery real já era usado só para
        // EXCLUIR candidatos mapeados que sumiram (ver uso de `knownModelIdsByProvider` abaixo).
        // Reconcilia também o catálogo governado, nas duas direções, best-effort (nunca bloqueia
        // nem derruba o roteamento real, que continua decidindo elegibilidade só pela allowlist
        // estática — ver modelCatalogPolicy.js):
        //   - modelo real listado pelo provider mas AUSENTE da allowlist estática → DISCOVERED,
        //     auditável, nunca elegível automaticamente;
        //   - modelo mapeado na allowlist estática que o provider deixou de listar → RETIRED.
        await reconcileProviderCatalog(providerId, knownSet).catch((err) => {
          logger.warn('[engineeringModelAvailability] falha ao reconciliar catálogo de modelos', { providerId, error: err.message });
        });
      }
    } catch (err) {
      // Fail-open: falha ao descobrir modelos reais nunca bloqueia o roteamento — só significa
      // que esta camada extra de filtro não se aplica desta vez.
      logger.warn('[engineeringModelAvailability] falha ao descobrir modelos reais do provider', { providerId, error: err.message });
    }
  }));

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
    let available = modelAvailabilityStore.isUsable(entry.providerId, entry.modelId);
    let availabilityReason = available ? null : (modelAvailability.reason || modelAvailability.availability);

    // Discovery proativo: se sabemos de verdade quais modelos o provider expõe para esta
    // credencial, e este modelId mapeado não está entre eles, marca indisponível ANTES de
    // qualquer tentativa real — nunca sobrescreve um `available:false` reativo já mais
    // específico (RATE_LIMITED, NO_CREDIT etc. continuam com seu motivo original).
    if (available) {
      const knownModelIds = knownModelIdsByProvider.get(entry.providerId);
      if (knownModelIds && !knownModelIds.has(entry.modelId)) {
        available = false;
        availabilityReason = 'MODEL_NOT_LISTED_BY_PROVIDER';
      }
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
      available,
      availabilityReason,
    });
  }

  return results;
}

module.exports = {
  DEFAULT_TENANT_ID,
  buildAvailableModels,
};
