#!/usr/bin/env node
'use strict';

/**
 * validate-visibility-policy.js
 *
 * Validador estático (bloqueante) da política de segregação de experiência
 * PRODUCTION / SUPPORT / DEVELOPMENT:
 *
 * 1. Todo item de `frontend/src/navigation/menu.js` cujo path comece com
 *    /dev, /qa, /qa-mesh ou /rpa deve ter roles ⊆ ['super_admin'] (item e
 *    seções ancestrais que definam roles).
 * 2. Nenhum path de PRODUCTION_HIDDEN_ROUTES (fonte única:
 *    api/modules/agent-os/experience-segregation.js) pode aparecer em seção
 *    de menu visível a roles operacionais.
 * 3. As superfícies de API de engenharia (qa-waves, qa-mesh, rpa-tests) devem
 *    referenciar requireClassification (proteção de API presente).
 *
 * Saída: reports/visibility-policy-report.json + resumo no stdout.
 * Exit 1 em qualquer violação.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MENU_PATH = path.join(ROOT_DIR, 'frontend', 'src', 'navigation', 'menu.js');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'visibility-policy-report.json');

const {
  PRODUCTION_HIDDEN_ROUTES,
} = require('../../api/modules/agent-os/experience-segregation');

const PROTECTED_PREFIXES = ['/dev', '/qa', '/qa-mesh', '/rpa'];
const SUPER_ADMIN_ONLY = ['super_admin'];

const API_SURFACES = [
  { label: 'api/modules/qa-waves/routes.js', files: ['api/modules/qa-waves/routes.js'] },
  { label: 'api/modules/qa-mesh/routes.js', files: ['api/modules/qa-mesh/routes.js'] },
  { label: 'api/modules/qa/routes.js', files: ['api/modules/qa/routes.js'] },
  { label: 'api/routes/operationalStatusRoutes.js', files: ['api/routes/operationalStatusRoutes.js'] },
  { label: 'api/modules/ops/routes.js', files: ['api/modules/ops/routes.js'] },
  { label: 'api/modules/test-executions/routes.js', files: ['api/modules/test-executions/routes.js'] },
  {
    label: 'api/modules/rpa-tests',
    files: [
      'api/modules/rpa-tests/rpaRouteUtils.js',
      'api/modules/rpa-tests/handleRpaRecordingsRoutes.js',
      'api/modules/rpa-tests/handleRpaExecutionRoutes.js',
      'api/modules/rpa-tests/handleRpaTestsRoutes.js',
      'api/modules/rpa-tests/routes.js',
    ],
  },
];

function matchesPrefix(routePath, prefix) {
  return routePath === prefix || routePath.startsWith(`${prefix}/`);
}

function isProtectedPath(routePath) {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(routePath, prefix));
}

function isProductionHidden(routePath) {
  return PRODUCTION_HIDDEN_ROUTES.some((hidden) => matchesPrefix(routePath, hidden));
}

function isSuperAdminOnly(roles) {
  return (
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.every((role) => SUPER_ADMIN_ONLY.includes(role))
  );
}

function collectMenuViolations(navigationMenu) {
  const violations = [];

  function walk(nodes, ancestors) {
    for (const node of nodes || []) {
      const chain = [...ancestors, node];
      const routePath = typeof node.path === 'string' ? node.path : null;

      if (routePath && (isProtectedPath(routePath) || isProductionHidden(routePath))) {
        const policy = isProtectedPath(routePath) ? 'protected_prefix' : 'production_hidden_route';

        if (!isSuperAdminOnly(node.roles)) {
          violations.push({
            type: `menu_item_exposed_${policy}`,
            id: node.id || null,
            path: routePath,
            roles: node.roles || null,
            expected: SUPER_ADMIN_ONLY,
          });
        }

        for (const ancestor of ancestors) {
          if (ancestor.roles && !isSuperAdminOnly(ancestor.roles)) {
            violations.push({
              type: `menu_section_exposed_${policy}`,
              id: node.id || null,
              path: routePath,
              section: ancestor.id || ancestor.label || null,
              sectionRoles: ancestor.roles,
              expected: SUPER_ADMIN_ONLY,
            });
          }
        }
      }

      if (Array.isArray(node.children)) {
        walk(node.children, chain);
      }
    }
  }

  walk(navigationMenu, []);
  return violations;
}

function collectApiViolations() {
  const violations = [];

  for (const surface of API_SURFACES) {
    const sources = surface.files
      .map((rel) => path.join(ROOT_DIR, rel))
      .filter((abs) => fs.existsSync(abs))
      .map((abs) => fs.readFileSync(abs, 'utf8'))
      .join('\n');

    if (!sources.includes('requireClassification')) {
      violations.push({
        type: 'api_surface_missing_requireClassification',
        surface: surface.label,
      });
    }
  }

  return violations;
}

async function main() {
  const menuModule = await import(pathToFileURL(MENU_PATH).href);
  const { navigationMenu } = menuModule;

  const violations = [
    ...collectMenuViolations(navigationMenu),
    ...collectApiViolations(),
  ];

  const generatedAt = new Date().toISOString();
  const report = {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    generatedAt,
    checkedAt: generatedAt,
    policy: {
      protectedPrefixes: PROTECTED_PREFIXES,
      productionHiddenRoutes: PRODUCTION_HIDDEN_ROUTES,
      expectedRoles: SUPER_ADMIN_ONLY,
      apiSurfaces: API_SURFACES.map((surface) => surface.label),
    },
    violationCount: violations.length,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[visibility-policy] status=${report.status} violations=${violations.length}`);
  for (const violation of violations) {
    console.log(`[visibility-policy] VIOLATION ${violation.type}: ${JSON.stringify(violation)}`);
  }
  console.log(`[visibility-policy] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  process.exit(violations.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[visibility-policy] erro ao executar validador:', error);
  process.exit(1);
});
