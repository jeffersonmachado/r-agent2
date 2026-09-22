'use strict';

/**
 * engine/engineeringRouter/modelCatalogPolicy.js — ER-V1-FINAL-008 (Current Model Catalog).
 *
 * Módulo puro (sem I/O). Decide, a partir de fatos observados (o modelo está na allowlist
 * estática? o discovery real confirmou que o provider ainda o lista?), qual estado de catálogo
 * um `providerId:modelId` deve ter, e se esse estado torna o modelo elegível para roteamento.
 *
 * Regra central: elegibilidade real do Router SEMPRE depende de `modelCapabilities.js`
 * (allowlist estática versionada em código) — este módulo NUNCA introduz uma segunda fonte de
 * elegibilidade a partir de dados persistidos em banco. `isEligibleForRisk` aqui existe para
 * tornar essa regra explícita e testável isoladamente, refletindo exatamente o que
 * `engineeringModelAvailabilityService.buildAvailableModels` já faz na prática (só itera sobre
 * `listCapabilityEntries()`, nunca sobre modelos descobertos e não mapeados).
 */

const { MODEL_CATALOG_STATUSES } = require('./constants');

const STATUS_SET = new Set(MODEL_CATALOG_STATUSES);
const ELIGIBLE_STATUSES = new Set(['APPROVED']);

/**
 * @param {{isMapped: boolean, listedByProviderNow: boolean|null, previousStatus?: string|null}} facts
 *   - isMapped: true se `providerId:modelId` existe em `modelCapabilities.js`.
 *   - listedByProviderNow: true/false quando o discovery real deu uma resposta positiva (sabemos
 *     de verdade o que o provider lista agora); `null`/`undefined` quando o discovery não rodou
 *     ou falhou (fail-open — nenhuma confirmação disponível).
 *   - previousStatus: status de catálogo já persistido para este par, se houver. `DENIED` nunca
 *     é sobrescrito automaticamente por este resolver (só decisão humana explícita remove DENIED).
 * @returns {string} um valor de MODEL_CATALOG_STATUSES.
 */
function resolveCatalogStatus({ isMapped, listedByProviderNow = null, previousStatus = null }) {
  if (previousStatus === 'DENIED') return 'DENIED';

  if (isMapped) {
    // Confirmação POSITIVA e recente de que o provider não lista mais este modelo mapeado.
    if (listedByProviderNow === false) return 'RETIRED';
    return 'APPROVED';
  }

  // Não mapeado na allowlist estática: só vira um estado de catálogo governado quando o
  // discovery real de fato listou este modelId (evidência positiva de existência) — um modelId
  // desconhecido citado sem nenhuma confirmação do provider não gera ruído no catálogo.
  if (listedByProviderNow === true) {
    if (previousStatus === 'CLASSIFIED') return 'CLASSIFIED';
    return 'DISCOVERED';
  }

  return previousStatus && STATUS_SET.has(previousStatus) ? previousStatus : 'DISCOVERED';
}

/**
 * Elegibilidade é binária e conservadora: só APPROVED (= mapeado na allowlist estática) é
 * elegível, para QUALQUER risco. Não existe uma regra "HIGH/CRITICAL é mais restritivo que
 * LOW/MEDIUM" aqui — a spec exige explicitamente que HIGH/CRITICAL nunca aceitem modelo
 * unclassified, e a forma fail-closed mais simples de garantir isso é nunca aceitar unclassified
 * para risco NENHUM.
 */
function isEligibleForRisk(status, _risk) {
  return ELIGIBLE_STATUSES.has(status);
}

module.exports = {
  resolveCatalogStatus,
  isEligibleForRisk,
};
