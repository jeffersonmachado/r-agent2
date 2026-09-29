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
const { runWithDeadline, isDeadlineError } = require('../../utils/operationDeadline');

const DEFAULT_TENANT_ID = process.env.ENGINEERING_ROUTER_TENANT_ID || 'system';

function recordProviderTimeout(providerId, err) {
  try {
    // eslint-disable-next-line global-require
    require('../aiControlPlaneStatus').recordProviderTimeout(providerId, { message: err.message });
  } catch (_) { /* control plane indisponível em teste isolado — telemetria segue pelo deadline */ }
}

/**
 * Chamada de modelo governada pelo EXECUTION DEADLINE MANAGER (política `PROVIDER_REQUEST`):
 *
 *   request starts → deadline resolvido (respeitando o orçamento do pai) → AbortSignal real no
 *   transporte → expiração ⇒ PROVIDER_TIMEOUT classificado → health do provider (circuit breaker)
 *   → erro sobe como PROVIDER_UNAVAILABLE para o Router aplicar retry/fallback.
 *
 * NUNCA: provider timeout → kill do worker ou da missão. A expiração é LOCAL à tentativa.
 *
 * @param {Object} params
 * @param {string} params.providerId
 * @param {string} params.modelId
 * @param {string} params.prompt
 * @param {string} [params.tenantId]
 * @param {Object} [params.extraContext]
 * @param {AbortSignal} [params.signal] cancelamento cooperativo do chamador (lease perdido/NO_PROGRESS)
 * @param {Object} [params.deadlineMeta] missionId/taskId/phase/parentDeadlineAtMs para a telemetria
 * @returns {Promise<{text:string, usage:Object|null, latencyMs:number, providerId:string, modelId:string}>}
 */
async function invokeModel({ providerId, modelId, prompt, tenantId = DEFAULT_TENANT_ID, extraContext = {}, signal = null, deadlineMeta = {} }) {
  const provider = getProviderInstance(providerId, { deadlineManaged: true });
  const startedAt = Date.now();

  if (!provider) {
    const err = new Error(`Provider não registrado no engine de IA: ${providerId}`);
    err.code = FAILURE_CODES.PROVIDER_UNAVAILABLE;
    throw err;
  }

  const { parentDeadlineAtMs = null, ...meta } = deadlineMeta || {};
  try {
    const result = await runWithDeadline('PROVIDER_REQUEST', (deadlineSignal) => provider.generate(prompt, {
      ...extraContext,
      tenantId,
      model: modelId,
      source: 'engineering-router',
      purpose: extraContext.purpose || 'engineering_router',
      signal: deadlineSignal,
    }), {
      operation: `provider:${extraContext.purpose || 'engineering_router'}`,
      parentSignal: signal,
      parentDeadlineAtMs,
      meta: { ...meta, provider: providerId, model: modelId },
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
    const timedOut = isDeadlineError(err) && err.deadlineCategory === 'PROVIDER_TIMEOUT';
    const cancelled = isDeadlineError(err) && err.deadlineCategory === 'OPERATION_CANCELLED';
    if (timedOut) recordProviderTimeout(providerId, err);
    if (cancelled) {
      // Cancelamento cooperativo (lease perdido / NO_PROGRESS) não é falha do provider: sobe com
      // o próprio código para o Router decidir, sem marcar o modelo como indisponível.
      throw err;
    }
    const wrapped = new Error(`Falha ao invocar ${providerId}:${modelId} — ${err.message}`);
    wrapped.code = FAILURE_CODES.PROVIDER_UNAVAILABLE;
    // Classe da falha preservada: PROVIDER_TIMEOUT é distinguível de indisponibilidade real.
    wrapped.failureClass = timedOut ? 'PROVIDER_TIMEOUT' : (err.code || 'PROVIDER_ERROR');
    wrapped.expiry = timedOut ? err.expiry : null;
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
