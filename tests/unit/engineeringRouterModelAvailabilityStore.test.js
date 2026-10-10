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

// CONFIABILIDADE (2026-10-08) — ESTADOS IMUTÁVEIS.
//
// DEFEITO MEDIDO na auditoria: RETIRED era apenas uma entrada com TTL (`DEFAULT_TTL_MS` = 1h).
// Passada a hora, `getAvailability` APAGAVA o registro, o estado voltava a `UNKNOWN` e
// `isUsable(UNKNOWN) === true` — o Router voltava a escolher um modelo que o provider já havia
// dito que NÃO EXISTE (404 "not a chat model"/"deprecated"), queimando uma tentativa por hora,
// para sempre. "Não existe nesta conta" é um FATO do provider: nenhum tempo decorrido o desfaz.
describe('modelAvailabilityStore — estados imutáveis (RETIRED não volta por decurso de tempo)', () => {
  const ERRO_404 = () => Object.assign(new Error('this is not a chat model'), { httpStatus: 404 });

  beforeEach(() => modelAvailabilityStore._clearAllForTests());

  test('404 é classificado como RETIRED SEM expiração automática', () => {
    const classified = classifyModelFailure(ERRO_404());
    expect(classified.state).toBe('RETIRED');
    expect(classified.ttlMs).toBeNull();
  });

  test('RETIRED não expira: a entrada permanece e o modelo continua fora da seleção', () => {
    modelAvailabilityStore.markUnavailable('openai', 'gpt-5-codex', classifyModelFailure(ERRO_404()));

    const entry = modelAvailabilityStore.getAvailability('openai', 'gpt-5-codex');
    expect(entry.availability).toBe('RETIRED');
    expect(entry.expiresAt).toBeNull();
    expect(modelAvailabilityStore.isUsable('openai', 'gpt-5-codex')).toBe(false);
    expect(modelAvailabilityStore.isHardState('RETIRED')).toBe(true);
  });

  test('ttlMs explícito NÃO vence um estado hard (nem `now + null` = expiração imediata)', () => {
    modelAvailabilityStore.markUnavailable('openai', 'm', { state: 'RETIRED', ttlMs: 1000 });
    expect(modelAvailabilityStore.getAvailability('openai', 'm').expiresAt).toBeNull();
    expect(modelAvailabilityStore.isUsable('openai', 'm')).toBe(false);
  });

  test('só PROVA POSITIVA reabilita: um sucesso real limpa o RETIRED', () => {
    modelAvailabilityStore.markUnavailable('openai', 'gpt-5-codex', classifyModelFailure(ERRO_404()));
    expect(modelAvailabilityStore.isUsable('openai', 'gpt-5-codex')).toBe(false);

    modelAvailabilityStore.markAvailable('openai', 'gpt-5-codex');
    expect(modelAvailabilityStore.isUsable('openai', 'gpt-5-codex')).toBe(true);
    expect(modelAvailabilityStore.getAvailability('openai', 'gpt-5-codex').availability).toBe('UNKNOWN');
  });

  test('controle: RATE_LIMITED continua TEMPORAL (é falha transitória de verdade)', () => {
    const classified = classifyModelFailure(Object.assign(new Error('rate limit'), { httpStatus: 429 }));
    expect(classified.ttlMs).toBe(5 * 60 * 1000);
    modelAvailabilityStore.markUnavailable('anthropic', 'm', classified);
    expect(typeof modelAvailabilityStore.getAvailability('anthropic', 'm').expiresAt).toBe('number');
  });

  test('controle: AUTH_DENIED continua temporal (a credencial pode ser rotacionada)', () => {
    modelAvailabilityStore.markUnavailable('anthropic', 'm2', classifyModelFailure(Object.assign(new Error('unauthorized'), { httpStatus: 401 })));
    expect(typeof modelAvailabilityStore.getAvailability('anthropic', 'm2').expiresAt).toBe('number');
    expect(modelAvailabilityStore.isHardState('AUTH_DENIED')).toBe(false);
  });

  test('controle: NO_CREDIT continua com TTL longo e definido (não é hard state)', () => {
    const classified = classifyModelFailure(Object.assign(new Error('insufficient balance'), { httpStatus: 402 }));
    expect(classified.state).toBe('NO_CREDIT');
    expect(classified.ttlMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
