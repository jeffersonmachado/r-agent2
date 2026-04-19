const { SCREEN_CATALOG } = require('../rpa/screenCatalog');
const { parseSelectedScreenIds, getSelectedScreens } = require('../rpa/runScreenCatalogRPA');

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

  test('declara espera da API para a tela de replays RPA', () => {
    const replaysScreen = SCREEN_CATALOG.find((item) => item.id === 'rpa-replays');

    expect(replaysScreen).toBeTruthy();
    expect(replaysScreen.awaitApiPath).toBe('/tests/rpa/replay');
    expect(replaysScreen.awaitApiTimeoutMs).toBe(20000);
  });

  test('permite selecionar telas por argumentos de CLI', () => {
    expect(parseSelectedScreenIds(['node', 'tests/rpa/runScreenCatalogRPA.js', 'rpa-replays', 'dashboard'], {})).toEqual([
      'rpa-replays',
      'dashboard',
    ]);
  });

  test('permite selecionar telas por variavel de ambiente', () => {
    expect(parseSelectedScreenIds(['node', 'tests/rpa/runScreenCatalogRPA.js'], { TEST_SCREEN_IDS: 'rpa-replays, dashboard ' })).toEqual([
      'rpa-replays',
      'dashboard',
    ]);
  });

  test('filtra o catalogo quando ids sao informados', () => {
    const filtered = getSelectedScreens(SCREEN_CATALOG, ['rpa-replays', 'dashboard']);

    expect(filtered.map((item) => item.id)).toEqual(['dashboard', 'rpa-replays']);
  });
});
