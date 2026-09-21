'use strict';

/**
 * api/services/engineeringRouter/engineeringAiInvoker.js
 *
 * Ponto único de chamada de modelo para o Engineering Model Router. Reutiliza
 * `aiProviderManager.getProviderInstance(providerId)` — o provider JÁ registrado no boot real
 * (`api/services/aiProviderService.initializeAiProviders`), portanto já embrulhado em circuit
 * breaker (`aiControlPlaneStatus.wrapProviderGenerate`) e timeout
 * (`aiProviderManager.resolveAiTimeoutMs`). Não abre conexão nova, não reimplementa retry.
 *
 * O `providerId`/`modelId` chamados aqui são SEMPRE uma decisão do Router (capability fit +
 * policy), nunca uma escolha do próprio LLM.
 */

const { getProviderInstance } = require('../aiProviderManager');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');

const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';

/**
 * @param {Object} params
 * @param {string} params.providerId
 * @param {string} params.modelId
 * @param {string} params.prompt
 * @param {string} [params.tenantId]
 * @param {Object} [params.extraContext]
 * @returns {Promise<{text:string, usage:Object|null, latencyMs:number, providerId:string, modelId:string}>}
 */
async function invokeModel({ providerId, modelId, prompt, tenantId = DEFAULT_TENANT_ID, extraContext = {} }) {
  const provider = getProviderInstance(providerId);
  const startedAt = Date.now();

  if (!provider) {
    const err = new Error(`Provider não registrado no engine de IA: ${providerId}`);
    err.code = FAILURE_CODES.PROVIDER_UNAVAILABLE;
    throw err;
  }

  try {
    const result = await provider.generate(prompt, {
      ...extraContext,
      tenantId,
      model: modelId,
      source: 'engineering-router',
      purpose: extraContext.purpose || 'engineering_router',
    });
    return {
      text: result?.text || '',
      usage: result?.usage || null,
      latencyMs: Date.now() - startedAt,
      providerId,
      modelId,
    };
  } catch (err) {
    const wrapped = new Error(`Falha ao invocar ${providerId}:${modelId} — ${err.message}`);
    wrapped.code = err.code || FAILURE_CODES.PROVIDER_UNAVAILABLE;
    wrapped.cause = err;
    wrapped.latencyMs = Date.now() - startedAt;
    throw wrapped;
  }
}

module.exports = {
  DEFAULT_TENANT_ID,
  invokeModel,
};
