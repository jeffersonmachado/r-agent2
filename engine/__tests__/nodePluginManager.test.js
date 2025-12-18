const {
  registerPluginForTenant,
  getRegistryForTenant,
  clearAllTenantRegistries,
  _internal,
} = require('../nodePluginManager');

describe('nodePluginManager', () => {
  beforeEach(() => {
    clearAllTenantRegistries();
  });

  const dummyHandler = jest.fn();

  const plugin = {
    id: 'plugin-basic',
    allowedTenants: ['tenant-1'],
    nodes: [
      { type: 'custom_message', handler: dummyHandler },
    ],
  };

  test('isPluginAllowedForTenant respeita allowedTenants', () => {
    const { isPluginAllowedForTenant } = _internal;
    expect(isPluginAllowedForTenant(plugin, 'tenant-1')).toBe(true);
    expect(isPluginAllowedForTenant(plugin, 'tenant-2')).toBe(false);

    const wildcardPlugin = { ...plugin, allowedTenants: ['*'] };
    expect(isPluginAllowedForTenant(wildcardPlugin, 'qualquer')).toBe(true);
  });

  test('registerPluginForTenant cria e popula registry por tenant', () => {
    const registry = registerPluginForTenant('tenant-1', plugin);

    const sameRegistry = getRegistryForTenant('tenant-1');
    expect(sameRegistry).toBe(registry);

    // O tipo de nó registrado deve estar disponível no registry
    const handler = registry.get('custom_message');
    expect(typeof handler).toBe('function');
  });

  test('registerPluginForTenant falha se plugin não for autorizado para o tenant', () => {
    expect(() => registerPluginForTenant('tenant-2', plugin)).toThrow();
  });
});


