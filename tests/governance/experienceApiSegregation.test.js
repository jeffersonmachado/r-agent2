'use strict';

/**
 * Testes do gate de segregação server-side de experiência
 * (validate-experience-api-segregation.js).
 *
 * O caso PASS usa o estado real do repositório; os casos FAIL usam
 * diretórios-fixture temporários com root injetável.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkExperienceApiSegregation } = require('../../scripts/governance/validate-experience-api-segregation');

function writeText(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

// Fixture mínima íntegra: todas as estruturas que o gate inspeciona.
// A fonte canônica das classificações é o módulo PURO
// workspace.route-classifications.js (zero requires); workspace.routes.js é
// lido como texto e deve referenciá-lo sem redefinir a lista inline.
function buildFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-api-seg-'));

  const classificationsModule = [
    "'use strict';",
    '',
    `const WORKSPACE_ROUTE_CLASSIFICATIONS = ${JSON.stringify(overrides.classifications ?? { 'GET /workspace/entities/:id/autocorrections': 'DEVELOPMENT' }, null, 2)};`,
    '',
    'module.exports = { WORKSPACE_ROUTE_CLASSIFICATIONS };',
    '',
  ].join('\n');
  writeText(root, 'api/modules/workspace/workspace.route-classifications.js', classificationsModule);

  // O gate NUNCA faz require deste arquivo — a referência a 'express' prova
  // que o carregamento offline depende apenas do módulo puro.
  const routesModule = overrides.routesSource ?? [
    "'use strict';",
    "const express = require('express'); // ausente no root fixture — nunca resolvido",
    "const { WORKSPACE_ROUTE_CLASSIFICATIONS } = require('./workspace.route-classifications');",
    'module.exports = { WORKSPACE_ROUTE_CLASSIFICATIONS };',
    '',
  ].join('\n');
  writeText(root, 'api/modules/workspace/workspace.routes.js', routesModule);

  const controllerTokens = [
    ...(overrides.controllerResolver === false ? [] : ['getClassificationForAgent']),
    ...(overrides.controllerForbidden === false ? [] : ['classification_forbidden']),
  ];
  writeText(root, 'api/modules/workspace/workspace.controller.js', `'use strict';\n// ${controllerTokens.join(' ')}\n`);

  writeText(root, 'api/modules/qa-waves/routes.js', `'use strict';\n// ${overrides.qaWavesGuard ?? "checkClassification(req, 'DEVELOPMENT')"}\n`);
  writeText(root, 'api/modules/qa-mesh/routes.js', `'use strict';\n// ${overrides.qaMeshGuard ?? "checkClassification(req, 'DEVELOPMENT')"}\n`);

  writeText(root, 'api/modules/rpa-tests/rpaRouteUtils.js', [
    "'use strict';",
    "const { checkClassification } = require('../../middleware/requireClassification');",
    overrides.rpaDevGuard === false ? '' : "const ensureRpaDevelopmentAccess = (req) => checkClassification(req, 'DEVELOPMENT');",
    overrides.rpaSupportGuard === false ? '' : "const ensureSupportAccess = (req) => checkClassification(req, 'SUPPORT');",
    'module.exports = { ensureRpaDevelopmentAccess, ensureSupportAccess };',
    '',
  ].join('\n'));
  writeText(root, 'api/modules/rpa-tests/handleRpaRecordingsRoutes.js', "'use strict';\nconst { ensureSupportAccess, ensureRpaDevelopmentAccess } = require('./rpaRouteUtils');\n");
  writeText(root, 'api/modules/rpa-tests/handleRpaExecutionRoutes.js', "'use strict';\nconst { ensureSupportAccess, ensureRpaDevelopmentAccess } = require('./rpaRouteUtils');\n");
  writeText(root, 'api/middleware/requireClassification.js', "'use strict';\nfunction checkClassification() {}\nfunction requireClassification() {}\nmodule.exports = { checkClassification, requireClassification };\n");

  return root;
}

describe('experience-api-segregation gate', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
  });
  const fixture = (overrides) => {
    const root = buildFixture(overrides);
    roots.push(root);
    return root;
  };

  it('PASS no estado real do repositório', () => {
    const result = checkExperienceApiSegregation(path.resolve(__dirname, '..', '..'));
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('PASS');
    expect(result.counts).toEqual({ productionTechnicalLeaks: 0, supportEngineeringLeaks: 0, directUrlBypasses: 0 });
  });

  it('PASS em fixture íntegra', () => {
    const result = checkExperienceApiSegregation(fixture());
    expect(result.status).toBe('PASS');
    expect(result.counts).toEqual({ productionTechnicalLeaks: 0, supportEngineeringLeaks: 0, directUrlBypasses: 0 });
  });

  it('módulo puro real não contém nenhum require (carregável offline)', () => {
    const pure = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'api', 'modules', 'workspace', 'workspace.route-classifications.js'),
      'utf8',
    );
    expect(pure).not.toMatch(/require\s*\(/);
  });

  it('PASS offline: workspace.routes.js com dependências ausentes nunca é carregado (só lido como texto)', () => {
    const root = fixture({
      routesSource: [
        "'use strict';",
        "require('express'); require('sequelize'); require('./workspace.service'); // módulos inexistentes no fixture",
        "const { WORKSPACE_ROUTE_CLASSIFICATIONS } = require('./workspace.route-classifications');",
        'module.exports = { WORKSPACE_ROUTE_CLASSIFICATIONS };',
        '',
      ].join('\n'),
    });
    const result = checkExperienceApiSegregation(root);
    expect(result.status).toBe('PASS');
  });

  it('FAIL quando workspace.routes.js não consome o módulo canônico (drift)', () => {
    const result = checkExperienceApiSegregation(fixture({
      routesSource: "'use strict';\nmodule.exports = {};\n",
    }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.check === 'workspace_route_classifications_source')).toBe(true);
    expect(result.counts.productionTechnicalLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando workspace.routes.js redefine a lista inline (fonte duplicada)', () => {
    const result = checkExperienceApiSegregation(fixture({
      routesSource: [
        "'use strict';",
        "require('./workspace.route-classifications');",
        "const WORKSPACE_ROUTE_CLASSIFICATIONS = { 'GET /workspace/entities/:id/autocorrections': 'PRODUCTION' };",
        'module.exports = { WORKSPACE_ROUTE_CLASSIFICATIONS };',
        '',
      ].join('\n'),
    }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.check === 'workspace_route_classifications_source')).toBe(true);
  });

  it('FAIL quando o módulo puro canônico está ausente', () => {
    const root = fixture();
    fs.rmSync(path.join(root, 'api', 'modules', 'workspace', 'workspace.route-classifications.js'));
    const result = checkExperienceApiSegregation(root);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.check === 'workspace_route_classifications')).toBe(true);
    expect(result.counts.productionTechnicalLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando rota DEVELOPMENT não tem enforcement no controller (sem classification_forbidden)', () => {
    const result = checkExperienceApiSegregation(fixture({ controllerForbidden: false }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.productionTechnicalLeaks).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.check === 'workspace_route_enforcement')).toBe(true);
  });

  it('FAIL quando controller não resolve classificação (sem getClassificationForAgent)', () => {
    const result = checkExperienceApiSegregation(fixture({ controllerResolver: false }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.productionTechnicalLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando WORKSPACE_ROUTE_CLASSIFICATIONS está ausente do módulo puro (metadata missing)', () => {
    const root = fixture();
    writeText(root, 'api/modules/workspace/workspace.route-classifications.js', "'use strict';\nmodule.exports = {};\n");
    const result = checkExperienceApiSegregation(root);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.check === 'workspace_route_classifications')).toBe(true);
  });

  it('FAIL em classificação inválida no mapa', () => {
    const result = checkExperienceApiSegregation(fixture({ classifications: { 'GET /workspace/x': 'ROOT' } }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.productionTechnicalLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando qa-waves perde o guard DEVELOPMENT (drift)', () => {
    const result = checkExperienceApiSegregation(fixture({ qaWavesGuard: 'sem guard' }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.supportEngineeringLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando qa-mesh perde o guard DEVELOPMENT (drift)', () => {
    const result = checkExperienceApiSegregation(fixture({ qaMeshGuard: 'sem guard' }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.supportEngineeringLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando RPA técnico perde ensureRpaDevelopmentAccess (drift)', () => {
    const result = checkExperienceApiSegregation(fixture({ rpaDevGuard: false }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.supportEngineeringLeaks).toBeGreaterThan(0);
  });

  it('FAIL quando replay/leitura RPA perde o guard SUPPORT (directUrlBypass)', () => {
    const result = checkExperienceApiSegregation(fixture({ rpaSupportGuard: false }));
    expect(result.status).toBe('FAIL');
    expect(result.counts.directUrlBypasses).toBeGreaterThan(0);
  });
});
