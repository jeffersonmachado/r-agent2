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

  it('normaliza valores textuais e numericos de flags para booleanos esperados', () => {
    const manager = new FeatureFlagManager({
      featureStringFalse: 'false',
      featureStringTrue: ' true ',
      featureZero: 0,
      featureOne: 1,
    });

    manager.setTenantFlags('tenant-1', {
      featureTenantOff: 'off',
      featureTenantOn: 'ON',
    });

    manager.import({
      userOverrides: {
        'user-1': {
          featureUserNo: 'no',
          featureUserYes: 'yes',
        },
      },
    });

    expect(manager.isEnabled('featureStringFalse')).toBe(false);
    expect(manager.isEnabled('featureStringTrue')).toBe(true);
    expect(manager.isEnabled('featureZero')).toBe(false);
    expect(manager.isEnabled('featureOne')).toBe(true);
    expect(manager.isEnabled('featureTenantOff', { tenantId: 'tenant-1' })).toBe(false);
    expect(manager.isEnabled('featureTenantOn', { tenantId: 'tenant-1' })).toBe(true);
    expect(manager.isEnabled('featureUserNo', { userId: 'user-1' })).toBe(false);
    expect(manager.isEnabled('featureUserYes', { userId: 'user-1' })).toBe(true);
  });

  it('gradual aceita startDate em string/timestamp e duration numerica em ms', () => {
    const strategyFromStringDate = RolloutStrategy.gradual({
      startDate: String(Date.now() - 3000),
      phase1: { percentage: 10, duration: 1000 },
      phase2: { percentage: 60, duration: 1000 },
      phase3: { percentage: 90 },
    });
    expect(strategyFromStringDate.getCurrentPhase()).toEqual({ phase: 3, percentage: 90 });

    const strategyInvalidDuration = RolloutStrategy.gradual({
      startDate: Date.now() - 5000,
      phase1: { percentage: 20, duration: -100 },
    });
    expect(strategyInvalidDuration.getCurrentPhase()).toEqual({ phase: 1, percentage: 20 });
  });

  it('byGroup normaliza enabled textual e numerico', () => {
    const strategy = RolloutStrategy.byGroup({
      ops: { enabled: 'false' },
      beta: { enabled: 'YES' },
      alpha: { enabled: 0 },
      ga: { enabled: 1 },
    });

    expect(strategy.isEnabled({ group: 'ops' })).toBe(false);
    expect(strategy.isEnabled({ group: 'beta' })).toBe(true);
    expect(strategy.isEnabled({ group: 'alpha' })).toBe(false);
    expect(strategy.isEnabled({ group: 'ga' })).toBe(true);
  });

  it('normaliza strings numericas de flags e byGroup', () => {
    const manager = new FeatureFlagManager({
      featureZeroString: '0',
      featureNegativeString: '-2',
      featureFloatString: '0.5',
    });

    expect(manager.isEnabled('featureZeroString')).toBe(false);
    expect(manager.isEnabled('featureNegativeString')).toBe(true);
    expect(manager.isEnabled('featureFloatString')).toBe(true);

    const byGroup = RolloutStrategy.byGroup({
      zero: { enabled: '0' },
      negative: { enabled: '-1' },
    });

    expect(byGroup.isEnabled({ group: 'zero' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'negative' })).toBe(true);
  });

  it('gradual aceita duration numerica em string e com espaco antes da unidade', () => {
    const strategy = RolloutStrategy.gradual({
      startDate: Date.now() - 2500,
      phase1: { percentage: 10, duration: '1000' },
      phase2: { percentage: 60, duration: '1 s' },
      phase3: { percentage: 90 },
    });

    expect(strategy.getCurrentPhase()).toEqual({ phase: 3, percentage: 90 });

    const strategyNegative = RolloutStrategy.gradual({
      startDate: Date.now() - 10000,
      phase1: { percentage: 25, duration: '-100' },
    });

    expect(strategyNegative.getCurrentPhase()).toEqual({ phase: 1, percentage: 25 });
  });

  it('gradual nao trava em fase intermediaria sem duracao', () => {
    const strategy = RolloutStrategy.gradual({
      startDate: Date.now() - 2500,
      phase1: { percentage: 10, duration: '1s' },
      phase2: { percentage: 50, duration: 0 },
      phase3: { percentage: 90 },
    });

    expect(strategy.getCurrentPhase()).toEqual({ phase: 3, percentage: 90 });
  });

  it('interpreta placeholders textuais nullish como false', () => {
    const manager = new FeatureFlagManager({
      nullFlag: 'null',
      undefinedFlag: 'undefined',
      nanFlag: 'NaN',
      trueFlag: 'enabled',
    });

    expect(manager.isEnabled('nullFlag')).toBe(false);
    expect(manager.isEnabled('undefinedFlag')).toBe(false);
    expect(manager.isEnabled('nanFlag')).toBe(false);
    expect(manager.isEnabled('trueFlag')).toBe(true);

    const byGroup = RolloutStrategy.byGroup({
      nullish: { enabled: 'undefined' },
      active: { enabled: 'yes' },
    });

    expect(byGroup.isEnabled({ group: 'nullish' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'active' })).toBe(true);
  });

  it('trata strings nao reconhecidas como false para evitar habilitacao acidental', () => {
    const manager = new FeatureFlagManager({
      typoFlag: 'flase',
      randomFlag: 'maybe',
    });

    expect(manager.isEnabled('typoFlag')).toBe(false);
    expect(manager.isEnabled('randomFlag')).toBe(false);

    const byGroup = RolloutStrategy.byGroup({
      risky: { enabled: 'maybe' },
      safe: { enabled: 'true' },
    });

    expect(byGroup.isEnabled({ group: 'risky' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'safe' })).toBe(true);
  });

  it('so aceita objetos de flag com campo enabled explicito', () => {
    const manager = new FeatureFlagManager({
      objectEnabledTrue: { enabled: 'true' },
      objectEnabledFalse: { enabled: 'false' },
      objectWithoutEnabled: { value: true },
      arrayValue: [1],
    });

    expect(manager.isEnabled('objectEnabledTrue')).toBe(true);
    expect(manager.isEnabled('objectEnabledFalse')).toBe(false);
    expect(manager.isEnabled('objectWithoutEnabled')).toBe(false);
    expect(manager.isEnabled('arrayValue')).toBe(false);

    const byGroup = RolloutStrategy.byGroup({
      nested: { enabled: { enabled: 'yes' } },
      flat: { enabled: { x: 1 } },
    });

    expect(byGroup.isEnabled({ group: 'nested' })).toBe(true);
    expect(byGroup.isEnabled({ group: 'flat' })).toBe(false);
  });

  it('protege contra recursao infinita em enabled ciclico', () => {
    const cyclic = {};
    cyclic.enabled = cyclic;

    const manager = new FeatureFlagManager({
      cyclicFlag: cyclic,
      nestedFlag: { enabled: { enabled: 'true' } },
    });

    expect(() => manager.isEnabled('cyclicFlag')).not.toThrow();
    expect(manager.isEnabled('cyclicFlag')).toBe(false);
    expect(manager.isEnabled('nestedFlag')).toBe(true);

    const byGroup = RolloutStrategy.byGroup({
      cyclic: { enabled: cyclic },
      nested: { enabled: { enabled: 'yes' } },
    });

    expect(() => byGroup.isEnabled({ group: 'cyclic' })).not.toThrow();
    expect(byGroup.isEnabled({ group: 'cyclic' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'nested' })).toBe(true);
  });

  it('desabilita tipos nao suportados e getters de enabled com erro', () => {
    const throwingEnabled = {};
    Object.defineProperty(throwingEnabled, 'enabled', {
      get() {
        throw new Error('boom');
      },
    });

    const manager = new FeatureFlagManager({
      functionFlag: () => true,
      symbolFlag: Symbol('on'),
      bigintFlag: 1n,
      throwingFlag: throwingEnabled,
    });

    expect(manager.isEnabled('functionFlag')).toBe(false);
    expect(manager.isEnabled('symbolFlag')).toBe(false);
    expect(manager.isEnabled('bigintFlag')).toBe(false);
    expect(() => manager.isEnabled('throwingFlag')).not.toThrow();
    expect(manager.isEnabled('throwingFlag')).toBe(false);

    const byGroup = RolloutStrategy.byGroup({
      unstable: { enabled: throwingEnabled },
      safe: { enabled: true },
    });

    expect(() => byGroup.isEnabled({ group: 'unstable' })).not.toThrow();
    expect(byGroup.isEnabled({ group: 'unstable' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'safe' })).toBe(true);
  });

  it('byGroup nao quebra quando o proprio objeto de grupo tem getter enabled com erro', () => {
    const groupWithThrowingEnabled = {};
    Object.defineProperty(groupWithThrowingEnabled, 'enabled', {
      get() {
        throw new Error('group-boom');
      },
    });

    const byGroup = RolloutStrategy.byGroup({
      unstable: groupWithThrowingEnabled,
      safe: { enabled: 'on' },
    });

    expect(() => byGroup.isEnabled({ group: 'unstable' })).not.toThrow();
    expect(byGroup.isEnabled({ group: 'unstable' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'safe' })).toBe(true);
  });

  it('ignora propriedades com getter que lanca durante sanitizacao de mapas', () => {
    const config = {};
    Object.defineProperty(config, 'safeConfig', {
      enumerable: true,
      value: true,
    });
    Object.defineProperty(config, 'brokenConfig', {
      enumerable: true,
      get() {
        throw new Error('config-boom');
      },
    });

    const manager = new FeatureFlagManager(config);
    expect(manager.isEnabled('safeConfig')).toBe(true);
    expect(manager.isEnabled('brokenConfig')).toBe(false);

    const tenantFlags = {};
    Object.defineProperty(tenantFlags, 'tenantSafe', {
      enumerable: true,
      value: 'on',
    });
    Object.defineProperty(tenantFlags, 'tenantBroken', {
      enumerable: true,
      get() {
        throw new Error('tenant-boom');
      },
    });

    expect(() => manager.setTenantFlags('tenant-1', tenantFlags)).not.toThrow();
    expect(manager.isEnabled('tenantSafe', { tenantId: 'tenant-1' })).toBe(true);
    expect(manager.isEnabled('tenantBroken', { tenantId: 'tenant-1' })).toBe(false);

    const userOverrides = {};
    Object.defineProperty(userOverrides, 'user-1', {
      enumerable: true,
      value: { featureA: 'yes' },
    });
    Object.defineProperty(userOverrides, 'broken-user', {
      enumerable: true,
      get() {
        throw new Error('user-boom');
      },
    });

    expect(() => manager.import({ userOverrides })).not.toThrow();
    expect(manager.isEnabled('featureA', { userId: 'user-1' })).toBe(true);

    const groupMap = {};
    Object.defineProperty(groupMap, 'safe', {
      enumerable: true,
      value: { enabled: 'yes' },
    });
    Object.defineProperty(groupMap, 'broken', {
      enumerable: true,
      get() {
        throw new Error('group-map-boom');
      },
    });

    const byGroup = RolloutStrategy.byGroup(groupMap);
    expect(byGroup.isEnabled({ group: 'safe' })).toBe(true);
    expect(byGroup.isEnabled({ group: 'broken' })).toBe(false);
  });

  it('import tolera getters de topo com erro e ainda aplica partes validas', () => {
    const manager = new FeatureFlagManager({ keepMe: true });

    const exported = {};
    Object.defineProperty(exported, 'config', {
      get() {
        throw new Error('config-top-boom');
      },
    });
    Object.defineProperty(exported, 'userOverrides', {
      enumerable: true,
      value: {
        'user-1': { importedFlag: 'yes' },
      },
    });

    expect(() => manager.import(exported)).not.toThrow();
    expect(manager.isEnabled('keepMe')).toBe(true);
    expect(manager.isEnabled('importedFlag', { userId: 'user-1' })).toBe(true);
  });

  it('gradual e isEnabled toleram getters de contexto/opcoes com erro', () => {
    const options = {};
    Object.defineProperty(options, 'startDate', {
      get() {
        throw new Error('start-boom');
      },
    });
    Object.defineProperty(options, 'phase1', {
      get() {
        throw new Error('phase1-boom');
      },
    });
    Object.defineProperty(options, 'phase2', {
      enumerable: true,
      value: { percentage: 70 },
    });

    expect(() => RolloutStrategy.gradual(options).getCurrentPhase()).not.toThrow();
    expect(RolloutStrategy.gradual(options).getCurrentPhase()).toEqual({ phase: 2, percentage: 70 });

    const manager = new FeatureFlagManager({ base: true });
    const context = {};
    Object.defineProperty(context, 'tenantId', {
      get() {
        throw new Error('tenant-context-boom');
      },
    });

    expect(() => manager.isEnabled('base', context)).not.toThrow();
    expect(manager.isEnabled('base', context)).toBe(true);
  });

  it('gradual tolera coercoes hostis em percentage/duration e Date#getTime invalido', () => {
    const throwingCoercion = {
      [Symbol.toPrimitive]() {
        throw new Error('coercion-boom');
      },
    };

    const strategy = RolloutStrategy.gradual({
      startDate: Date.now() - 5000,
      phase1: { percentage: throwingCoercion, duration: throwingCoercion },
      phase2: { percentage: '70' },
    });

    expect(() => strategy.getCurrentPhase()).not.toThrow();
    expect(strategy.getCurrentPhase()).toEqual({ phase: 2, percentage: 70 });

    const brokenDate = new Date();
    Object.defineProperty(brokenDate, 'getTime', {
      value() {
        throw new Error('date-boom');
      },
    });

    const safeDateStrategy = RolloutStrategy.gradual({
      startDate: brokenDate,
      phase1: { percentage: 30 },
    });

    expect(() => safeDateStrategy.getCurrentPhase()).not.toThrow();
    expect(safeDateStrategy.getCurrentPhase()).toEqual({ phase: 1, percentage: 30 });
  });

  it('whitelist e blacklist toleram listas com getters que lancam erro', () => {
    const allowedList = [];
    Object.defineProperty(allowedList, '0', {
      enumerable: true,
      get() {
        throw new Error('allowed-boom');
      },
    });
    Object.defineProperty(allowedList, '1', {
      enumerable: true,
      value: ' tenant-1 ',
    });
    allowedList.length = 2;

    const blockedList = [];
    Object.defineProperty(blockedList, '0', {
      enumerable: true,
      value: ' tenant-2 ',
    });
    Object.defineProperty(blockedList, '1', {
      enumerable: true,
      get() {
        throw new Error('blocked-boom');
      },
    });
    blockedList.length = 2;

    const whitelist = RolloutStrategy.whitelist(allowedList);
    const blacklist = RolloutStrategy.blacklist(blockedList);

    expect(() => whitelist.isEnabled('tenant-1')).not.toThrow();
    expect(() => blacklist.isEnabled('tenant-1')).not.toThrow();
    expect(whitelist.isEnabled('tenant-1')).toBe(true);
    expect(whitelist.isEnabled('tenant-3')).toBe(false);
    expect(blacklist.isEnabled('tenant-2')).toBe(false);
    expect(blacklist.isEnabled('tenant-3')).toBe(true);
  });

  it('whitelist e blacklist aplicam limite defensivo de tamanho da lista', () => {
    const hugeAllowed = [];
    hugeAllowed.length = 10005;
    hugeAllowed[9999] = 'tenant-at-limit';
    hugeAllowed[10001] = 'tenant-beyond-limit';

    const hugeBlocked = [];
    hugeBlocked.length = 10005;
    hugeBlocked[9999] = 'blocked-at-limit';
    hugeBlocked[10001] = 'blocked-beyond-limit';

    const whitelist = RolloutStrategy.whitelist(hugeAllowed);
    const blacklist = RolloutStrategy.blacklist(hugeBlocked);

    expect(whitelist.isEnabled('tenant-at-limit')).toBe(true);
    expect(whitelist.isEnabled('tenant-beyond-limit')).toBe(false);
    expect(blacklist.isEnabled('blocked-at-limit')).toBe(false);
    expect(blacklist.isEnabled('blocked-beyond-limit')).toBe(true);
  });

  it('sanitizacao de mapas aplica limite defensivo de quantidade de chaves', () => {
    const hugeConfig = {};
    for (let i = 0; i < 10005; i += 1) {
      hugeConfig[`feature-${i}`] = i === 9999 || i === 10000;
    }

    const manager = new FeatureFlagManager(hugeConfig);
    expect(manager.isEnabled('feature-9999')).toBe(true);
    expect(manager.isEnabled('feature-10000')).toBe(false);

    const hugeGroupMap = {};
    for (let i = 0; i < 10005; i += 1) {
      hugeGroupMap[`group-${i}`] = { enabled: i === 9999 || i === 10000 };
    }

    const byGroup = RolloutStrategy.byGroup(hugeGroupMap);
    expect(byGroup.isEnabled({ group: 'group-9999' })).toBe(true);
    expect(byGroup.isEnabled({ group: 'group-10000' })).toBe(false);
  });

  it('tolera proxies hostis que lancam em hasOwnProperty/getOwnPropertyDescriptor', () => {
    const hostileProxy = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error('hasown-boom');
      },
      get() {
        throw new Error('get-boom');
      },
    });

    const manager = new FeatureFlagManager({
      proxyFlag: hostileProxy,
    });

    expect(() => manager.isEnabled('proxyFlag')).not.toThrow();
    expect(manager.isEnabled('proxyFlag')).toBe(false);

    const byGroup = RolloutStrategy.byGroup({
      unstable: hostileProxy,
      stable: { enabled: true },
    });

    expect(() => byGroup.isEnabled({ group: 'unstable' })).not.toThrow();
    expect(byGroup.isEnabled({ group: 'unstable' })).toBe(false);
    expect(byGroup.isEnabled({ group: 'stable' })).toBe(true);
  });

  it('getFeatureStatus e export toleram mapas hostis e preservam dados validos', () => {
    const manager = new FeatureFlagManager({ base: true });
    manager.setTenantFlags('tenant-safe', { tenantOnly: 'yes' });

    const hostileScopeMap = new Proxy({}, {
      ownKeys() {
        throw new Error('scope-keys-boom');
      },
      getOwnPropertyDescriptor() {
        throw new Error('scope-desc-boom');
      },
      get() {
        throw new Error('scope-get-boom');
      },
    });

    manager._userOverrides = hostileScopeMap;

    expect(() => manager.getFeatureStatus({ tenantId: 'tenant-safe' })).not.toThrow();
    const status = manager.getFeatureStatus({ tenantId: 'tenant-safe' });
    expect(status.base).toBe(true);
    expect(status.tenantOnly).toBe(true);

    expect(() => manager.export()).not.toThrow();
    const exported = manager.export();
    expect(exported.config.base).toBe(true);
    expect(exported.tenantOverrides['tenant-safe'].tenantOnly).toBe(true);
    expect(exported.userOverrides).toEqual({});
  });

  it('isEnabled tolera mapas de override hostis e aplica fallback seguro', () => {
    const manager = new FeatureFlagManager({ baseFlag: true, tenantFlag: false });
    manager.setTenantFlags('tenant-safe', { tenantFlag: true });

    manager._userOverrides = new Proxy({}, {
      get() {
        throw new Error('user-map-get-boom');
      },
      getOwnPropertyDescriptor() {
        throw new Error('user-map-desc-boom');
      },
    });

    manager._tenantOverrides = new Proxy({
      'tenant-safe': new Proxy({ tenantFlag: true }, {
        get(target, key) {
          if (key === 'tenantFlag') throw new Error('tenant-flag-get-boom');
          return target[key];
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === 'tenantFlag') throw new Error('tenant-flag-desc-boom');
          return Object.getOwnPropertyDescriptor(target, key);
        },
      }),
    }, {
      get(target, key) {
        if (key === 'tenant-safe') return target[key];
        throw new Error('tenant-map-get-boom');
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'tenant-safe') {
          return Object.getOwnPropertyDescriptor(target, key);
        }
        throw new Error('tenant-map-desc-boom');
      },
    });

    expect(() => manager.isEnabled('baseFlag', { userId: 'user-1' })).not.toThrow();
    expect(manager.isEnabled('baseFlag', { userId: 'user-1' })).toBe(true);
    expect(() => manager.isEnabled('tenantFlag', { tenantId: 'tenant-safe' })).not.toThrow();
    expect(manager.isEnabled('tenantFlag', { tenantId: 'tenant-safe' })).toBe(false);
  });

  it('tolera proxy revogado em caminhos que usam isRecord', () => {
    const revokedValue = Proxy.revocable({}, {});
    revokedValue.revoke();

    const manager = new FeatureFlagManager({ revokedFlag: revokedValue.proxy });
    expect(() => manager.isEnabled('revokedFlag')).not.toThrow();
    expect(manager.isEnabled('revokedFlag')).toBe(false);

    const revokedByGroupValue = Proxy.revocable({}, {});
    revokedByGroupValue.revoke();
    const byGroup = RolloutStrategy.byGroup({ unstable: revokedByGroupValue.proxy });
    expect(() => byGroup.isEnabled({ group: 'unstable' })).not.toThrow();
    expect(byGroup.isEnabled({ group: 'unstable' })).toBe(false);

    const revokedConfig = Proxy.revocable({}, {});
    revokedConfig.revoke();
    expect(() => new FeatureFlagManager(revokedConfig.proxy)).not.toThrow();
  });
});
