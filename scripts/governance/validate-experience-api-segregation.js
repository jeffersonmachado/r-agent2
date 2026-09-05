#!/usr/bin/env node
'use strict';

/**
 * validate-experience-api-segregation.js
 *
 * Gate bloqueante de segregação SERVER-SIDE de experiência (complementa
 * validate-experience-segregation, que cobre o frontend):
 *
 * A. WORKSPACE ROUTE CLASSIFICATIONS — api/modules/workspace/workspace.routes.js
 *    exporta WORKSPACE_ROUTE_CLASSIFICATIONS (mapa 'METHOD /path' → classificação).
 *    Toda rota classificada DEVELOPMENT precisa de evidência de enforcement em
 *    workspace.controller.js (estático: o fonte do controller contém
 *    `getClassificationForAgent` E `classification_forbidden` — 403 fail-closed).
 *    Metadata ausente ou enforcement ausente → FAIL (productionTechnicalLeaks).
 *
 * B. GUARDS DOS GRUPOS DE ENGENHARIA (drift → FAIL):
 *    - qa-waves / qa-mesh: checkClassification(req, 'DEVELOPMENT') ou
 *      requireClassification('DEVELOPMENT') — vazamento para SUPPORT conta em
 *      supportEngineeringLeaks;
 *    - RPA técnico (gravação/execução): ensureRpaDevelopmentAccess com
 *      checkClassification(req, 'DEVELOPMENT') em rpaRouteUtils.js e uso nos
 *      handlers — supportEngineeringLeaks;
 *    - RPA replay/leitura: ensureSupportAccess com checkClassification(req, 'SUPPORT')
 *      em rpaRouteUtils.js e uso nos handlers — acesso direto por URL sem o
 *      guard conta em directUrlBypasses.
 *
 * Relatório: reports/experience-api-segregation-report.json
 * PASS exige productionTechnicalLeaks=0, supportEngineeringLeaks=0,
 * directUrlBypasses=0.
 *
 * Uso: node scripts/governance/validate-experience-api-segregation.js
 * Exit 0 = PASS; Exit 1 = FAIL.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

const WORKSPACE_ROUTES_PATH = 'api/modules/workspace/workspace.routes.js';
const WORKSPACE_CONTROLLER_PATH = 'api/modules/workspace/workspace.controller.js';
const VALID_CLASSIFICATIONS = new Set(['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']);

// Grupos de engenharia: arquivo → guard exigido (checkClassification direto ou
// middleware requireClassification) e o contador de vazamento correspondente.
const ENGINEERING_GROUPS = [
  { file: 'api/modules/qa-waves/routes.js', level: 'DEVELOPMENT', leak: 'supportEngineeringLeaks', label: 'qa-waves' },
  { file: 'api/modules/qa-mesh/routes.js', level: 'DEVELOPMENT', leak: 'supportEngineeringLeaks', label: 'qa-mesh' },
];

const RPA_UTILS_PATH = 'api/modules/rpa-tests/rpaRouteUtils.js';
const RPA_HANDLERS = [
  'api/modules/rpa-tests/handleRpaRecordingsRoutes.js',
  'api/modules/rpa-tests/handleRpaExecutionRoutes.js',
];
const REQUIRE_CLASSIFICATION_MW = 'api/middleware/requireClassification.js';

function readText(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { error: `missing:${rel}` };
  return { content: fs.readFileSync(full, 'utf8') };
}

function hasClassificationGuard(source, level) {
  return source.includes(`checkClassification(req, '${level}')`)
    || source.includes(`requireClassification('${level}')`)
    || source.includes(`requireClassification("${level}")`);
}

function checkExperienceApiSegregation(rootDir) {
  const root = rootDir || ROOT_DIR;
  const issues = [];
  const counts = {
    productionTechnicalLeaks: 0,
    supportEngineeringLeaks: 0,
    directUrlBypasses: 0,
  };
  const checks = [];

  // ── A. Workspace route classifications + enforcement no controller ────────
  const routesFull = path.join(root, WORKSPACE_ROUTES_PATH);
  let classifications = null;
  if (!fs.existsSync(routesFull)) {
    issues.push({ check: 'workspace_route_classifications', issue: `missing:${WORKSPACE_ROUTES_PATH}` });
    counts.productionTechnicalLeaks += 1;
  } else {
    try {
      delete require.cache[require.resolve(routesFull)];
      classifications = require(routesFull).WORKSPACE_ROUTE_CLASSIFICATIONS || null;
    } catch (err) {
      issues.push({ check: 'workspace_route_classifications', issue: `workspace_routes_unloadable:${err.message}` });
      counts.productionTechnicalLeaks += 1;
    }
  }

  const controller = readText(root, WORKSPACE_CONTROLLER_PATH);
  const controllerHasResolver = !controller.error && controller.content.includes('getClassificationForAgent');
  const controllerHasForbidden = !controller.error && controller.content.includes('classification_forbidden');

  if (classifications === null && !issues.some((i) => i.check === 'workspace_route_classifications')) {
    issues.push({
      check: 'workspace_route_classifications',
      issue: 'WORKSPACE_ROUTE_CLASSIFICATIONS ausente em workspace.routes.js — rotas workspace sem metadata de classificação',
    });
    counts.productionTechnicalLeaks += 1;
  }

  const developmentRoutes = [];
  if (classifications && typeof classifications === 'object') {
    for (const [route, classification] of Object.entries(classifications)) {
      if (!VALID_CLASSIFICATIONS.has(classification)) {
        issues.push({
          check: 'workspace_route_classifications',
          issue: `classificação inválida: ${route} → ${classification}`,
        });
        counts.productionTechnicalLeaks += 1;
        continue;
      }
      if (classification === 'DEVELOPMENT') developmentRoutes.push(route);
    }
    for (const route of developmentRoutes) {
      if (!controllerHasResolver || !controllerHasForbidden) {
        issues.push({
          check: 'workspace_route_enforcement',
          issue: `rota DEVELOPMENT sem enforcement no controller: ${route} (getClassificationForAgent=${controllerHasResolver} classification_forbidden=${controllerHasForbidden})`,
        });
        counts.productionTechnicalLeaks += 1;
      }
    }
  }
  checks.push({
    id: 'workspace_route_classifications',
    routesClassified: classifications ? Object.keys(classifications).length : 0,
    developmentRoutes,
    controllerEnforcementEvidence: controllerHasResolver && controllerHasForbidden,
  });

  // ── B. Guards dos grupos de engenharia (qa-waves / qa-mesh) ───────────────
  for (const group of ENGINEERING_GROUPS) {
    const res = readText(root, group.file);
    const guarded = !res.error && hasClassificationGuard(res.content, group.level);
    if (!guarded) {
      issues.push({
        check: 'engineering_route_guard',
        issue: `${group.label}: ${res.error || `sem guard ${group.level} em ${group.file}`}`,
      });
      counts[group.leak] += 1;
    }
    checks.push({ id: `engineering_guard:${group.label}`, file: group.file, level: group.level, guarded });
  }

  // ── C. Guards RPA (técnico DEVELOPMENT, replay/leitura SUPPORT) ───────────
  const rpaUtils = readText(root, RPA_UTILS_PATH);
  const rpaDevGuard = !rpaUtils.error
    && rpaUtils.content.includes('ensureRpaDevelopmentAccess')
    && hasClassificationGuard(rpaUtils.content, 'DEVELOPMENT');
  if (!rpaDevGuard) {
    issues.push({
      check: 'rpa_development_guard',
      issue: rpaUtils.error || 'ensureRpaDevelopmentAccess/checkClassification DEVELOPMENT ausente em rpaRouteUtils.js',
    });
    counts.supportEngineeringLeaks += 1;
  }
  const rpaSupportGuard = !rpaUtils.error
    && rpaUtils.content.includes('ensureSupportAccess')
    && hasClassificationGuard(rpaUtils.content, 'SUPPORT');
  if (!rpaSupportGuard) {
    issues.push({
      check: 'rpa_support_guard',
      issue: rpaUtils.error || 'ensureSupportAccess/checkClassification SUPPORT ausente em rpaRouteUtils.js (replay/leitura acessível por URL direta)',
    });
    counts.directUrlBypasses += 1;
  }
  for (const handler of RPA_HANDLERS) {
    const res = readText(root, handler);
    const usesDev = !res.error && res.content.includes('ensureRpaDevelopmentAccess');
    const usesSupport = !res.error && res.content.includes('ensureSupportAccess');
    if (!usesDev) {
      issues.push({ check: 'rpa_development_guard', issue: `${handler} não usa ensureRpaDevelopmentAccess` });
      counts.supportEngineeringLeaks += 1;
    }
    if (!usesSupport) {
      issues.push({ check: 'rpa_support_guard', issue: `${handler} não usa ensureSupportAccess nas leituras` });
      counts.directUrlBypasses += 1;
    }
    checks.push({ id: `rpa_handler:${path.basename(handler)}`, usesDev, usesSupport });
  }

  const mw = readText(root, REQUIRE_CLASSIFICATION_MW);
  const mwOk = !mw.error && mw.content.includes('checkClassification') && mw.content.includes('requireClassification');
  if (!mwOk) {
    issues.push({
      check: 'classification_middleware',
      issue: mw.error || 'requireClassification.js sem checkClassification/requireClassification',
    });
    counts.supportEngineeringLeaks += 1;
  }

  const leaked = counts.productionTechnicalLeaks + counts.supportEngineeringLeaks + counts.directUrlBypasses;
  return {
    status: issues.length === 0 && leaked === 0 ? 'PASS' : 'FAIL',
    code: issues.length === 0 && leaked === 0 ? 'EXPERIENCE_API_SEGREGATION_OK' : 'EXPERIENCE_API_SEGREGATION_VIOLATION',
    counts,
    checks,
    issues,
  };
}

function main() {
  const result = checkExperienceApiSegregation();
  const report = {
    artifactType: 'experience-api-segregation-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    ...result,
  };
  const reportPath = path.join(ROOT_DIR, 'reports', 'experience-api-segregation-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[experience-api-segregation] status=${result.status} leaks=${JSON.stringify(result.counts)}`);
  for (const issue of result.issues) {
    console.log(`[experience-api-segregation] ISSUE [${issue.check}] ${issue.issue}`);
  }
  console.log('[experience-api-segregation] relatório: reports/experience-api-segregation-report.json');
  process.exit(result.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { checkExperienceApiSegregation };
