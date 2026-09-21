'use strict';

/**
 * Achado real do PILOT REAL (ERV1-CLOSE — pipeline hardened, provider de IA real, não fake):
 * DeepSeek sem saldo retorna HTTP 402 com `error.code: "invalid_request_error"` — um código de
 * categoria ampla do vocabulário DELES, não do nosso. `engineeringAiInvoker.js` antes desta
 * correção fazia `wrapped.code = err.code || FAILURE_CODES.PROVIDER_UNAVAILABLE`, que herdava
 * esse valor externo sempre que não era `undefined`/`null` — então essa falha real NUNCA virava
 * `PROVIDER_UNAVAILABLE` no nosso domínio, e o mecanismo de reroute (ERV1-CLOSE-008) nunca
 * disparava: a task ficava reenviando pro MESMO provider sem saldo até esgotar max_iterations,
 * mesmo havendo outro provider real disponível e com saldo.
 *
 * Corrigido: `wrapped.code` é SEMPRE `PROVIDER_UNAVAILABLE` (toda falha de invocação é candidata
 * a reroute no nosso domínio); o status/código ORIGINAL do provider fica preservado em
 * `httpStatus`/`providerErrorCode` para `classifyModelFailure` decidir o estado real.
 */

const modelAvailabilityStore = require('../../api/services/engineeringRouter/modelAvailabilityStore');
const { classifyModelFailure } = modelAvailabilityStore;
const { FAILURE_CODES } = require('../../engine/engineeringRouter/constants');

describe('engineeringRouter/modelAvailabilityStore — classifyModelFailure', () => {
  test('HTTP 402 (sem saldo) é classificado como NO_CREDIT, nunca o fallback genérico', () => {
    const err = { httpStatus: 402, providerErrorCode: 'invalid_request_error', message: 'Insufficient Balance' };
    const result = classifyModelFailure(err);
    expect(result.state).toBe('NO_CREDIT');
  });

  test('mensagem "insufficient_quota" sem status estruturado ainda é reconhecida como NO_CREDIT', () => {
    const err = { message: 'Error: insufficient_quota for this account' };
    const result = classifyModelFailure(err);
    expect(result.state).toBe('NO_CREDIT');
  });

  test('NO_CREDIT usa TTL longo (não o TTL curto de falha transitória de rede)', () => {
    const err = { httpStatus: 402, message: 'Insufficient Balance' };
    const result = classifyModelFailure(err);
    expect(result.ttlMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  test('404 continua classificado como RETIRED (nenhuma regressão no comportamento existente)', () => {
    const err = { httpStatus: 404, message: 'model_not_found' };
    expect(classifyModelFailure(err).state).toBe('RETIRED');
  });

  test('401 continua classificado como AUTH_DENIED', () => {
    const err = { httpStatus: 401, message: 'invalid api key' };
    expect(classifyModelFailure(err).state).toBe('AUTH_DENIED');
  });

  test('429 continua classificado como RATE_LIMITED', () => {
    const err = { httpStatus: 429, message: 'rate limit exceeded' };
    expect(classifyModelFailure(err).state).toBe('RATE_LIMITED');
  });

  test('um modelo marcado NO_CREDIT fica indisponível para seleção (isUsable === false)', () => {
    modelAvailabilityStore.markUnavailable('deepseek', 'deepseek-chat', classifyModelFailure({ httpStatus: 402, message: 'Insufficient Balance' }));
    expect(modelAvailabilityStore.isUsable('deepseek', 'deepseek-chat')).toBe(false);
    modelAvailabilityStore.markAvailable('deepseek', 'deepseek-chat');
  });
});

describe('engineeringRouter/engineeringAiInvoker — wrapped.code é sempre PROVIDER_UNAVAILABLE', () => {
  const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
  const { invokeModel } = require('../../api/services/engineeringRouter/engineeringAiInvoker');

  afterEach(() => clearAiProviderConfig());

  test('erro real com error.code externo (ex.: "invalid_request_error" do DeepSeek) nunca sobrescreve o wrapped.code do nosso domínio', async () => {
    registerAiProvider('anthropic', {
      async generate() {
        const err = new Error('Insufficient Balance');
        err.status = 402;
        err.code = 'invalid_request_error'; // código do VOCABULÁRIO DO PROVIDER, não o nosso
        throw err;
      },
    });

    await expect(invokeModel({ providerId: 'anthropic', modelId: 'x', prompt: 'p', tenantId: 'system' }))
      .rejects.toMatchObject({ code: FAILURE_CODES.PROVIDER_UNAVAILABLE, httpStatus: 402, providerErrorCode: 'invalid_request_error' });
  });

  test('erro sem nenhum .code/.status externo ainda vira PROVIDER_UNAVAILABLE (comportamento pré-existente preservado)', async () => {
    registerAiProvider('anthropic', {
      async generate() {
        throw new Error('timeout de rede genérico');
      },
    });

    await expect(invokeModel({ providerId: 'anthropic', modelId: 'x', prompt: 'p', tenantId: 'system' }))
      .rejects.toMatchObject({ code: FAILURE_CODES.PROVIDER_UNAVAILABLE, httpStatus: null, providerErrorCode: null });
  });
});
