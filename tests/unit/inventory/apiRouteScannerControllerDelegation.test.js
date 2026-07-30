const path = require('path');

// eslint-disable-next-line global-require
const { scanApiRoutes } = require('../../../api/services/qa/inventory/apiRouteScanner');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

/**
 * O módulo `config` (api/modules/config/routes.js) delega os handlers ao
 * controller (`controllerFor(req, res).metodo(req, res)`), e a proteção
 * (ensureAuth/ensurePermission) vive no controller — arquivo diferente do
 * router. O scanner precisa resolver essa delegação para reportar
 * authRequired corretamente; a referência de verdade são os probes ao vivo
 * da API Surface Wave (anônimo → 401 nas rotas protegidas, 200 na visão
 * pública intencional de GET /config).
 */
describe('apiRouteScanner — auth em controllers delegados (módulo config)', () => {
  const itemsById = new Map();

  beforeAll(() => {
    const result = scanApiRoutes({ rootDir: ROOT_DIR });
    for (const item of result.items) {
      if (item.source === 'api/modules/config/routes.js') {
        itemsById.set(item.id, item);
      }
    }
  });

  test('POST /server/restart é detectado como protegido (ensureAuth + config:update no controller)', () => {
    const item = itemsById.get('api:POST:/server/restart');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
    expect(item.authorization).toContain('ensureAuth');
    expect(item.authorization.some((a) => a.startsWith('ensurePermission:config:update'))).toBe(true);
  });

  test('GET /server/process-manager é detectado como protegido', () => {
    const item = itemsById.get('api:GET:/server/process-manager');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('GET /tenants/current/ai-config é detectado como protegido', () => {
    const item = itemsById.get('api:GET:/tenants/current/ai-config');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('PUT /config é detectado como protegido', () => {
    const item = itemsById.get('api:PUT:/config');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(true);
  });

  test('GET /config permanece público (visão sanitizada pré-login intencional, override declarado)', () => {
    const item = itemsById.get('api:GET:/config');
    expect(item).toBeDefined();
    // Probe ao vivo: anônimo recebe 200 com visão pública sanitizada. O
    // controller tenta requireAuth mas serve 200 sem auth por design — o
    // override declarado impede falso positivo de "protegido".
    expect(item.authRequired).toBe(false);
  });

  test('GET /contracts/rag/question-generation.rules.json permanece público (sem auth no controller)', () => {
    const item = itemsById.get('api:GET:/contracts/rag/question-generation.rules.json');
    expect(item).toBeDefined();
    expect(item.authRequired).toBe(false);
  });
});
