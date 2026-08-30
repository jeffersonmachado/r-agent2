#!/usr/bin/env node
'use strict';

/**
 * validate-experience-segregation.js
 *
 * Validador estático (bloqueante) contra VAZAMENTO DE CONTEÚDO técnico interno
 * (QA Waves, QA Mesh, RPA, Replay, Seeds, Evidence, Regression, Coverage,
 * autocorreção, go/no-go) dentro de superfícies frontend PRODUCTION.
 *
 * Complementa validate-visibility-policy.js: aquele valida ROTAS/MENU/APIs;
 * este valida o CONTEÚDO RENDERIZÁVEL dentro de páginas e componentes que
 * pertencem à experiência do cliente (PRODUCTION).
 *
 * Superfícies PRODUCTION varridas:
 *   - frontend/src/pages/** EXCETO páginas internas listadas em
 *     DEV_ONLY_PAGES (páginas só alcançáveis via /dev, /qa, /qa-mesh, /rpa*,
 *     /generate-system, /admin/agents — já gated por prefixo/role);
 *   - frontend/src/modules/workspace/** EXCETO módulos dev-only
 *     (WorkspaceQaRpaPanel.jsx, workspaceDevSurface.js);
 *   - frontend/src/modules/support-workspace/**;
 *   - frontend/src/components/academy/**.
 *
 * Exceções justificadas e auditáveis ficam em
 * config/experience-segregation-exemptions.json (ex.: conteúdo técnico que só
 * é renderizado quando getAgentClassification(agent) !== 'PRODUCTION').
 *
 * Saída: reports/experience-segregation-report.json + resumo no stdout.
 * Exit 1 em qualquer violação.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'experience-segregation-report.json');
const EXEMPTIONS_PATH = path.join(ROOT_DIR, 'config', 'experience-segregation-exemptions.json');

// Páginas internas (SUPPORT/DEVELOPMENT) — fora do escopo PRODUCTION.
// Qualquer nova página /dev|/qa|/rpa|/generate-system deve ser incluída aqui.
const DEV_ONLY_PAGES = new Set([
  'frontend/src/pages/RpaReplaysPage.jsx',
  'frontend/src/pages/RpaSeedsPage.jsx',
  'frontend/src/pages/RpaTestPage.jsx',
  'frontend/src/pages/QaPage.jsx',
  'frontend/src/pages/QaMeshPage.jsx',
  'frontend/src/pages/QaGapsPage.jsx',
  'frontend/src/pages/QaAuditPage.jsx',
  'frontend/src/pages/QaWavesPage.jsx',
  'frontend/src/pages/QaWavesEnterpriseGovernancePage.jsx',
  'frontend/src/pages/QaWavesOperationalHealthPage.jsx',
  'frontend/src/pages/AgentOsHubPage.jsx',
  'frontend/src/pages/GenerateSystemPage.jsx',
  'frontend/src/pages/StackVersionsPage.jsx',
]);
const DEV_ONLY_DIRS = [
  'frontend/src/pages/qa/',
  'frontend/src/pages/dev/',
  'frontend/src/pages/generate-system/',
  'frontend/src/modules/qa',
  'frontend/src/modules/rpa',
];

// Módulos workspace dev-only (conteúdo técnico gated por classificação).
const DEV_ONLY_WORKSPACE_MODULES = new Set([
  'frontend/src/modules/workspace/WorkspaceQaRpaPanel.jsx',
  'frontend/src/modules/workspace/workspaceDevSurface.js',
]);

// Regras de conteúdo proibido em superfícies PRODUCTION.
const FORBIDDEN_RULES = [
  { id: 'qa_wave', pattern: /QA\s*Waves?/i },
  { id: 'qa_slash_rpa', pattern: /QA\s*\/\s*RPA/i },
  { id: 'qa_mesh', pattern: /QA\s*Mesh/i },
  { id: 'rpa_term', pattern: /\bRPA\b/ },
  { id: 'replay', pattern: /\bReplay(s)?\b/i },
  { id: 'evidence', pattern: /\bEvidence\b/ },
  { id: 'seed', pattern: /\bSeeds?\b/ },
  { id: 'synthetic', pattern: /Synthetic\s(Data)?/i },
  { id: 'regression', pattern: /Regression\s(Engine)?/i },
  { id: 'coverage', pattern: /\bCoverage\b/ },
  { id: 'go_no_go', pattern: /go.?no.?go/i },
  { id: 'autocorrection', pattern: /auto.?correction/i },
  { id: 'journey_status_card', pattern: /JourneyStatusCard/ },
  { id: 'replay_details_modal', pattern: /ReplayDetailsModal/ },
  { id: 'action_chain', pattern: /action\schain/i },
];

function isDevOnly(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (DEV_ONLY_PAGES.has(normalized)) return true;
  if (DEV_ONLY_WORKSPACE_MODULES.has(normalized)) return true;
  return DEV_ONLY_DIRS.some((dir) => normalized.startsWith(dir));
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(abs, files);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\.(jsx?|tsx?)$/.test(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

function collectProductionSurfaces() {
  const surfaces = [];
  const scanRoots = [
    path.join(ROOT_DIR, 'frontend', 'src', 'pages'),
    path.join(ROOT_DIR, 'frontend', 'src', 'modules', 'workspace'),
    path.join(ROOT_DIR, 'frontend', 'src', 'modules', 'support-workspace'),
    path.join(ROOT_DIR, 'frontend', 'src', 'components', 'academy'),
  ];
  for (const root of scanRoots) {
    for (const abs of walk(root, [])) {
      const rel = path.relative(ROOT_DIR, abs).split(path.sep).join('/');
      if (!isDevOnly(rel)) surfaces.push(rel);
    }
  }
  // Componentes PRODUCTION fora dos diretórios acima.
  for (const extra of [
    'frontend/src/components/FlowGeneratorDialog.jsx',
    'frontend/src/components/PlanSelectionModal.jsx',
  ]) {
    if (fs.existsSync(path.join(ROOT_DIR, extra))) surfaces.push(extra);
  }
  return surfaces.sort();
}

function loadExemptions() {
  if (!fs.existsSync(EXEMPTIONS_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, 'utf8'));
  const exemptions = Array.isArray(parsed) ? parsed : parsed.exemptions || [];
  return exemptions.filter((e) => e && e.path && e.rule && typeof e.reason === 'string' && e.reason.length > 0);
}

function scanFile(relPath, rules) {
  const abs = path.join(ROOT_DIR, relPath);
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split('\n');
  const hits = [];
  for (const rule of rules) {
    lines.forEach((line, idx) => {
      if (rule.pattern.test(line)) {
        hits.push({ rule: rule.id, line: idx + 1, excerpt: line.trim().slice(0, 160) });
      }
    });
  }
  return hits;
}

function collectViolations() {
  const exemptions = loadExemptions();
  const violations = [];
  const surfaces = collectProductionSurfaces();

  for (const rel of surfaces) {
    const hits = scanFile(rel, FORBIDDEN_RULES);
    for (const hit of hits) {
      const exempted = exemptions.some((e) => e.path === rel && e.rule === hit.rule);
      if (!exempted) {
        violations.push({ type: 'production_surface_technical_content', path: rel, ...hit });
      }
    }
  }
  return { violations, surfaces, exemptions };
}

function run() {
  const { violations, surfaces, exemptions } = collectViolations();
  const generatedAt = new Date().toISOString();
  const report = {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    generatedAt,
    checkedAt: generatedAt,
    policy: {
      scannedSurfaces: surfaces.length,
      forbiddenRules: FORBIDDEN_RULES.map((r) => r.id),
      exemptionsApplied: exemptions.length,
      exemptionsPath: path.relative(ROOT_DIR, EXEMPTIONS_PATH),
    },
    violationCount: violations.length,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[experience-segregation] status=${report.status} surfaces=${surfaces.length} violations=${violations.length}`);
  for (const violation of violations) {
    console.log(`[experience-segregation] VIOLATION ${violation.path}:${violation.line} [${violation.rule}] ${violation.excerpt}`);
  }
  console.log(`[experience-segregation] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  return violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(run());
  } catch (error) {
    console.error('[experience-segregation] erro ao executar validador:', error);
    process.exit(1);
  }
}

module.exports = {
  collectViolations,
  collectProductionSurfaces,
  scanFile,
  isDevOnly,
  FORBIDDEN_RULES,
  DEV_ONLY_PAGES,
  run,
};
