'use strict';

const { mergeEntities } = require('../entityMerger');

describe('entityMerger', () => {
  test('respeita precedência de source e confidence', () => {
    const prev = {
      email: { value: 'cliente@x.com', source: 'regex', confidence: 0.7, updated_at: '2026-01-01T10:00:00.000Z' },
    };
    const incoming = {
      email: { value: 'cliente@x.com', source: 'user', confidence: 0.6, updated_at: '2026-01-01T11:00:00.000Z' },
    };

    const merged = mergeEntities(prev, {}, incoming, {});
    expect(merged.entities.email.source).toBe('user');
    expect(merged.meta.email.source).toBe('user');
  });

  test('mantém múltiplos ids quando relevantes', () => {
    const prev = {
      order_id: { value: 'A100', source: 'regex', confidence: 0.7, updated_at: '2026-01-01T10:00:00.000Z' },
    };
    const incoming = {
      order_id: { value: 'B200', source: 'regex', confidence: 0.72, updated_at: '2026-01-01T11:00:00.000Z' },
    };

    const merged = mergeEntities(prev, {}, incoming, {});
    expect(Array.isArray(merged.entities.order_id)).toBe(true);
    expect(merged.entities.order_id).toHaveLength(2);
  });
});
