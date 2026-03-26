const { SCREEN_CATALOG } = require('../rpa/screenCatalog');

describe('RPA screen catalog', () => {
  test('não possui ids duplicados', () => {
    const ids = SCREEN_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('não possui path+auth duplicados', () => {
    const keys = SCREEN_CATALOG.map((item) => `${item.auth}:${item.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('cobre telas públicas, admin e super-admin', () => {
    const authProfiles = new Set(SCREEN_CATALOG.map((item) => item.auth));
    expect(authProfiles.has('public')).toBe(true);
    expect(authProfiles.has('admin')).toBe(true);
    expect(authProfiles.has('super_admin')).toBe(true);
  });
});
