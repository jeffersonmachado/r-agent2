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
});
