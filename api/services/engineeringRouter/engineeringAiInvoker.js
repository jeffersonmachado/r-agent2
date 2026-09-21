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
    // Achado real do PILOT REAL (provider de IA real, não fake): `err.code` aqui é o código de
    // erro EXTERNO da API do provider (ex.: DeepSeek sem saldo retorna
    // `error.code: "invalid_request_error"`, um código genérico do vocabulário DELES, não do
    // nosso). O `wrapped.code = err.code || FAILURE_CODES.PROVIDER_UNAVAILABLE` antigo herdava
    // esse valor externo sempre que não era `undefined`/`null` — então QUALQUER falha real cujo
    // provider retornasse um `error.code` próprio (comum: rate limit, sem saldo, request
    // inválido) nunca virava `PROVIDER_UNAVAILABLE`, e o reroute (ERV1-CLOSE-008) nunca disparava:
    // a task ficava reenviando pro MESMO provider sem saldo até esgotar max_iterations, mesmo
    // havendo outro provider real disponível. Toda falha de invocação é candidata a reroute no
    // nosso domínio — `wrapped.code` é SEMPRE PROVIDER_UNAVAILABLE; o código/status ORIGINAL do
    // provider fica preservado em `httpStatus`/`providerErrorCode` para
    // `modelAvailabilityStore.classifyModelFailure` decidir o estado real (RETIRED/AUTH_DENIED/
    // NO_CREDIT/RATE_LIMITED/genérico).
    const wrapped = new Error(`Falha ao invocar ${providerId}:${modelId} — ${err.message}`);
    wrapped.code = FAILURE_CODES.PROVIDER_UNAVAILABLE;
    wrapped.httpStatus = err.httpStatus ?? err.status ?? null;
    wrapped.providerErrorCode = err.code ?? null;
    wrapped.cause = err;
    wrapped.latencyMs = Date.now() - startedAt;
    throw wrapped;
  }
}

module.exports = {
  DEFAULT_TENANT_ID,
  invokeModel,
};
