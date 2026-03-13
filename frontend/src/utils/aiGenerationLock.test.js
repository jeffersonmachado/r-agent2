import { describe, it, expect } from 'vitest';
import { shouldLockCanvas } from './aiGenerationLock';

describe('utils/aiGenerationLock', () => {
  it('não bloqueia sem aiGeneration', () => {
    expect(shouldLockCanvas(null)).toBe(false);
    expect(shouldLockCanvas(undefined)).toBe(false);
  });

  it('bloqueia quando usedFallback=true', () => {
    expect(shouldLockCanvas({ usedFallback: true, attempts: [{ attempt: 1, ok: true }] })).toBe(true);
  });

  it('não bloqueia quando attempts.length > 1 (auto-correção)', () => {
    expect(shouldLockCanvas({ usedFallback: false, attempts: [{}, {}] })).toBe(false);
  });

  it('não bloqueia quando attempts.length === 1 e usedFallback=false', () => {
    expect(shouldLockCanvas({ usedFallback: false, attempts: [{}] })).toBe(false);
  });

  it('bloqueia quando reviewRequired=true (compatibilidade futura)', () => {
    expect(shouldLockCanvas({ usedFallback: false, reviewRequired: true, attempts: [{}, {}] })).toBe(true);
  });
});

