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
});
