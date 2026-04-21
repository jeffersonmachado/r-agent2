const path = require('path');

describe('pbxLegacy inventory', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PBX_LEGACY_ROOT;
    delete process.env.PBX_LEGACY_XML_DIR;
    jest.doMock('../../api/utils/config', () => ({
      get: (_key, fallback = '') => fallback,
    }));
  });

  test('quando PBX_LEGACY_ROOT não está configurado, configured=false', async () => {
    // eslint-disable-next-line global-require
    const { getLegacyInventory } = require('../../api/services/pbxLegacy/inventory');
    const inv = await getLegacyInventory();
    expect(inv.configured).toBe(false);
    expect(inv.root).toBe(null);
  });

  test('retorna catalog com sample quando root aponta para fixture', async () => {
    const root = path.join(__dirname, '..', 'fixtures', 'ripabx-min');
    process.env.PBX_LEGACY_ROOT = root;
    // eslint-disable-next-line global-require
    const { getLegacyInventory } = require('../../api/services/pbxLegacy/inventory');
    const inv = await getLegacyInventory();
    expect(inv.configured).toBe(true);
    expect(inv.root).toBe(root);
    expect(inv.catalog.cSources.count).toBeGreaterThanOrEqual(1);
  });
});

