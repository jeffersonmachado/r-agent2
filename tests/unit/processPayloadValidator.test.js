'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessPayloadValidator } = require('../../api/core/process-runtime/processPayloadValidator');

describe('ProcessPayloadValidator edge cases', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('ignora waitingState hostil sem schema e segue como payload valido', withTimeout(async () => {
    const validator = new ProcessPayloadValidator();
    const { proxy: waitingState, revoke } = Proxy.revocable({}, {});
    revoke();

    const result = validator.validatePayload({
      waitingState,
      payload: { ok: true },
    });

    expect(result.ok).toBe(true);
    expect(result.schema).toBeNull();
    expect(result.payload).toEqual({ ok: true });
  }, 5000));

  test('retorna erro estruturado quando schema hostil quebra compilacao', withTimeout(async () => {
    const validator = new ProcessPayloadValidator();
    const hostileSchema = new Proxy({}, {
      get() {
        throw new Error('schema_getter_boom');
      },
      ownKeys() {
        throw new Error('schema_ownKeys_boom');
      },
    });

    const result = validator.validatePayload({
      node: {
        config: {
          resumeSchema: hostileSchema,
        },
      },
      payload: { text: 'ok' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('resume_schema_invalid');
    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
  }, 5000));

  test('retorna erro estruturado quando payload hostil quebra validacao', withTimeout(async () => {
    const validator = new ProcessPayloadValidator();
    const schema = {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    };
    const { proxy: payload, revoke } = Proxy.revocable({ text: 'ok' }, {});
    revoke();

    const result = validator.validatePayload({
      node: {
        config: {
          resumeSchema: schema,
        },
      },
      payload,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('resume_payload_invalid');
    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
  }, 5000));

  test('safeClone retorna null quando schema nao e serializavel (toJSON que lanca)', withTimeout(async () => {
    const validator = new ProcessPayloadValidator();
    // Schema válido para AJV compilar (sem required → aceita {}), mas
    // .toJSON() lança → JSON.stringify falha → safeClone retorna null
    const schema = { type: 'object', properties: {} };
    Object.defineProperty(schema, 'toJSON', {
      value() { throw new Error('not serializable'); },
      enumerable: false,
    });

    const result = validator.validatePayload({
      node: { config: { resumeSchema: schema } },
      payload: {},
    });

    // ok=true pois payload é válido; schema retornado é null (safeClone falhou)
    expect(result.ok).toBe(true);
    expect(result.schema).toBeNull();
  }, 5000));

  test('AJV error items hostis nao disparam excecao no map()', withTimeout(async () => {
    const validator = new ProcessPayloadValidator();
    const schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };

    // Payload inválido (falta "name") para gerar validator.errors
    const result = validator.validatePayload({
      node: { config: { resumeSchema: schema } },
      payload: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('resume_payload_invalid');
    // Os detalhes devem ser mapeados sem jogar exceção
    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
    // Cada detalhe tem campos seguros
    for (const detail of result.details) {
      expect(typeof detail.path).toBe('string');
      expect(typeof detail.message).toBe('string');
    }
  }, 5000));
});
