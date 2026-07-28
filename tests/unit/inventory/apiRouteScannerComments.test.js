'use strict';

/**
 * Regressão do scanner de rotas (inventário): artefatos de comentário e
 * classificação por token de módulo.
 *
 * Falhas observadas (API Surface Wave, 2026-07-28):
 * 1. `api:GET:/rota` (módulo qa) aparecia no inventário — o scanner seguia o
 *    require de '../middleware/requireClassification' e parseava o EXEMPLO EM
 *    DOCSTRING (`router.get('/rota', requireClassification('DEVELOPMENT'), …)`)
 *    como rota real. Comentários nunca podem gerar itens de inventário.
 * 2. O módulo support-debug era classificado SUPPORT pelo token 'support',
 *    mas serve rotas operacionais (/api/schedules consumido por
 *    frontend/src/api/scheduling.js; sugestões de IA da inbox). O override
 *    MODULE_CLASSIFICATION_OVERRIDES corrige para PRODUCTION.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanApiRoutes, classifyModule } = require('../../../api/services/qa/inventory/apiRouteScanner');

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-comments-'));
  fs.mkdirSync(path.join(rootDir, 'api', 'app'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'api', 'modules', 'qa'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'api', 'middleware'), { recursive: true });

  fs.writeFileSync(path.join(rootDir, 'api', 'app', 'routeRegistry.js'), `'use strict';
function createRouteRegistry(routers) {
  return [
    { router: routers.qaRouter },
  ];
}
module.exports = { createRouteRegistry };
`);
  fs.writeFileSync(path.join(rootDir, 'api', 'app', 'registerRoutes.js'), `'use strict';
const { createQaRoutes } = require('../modules/qa/routes');
function registerRoutes() {
  const qaRouter = createQaRoutes({});
  return { qaRouter };
}
module.exports = { registerRoutes };
`);
  // Router real: uma rota de verdade + require do middleware com docstring armadilha.
  fs.writeFileSync(path.join(rootDir, 'api', 'modules', 'qa', 'routes.js'), `'use strict';
const express = require('express');
const { requireClassification } = require('../../middleware/requireClassification');
function createQaRoutes() {
  const router = express.Router();
  router.get('/api/qa/real', requireClassification('DEVELOPMENT'), (req, res) => res.end());
  return router;
}
module.exports = { createQaRoutes };
`);
  // Middleware cuja DOCUMENTAÇÃO contém um exemplo de registro de rota.
  fs.writeFileSync(path.join(rootDir, 'api', 'middleware', 'requireClassification.js'), `'use strict';
/**
 * Uso (Express):
 *   router.get('/rota', requireClassification('DEVELOPMENT'), handler);
 *   router.post('/rota-post', requireClassification('SUPPORT'), handler);
 */
// Também em comentário de linha: router.put('/rota-put', handler);
function requireClassification() {}
module.exports = { requireClassification };
`);

  return rootDir;
}

describe('apiRouteScanner — comentários nunca geram rotas', () => {
  test('exemplos em docstring/comentário não entram no inventário', () => {
    const rootDir = createFixtureRoot();
    const { items } = scanApiRoutes({ rootDir });
    const ids = items.map((i) => i.id);
    expect(ids).toContain('api:GET:/api/qa/real');
    expect(ids).not.toContain('api:GET:/rota');
    expect(ids).not.toContain('api:POST:/rota-post');
    expect(ids).not.toContain('api:PUT:/rota-put');
  });

  test('strings com // (URLs) não são confundidas com comentário', () => {
    const rootDir = createFixtureRoot();
    fs.writeFileSync(path.join(rootDir, 'api', 'modules', 'qa', 'routes.js'), `'use strict';
const express = require('express');
function createQaRoutes() {
  const router = express.Router();
  const base = 'http://localhost' + '/x'; // URL com // dentro de string
  router.get('/api/qa/url', (req, res) => res.end(base));
  return router;
}
module.exports = { createQaRoutes };
`);
    const { items } = scanApiRoutes({ rootDir });
    expect(items.map((i) => i.id)).toContain('api:GET:/api/qa/url');
  });
});

describe('apiRouteScanner — override de classificação por módulo', () => {
  test('support-debug é PRODUCTION (rotas operacionais, nome histórico)', () => {
    expect(classifyModule('support-debug')).toBe('PRODUCTION');
  });

  test('demais módulos seguem a heurística por tokens', () => {
    expect(classifyModule('execution-ledger')).toBe('SUPPORT');
    expect(classifyModule('qa-waves')).toBe('DEVELOPMENT');
    expect(classifyModule('domain-flow')).toBe('PRODUCTION');
  });
});
