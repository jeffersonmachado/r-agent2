import { describe, it, expect } from 'vitest';
import {
  FeatureFlagManager,
  RolloutStrategy,
  getFeatureFlagManager,
  initializeFeatureFlagManager,
} from '../../../../api/core/featureFlags';

describe('featureFlags edge cases', () => {
  it('nao quebra com flags invalidas em setTenantFlags/setUserFlags', () => {
    const manager = new FeatureFlagManager({ baseFlag: true });

    expect(() => manager.setTenantFlags('tenant-1', null)).not.toThrow();
    expect(() => manager.setUserFlags('user-1', undefined)).not.toThrow();
    expect(() => manager.setTenantFlags('', { a: true })).not.toThrow();
    expect(() => manager.setUserFlags('', { a: true })).not.toThrow();

    expect(manager.isEnabled('baseFlag')).toBe(true);
  });

  it('import ignora estruturas invalidas sem quebrar estado', () => {
    const manager = new FeatureFlagManager({ a: true });

    expect(() => manager.import({ config: null, tenantOverrides: 'x', userOverrides: 123 })).not.toThrow();
    expect(manager.isEnabled('a')).toBe(true);
  });

  it('gradual retorna fase neutra quando configuracao nao possui fases', () => {
    const strategy = RolloutStrategy.gradual({ startDate: new Date(Date.now() - 1000) });
    expect(strategy.getCurrentPhase()).toEqual({ phase: 0, percentage: 0 });
  });

  it('whitelist/blacklist/byGroup toleram entradas invalidas', () => {
    const whitelist = RolloutStrategy.whitelist(null);
    const blacklist = RolloutStrategy.blacklist(null);
    const byGroup = RolloutStrategy.byGroup(null);

    expect(whitelist.isEnabled('tenant-1')).toBe(false);
    expect(blacklist.isEnabled('tenant-1')).toBe(true);
    expect(byGroup.isEnabled({ group: 'ops' })).toBe(false);
  });

  it('singleton pode ser reinicializado de forma deterministica', () => {
    initializeFeatureFlagManager({ f1: true });
    const manager1 = getFeatureFlagManager();
    expect(manager1.isEnabled('f1')).toBe(true);

    initializeFeatureFlagManager({ f1: false, f2: true });
    const manager2 = getFeatureFlagManager();
    expect(manager2.isEnabled('f1')).toBe(false);
    expect(manager2.isEnabled('f2')).toBe(true);
  });

  it('ignora scope ids perigosos e nao aplica overrides com __proto__', () => {
    const manager = new FeatureFlagManager({ baseFlag: false });

    manager.setTenantFlags('__proto__', { hackedFlag: true });
    manager.setUserFlags('constructor', { hackedFlag: true });

    expect(manager.isEnabled('hackedFlag', { tenantId: '__proto__' })).toBe(false);
    expect(manager.isEnabled('hackedFlag', { userId: 'constructor' })).toBe(false);
    expect(manager.isEnabled('baseFlag')).toBe(false);
  });

  it('import sanitiza ids e chaves perigosas em overrides', () => {
    const manager = new FeatureFlagManager({ safeBase: true });

    manager.import({
      config: {
        safeBase: false,
        __proto__: true,
      },
      tenantOverrides: {
        '__proto__': { leak: true },
        'tenant-1': {
          safeFeature: true,
          constructor: true,
        },
      },
      userOverrides: {
        prototype: { leak: true },
        'user-1': {
          safeFeature: false,
          __proto__: true,
        },
      },
    });

    expect(manager.isEnabled('safeBase')).toBe(false);
    expect(manager.isEnabled('safeFeature', { tenantId: 'tenant-1' })).toBe(true);
    expect(manager.isEnabled('safeFeature', { userId: 'user-1' })).toBe(false);
    expect(manager.isEnabled('leak', { tenantId: '__proto__' })).toBe(false);
    expect(manager.isEnabled('leak', { userId: 'prototype' })).toBe(false);
  });

  it('isEnabled normaliza tenantId/userId com espacos', () => {
    const manager = new FeatureFlagManager({ featureX: false });
    manager.setTenantFlags('tenant-1', { featureX: true });
    manager.setUserFlags('user-1', { featureX: false });

    expect(manager.isEnabled('featureX', { tenantId: '  tenant-1  ' })).toBe(true);
    expect(manager.isEnabled('featureX', { tenantId: 'tenant-1', userId: '  user-1 ' })).toBe(false);
  });

  it('rollout strategies normalizam ids e grupos', () => {
    const whitelist = RolloutStrategy.whitelist([' tenant-1 ', '__proto__']);
    const blacklist = RolloutStrategy.blacklist([' tenant-9 ', 'constructor']);
    const byGroup = RolloutStrategy.byGroup({
      ' premium ': { enabled: true },
      '__proto__': { enabled: true },
    });

    expect(whitelist.isEnabled('tenant-1')).toBe(true);
    expect(whitelist.isEnabled('__proto__')).toBe(false);
    expect(blacklist.isEnabled('tenant-9')).toBe(false);
    expect(blacklist.isEnabled('constructor')).toBe(true);
    expect(byGroup.isEnabled({ group: 'premium' })).toBe(true);
    expect(byGroup.isEnabled({ group: '__proto__' })).toBe(false);
  });

  it('gradual sanitiza percentuais e aceita duracao com espacos/maiusculas', () => {
    const strategy = RolloutStrategy.gradual({
      startDate: new Date('invalid-date'),
      phase1: { percentage: 'abc', duration: '1s' },
      phase2: { percentage: 150, duration: ' 1S ' },
      phase3: { percentage: -10 },
    });

    const current = strategy.getCurrentPhase();
    expect(current).toEqual({ phase: 2, percentage: 100 });

    const fallback = RolloutStrategy.gradual({
      startDate: new Date(Date.now() - 10000),
      phase1: { percentage: -50 },
    });
    expect(fallback.getCurrentPhase()).toEqual({ phase: 1, percentage: 0 });
  });

  it('normaliza nomes de flags e bloqueia chaves perigosas com espacos', () => {
    const manager = new FeatureFlagManager({
      ' feature-a ': true,
      ' __proto__ ': true,
    });

    manager.setTenantFlags('tenant-1', {
      ' feature-b ': true,
      ' __proto__ ': true,
    });

    expect(manager.isEnabled('feature-a')).toBe(true);
    expect(manager.isEnabled(' feature-a ')).toBe(true);
    expect(manager.isEnabled('__proto__')).toBe(false);
    expect(manager.isEnabled('feature-b', { tenantId: 'tenant-1' })).toBe(true);
  });
});
