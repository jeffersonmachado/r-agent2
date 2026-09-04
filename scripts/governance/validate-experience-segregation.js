#!/usr/bin/env node
'use strict';

/**
 * validate-experience-segregation.js
 *
 * Validador estático (bloqueante) de segregação de experiência:
 *
 * A. CONTEÚDO PROIBIDO em superfícies PRODUCTION — vazamento de literais
 *    técnicos internos (QA Waves, QA Mesh, RPA, Replay, Seeds, Evidence,
 *    Regression, Coverage, autocorreção, go/no-go) dentro de páginas e
 *    componentes que pertencem à experiência do cliente (PRODUCTION).
 *
 * B. CONTRATO /support (Central de Atendimento legada ticket-based) — a
 *    superfície PRODUCTION de atendimento baseada em ticket só pode ser
 *    navegável com gate de capability `caseManagement`:
 *      B1. o item de menu `/support` (id 'support') declara
 *          `capability: 'caseManagement'`;
 *      B2. `canAccessPath` (menuPermissions.js) aplica o gate de capability
 *          em TODOS os itens que mapeiam a rota (nó-pai sem capability não
 *          pode contornar o gate do item real);
 *      B3. `SupportPage.impl.jsx` tem guard in-page fail-closed de
 *          `capabilities.caseManagement` antes de renderizar o conteúdo;
 *      B4. a nota de deprecation (@deprecated) existe em SupportPage.impl.jsx
 *          (compatibilidade explícita para tenants no modo simples).
 *
 * C. SUPERFÍCIES SUPPORT não renderizam conteúdo DEVELOPMENT:
 *      C1. `workspaceDevSurface.js` — `isDevSurfaceVisible` é DEVELOPMENT-only
 *          (SUPPORT e PRODUCTION nunca veem a tab/painel de engenharia);
 *      C2. componentes/páginas classificados SUPPORT (PlatformSupportPage,
 *          SupportEvidenceCard e demais componentes de
 *          frontend/src/components/support/) não importam nem renderizam
 *          módulos de engenharia (qa-waves, qa-mesh, RPA lab, AutoCorrection,
 *          patch/diff, regression, coverage técnico, dev surface). Um novo
 *          componente DEVELOPMENT importado em superfície SUPPORT é pego
 *          pelo mesmo mecanismo (análise de imports + JSX).
 *
 * Complementa validate-visibility-policy.js: aquele valida ROTAS/MENU/APIs;
 * este valida o CONTEÚDO RENDERIZÁVEL e os CONTRATOS DE GATE das superfícies.
 *
 * Superfícies PRODUCTION varridas (check A):
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
 * Saída: reports/experience-segregation-report.json (compat: consumido pelo
 * verify-delivered-release e pelo release-evidence-pack) + cópia canônica em
 * governance/experience-segregation-report.json (entra no PAYLOAD do release:
 * evidence-manifest packageRequired=true → o verifier offline exige a prova de
 * segregação criptograficamente ligada ao pacote via payloadSha256).
 * Exit 1 em qualquer violação.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'experience-segregation-report.json');
// Cópia canônica empacotada no payload (governance/ é fonte e entra no ZIP;
// reports/ da raiz é excluído pelo blocklist de release).
const PAYLOAD_REPORT_PATH = path.join(ROOT_DIR, 'governance', 'experience-segregation-report.json');
const EXEMPTIONS_PATH = path.join(ROOT_DIR, 'config', 'experience-segregation-exemptions.json');

const MENU_PATH = 'frontend/src/navigation/menu.js';
const MENU_PERMISSIONS_PATH = 'frontend/src/utils/menuPermissions.js';
const SUPPORT_PAGE_PATH = 'frontend/src/pages/SupportPage.impl.jsx';
const DEV_SURFACE_PATH = 'frontend/src/modules/workspace/workspaceDevSurface.js';
const PLATFORM_SUPPORT_PAGE_PATH = 'frontend/src/pages/PlatformSupportPage.jsx';
const SUPPORT_COMPONENTS_DIR = path.join(ROOT_DIR, 'frontend', 'src', 'components', 'support');

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

// Módulos de engenharia (DEVELOPMENT) proibidos em superfícies SUPPORT:
// imports cujo especificador aponta para esses módulos são violação.
const ENGINEERING_IMPORT_RULES = [
  { id: 'eng_qa_waves', pattern: /qa-waves/i },
  { id: 'eng_qa_mesh', pattern: /qa-mesh/i },
  { id: 'eng_qa_module', pattern: /modules\/qa(\/|$)/ },
  { id: 'eng_rpa_module', pattern: /modules\/rpa(\/|$)/ },
  { id: 'eng_rpa_lab', pattern: /rpa[-/](lab|test|seed|replay)/i },
  { id: 'eng_dev_surface', pattern: /workspaceDevSurface|WorkspaceQaRpaPanel/ },
  { id: 'eng_journey_status_card', pattern: /JourneyStatusCard/ },
  { id: 'eng_replay_details_modal', pattern: /ReplayDetailsModal/ },
  { id: 'eng_autocorrection', pattern: /auto-?correction/i },
  { id: 'eng_patch_diff', pattern: /patch[-/](diff|service)|diffPatch/i },
  { id: 'eng_regression', pattern: /regression/i },
  { id: 'eng_coverage', pattern: /coverage/i },
];

// Componentes DEVELOPMENT proibidos em JSX de superfícies SUPPORT, mesmo que
// o import venha indireto (defesa em profundidade sobre o check de imports).
const ENGINEERING_JSX_RULES = [
  { id: 'eng_jsx_qa_rpa_panel', pattern: /<\s*WorkspaceQaRpaPanel\b/ },
  { id: 'eng_jsx_journey_status_card', pattern: /<\s*JourneyStatusCard\b/ },
  { id: 'eng_jsx_replay_details_modal', pattern: /<\s*ReplayDetailsModal\b/ },
  { id: 'eng_jsx_autocorrection', pattern: /<\s*AutoCorrection\w*\b/ },
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

/**
 * Superfícies SUPPORT (classificação SUPPORT no menu): hub interno de suporte
 * da plataforma e os componentes de diagnóstico consumidos por ela. Essas
 * superfícies NUNCA importam/renderizam módulos de engenharia (DEVELOPMENT).
 */
function collectSupportSurfaces() {
  const surfaces = [];
  if (fs.existsSync(path.join(ROOT_DIR, PLATFORM_SUPPORT_PAGE_PATH))) {
    surfaces.push(PLATFORM_SUPPORT_PAGE_PATH);
  }
  for (const abs of walk(SUPPORT_COMPONENTS_DIR, [])) {
    surfaces.push(path.relative(ROOT_DIR, abs).split(path.sep).join('/'));
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
  return scanContentLines(content, rules);
}

function scanContentLines(content, rules) {
  const lines = String(content).split('\n');
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

// ─── Análise estrutural (não-grep) dos contratos de gate ─────────────────────

/**
 * Extrai o literal de objeto `{ ... }` que envolve a posição `index` do
 * conteúdo, por contagem de chaves balanceadas. Retorna null se não houver
 * fechamento balanceado.
 */
function extractEnclosingBlock(content, index, openChar = '{', closeChar = '}') {
  let start = -1;
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const ch = content[i];
    if (ch === closeChar) depth += 1;
    else if (ch === openChar) {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extrai o corpo (bloco `{ ... }`) de uma declaração de função no conteúdo.
 * Aceita prefixos como `export function canAccessPath(` ou `function f(`.
 */
function extractFunctionBody(content, functionName) {
  const decl = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).exec(content);
  if (!decl) return null;
  // Encontrar o fechamento da lista de parâmetros (pode conter defaults com
  // chaves/parênteses, ex.: `options = {}`) antes de abrir o corpo.
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = decl.index + decl[0].length - 1; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = i; break; }
    }
  }
  if (paramsEnd < 0) return null;
  const openIdx = content.indexOf('{', paramsEnd);
  if (openIdx < 0) return null;
  let depth = 0;
  for (let i = openIdx; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Encontra todos os itens de menu cujo literal de objeto contém
 * `path: '<targetPath>'` e retorna os blocos de objeto completos.
 */
function findMenuPathEntries(menuContent, targetPath) {
  const entries = [];
  const needle = new RegExp(`path:\\s*['"]${targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
  let match;
  while ((match = needle.exec(menuContent)) !== null) {
    const block = extractEnclosingBlock(menuContent, match.index);
    if (block) entries.push(block);
  }
  return entries;
}

/**
 * Check B — contrato /support: superfície PRODUCTION de atendimento
 * ticket-based só é navegável com gate de capability caseManagement.
 * Analisa o CONTEÚDO dos três arquivos do contrato (menu, permissões e
 * página), sem executá-los.
 */
function analyzeSupportCapabilityContract({ menuContent, menuPermissionsContent, supportPageContent }) {
  const violations = [];

  // B1. O item de menu da Central de Atendimento (id 'support', path '/support')
  // declara capability 'caseManagement'.
  const entries = findMenuPathEntries(menuContent, '/support');
  const supportItem = entries.find((block) => /\bid:\s*['"]support['"]/.test(block));
  if (!supportItem) {
    violations.push({
      type: 'support_capability_contract',
      path: MENU_PATH,
      rule: 'support_menu_item_missing',
      line: 0,
      excerpt: "Nenhum item de menu com id 'support' e path '/support' encontrado.",
    });
  } else if (!/\bcapability:\s*['"]caseManagement['"]/.test(supportItem)) {
    violations.push({
      type: 'support_capability_contract',
      path: MENU_PATH,
      rule: 'support_menu_capability_missing',
      line: 0,
      excerpt: "Item de menu '/support' (Central de Atendimento) sem capability: 'caseManagement'.",
    });
  }

  // B2. canAccessPath aplica o gate de capability em TODOS os itens que
  // mapeiam a rota (iteração sobre matchingItems testando .capability).
  const canAccessPathBody = extractFunctionBody(menuPermissionsContent, 'canAccessPath');
  if (!canAccessPathBody) {
    violations.push({
      type: 'support_capability_contract',
      path: MENU_PERMISSIONS_PATH,
      rule: 'support_path_gate_function_missing',
      line: 0,
      excerpt: 'Função canAccessPath não encontrada em menuPermissions.js.',
    });
  } else {
    const iteratesMatching = /for\s*\([^)]*\bof\s+matchingItems\s*\)|\bmatchingItems\s*\.\s*(some|every|forEach|filter)\s*\(/.test(canAccessPathBody);
    const checksCapability = /\.\s*capability\b/.test(canAccessPathBody);
    if (!iteratesMatching || !checksCapability) {
      violations.push({
        type: 'support_capability_contract',
        path: MENU_PERMISSIONS_PATH,
        rule: 'support_path_capability_gate_missing',
        line: 0,
        excerpt: 'canAccessPath não aplica o gate de capability em todos os itens que mapeiam a rota.',
      });
    }
  }

  // B3. SupportPage.impl.jsx tem guard in-page fail-closed de caseManagement
  // ANTES de renderizar o conteúdo interno da página.
  const supportPageBody = extractFunctionBody(supportPageContent, 'SupportPage');
  if (!supportPageBody) {
    violations.push({
      type: 'support_capability_contract',
      path: SUPPORT_PAGE_PATH,
      rule: 'support_page_component_missing',
      line: 0,
      excerpt: 'Componente SupportPage não encontrado em SupportPage.impl.jsx.',
    });
  } else {
    const referencesCapability = /\bcapabilities\b/.test(supportPageBody) && /\bcaseManagement\b/.test(supportPageBody);
    const guardMatch = /if\s*\(\s*!\s*(caseManagementEnabled|capabilities\?\.\s*caseManagement)[^)]*\)/.exec(supportPageBody);
    const renderIdx = supportPageBody.indexOf('SupportPageInner');
    if (!referencesCapability || !guardMatch || (renderIdx >= 0 && guardMatch.index > renderIdx)) {
      violations.push({
        type: 'support_capability_contract',
        path: SUPPORT_PAGE_PATH,
        rule: 'support_page_capability_guard_missing',
        line: 0,
        excerpt: 'SupportPage não possui guard fail-closed de capabilities.caseManagement antes de renderizar o conteúdo.',
      });
    }
  }

  // B4. Nota de deprecation explícita (@deprecated) — regra de compatibilidade
  // documentada para tenants no modo de atendimento simples.
  const firstImportIdx = supportPageContent.search(/^import\s/m);
  const header = firstImportIdx >= 0 ? supportPageContent.slice(0, firstImportIdx) : supportPageContent.slice(0, 2000);
  if (!/@deprecated\b/.test(header)) {
    violations.push({
      type: 'support_capability_contract',
      path: SUPPORT_PAGE_PATH,
      rule: 'support_page_deprecation_missing',
      line: 0,
      excerpt: 'Nota @deprecated ausente no cabeçalho de SupportPage.impl.jsx.',
    });
  }

  return violations;
}

/**
 * Check C1 — a superfície de engenharia do workspace é DEVELOPMENT-only:
 * isDevSurfaceVisible só retorna true para DEVELOPMENT.
 */
function analyzeDevSurfaceGate(devSurfaceContent) {
  const violations = [];
  const body = extractFunctionBody(devSurfaceContent, 'isDevSurfaceVisible');
  if (!body) {
    violations.push({
      type: 'dev_surface_gate',
      path: DEV_SURFACE_PATH,
      rule: 'dev_surface_gate_function_missing',
      line: 0,
      excerpt: 'Função isDevSurfaceVisible não encontrada em workspaceDevSurface.js.',
    });
    return violations;
  }
  const developmentOnly = /===\s*['"]DEVELOPMENT['"]/.test(body);
  const grantsOthers = /['"](SUPPORT|PRODUCTION)['"]/.test(body);
  if (!developmentOnly || grantsOthers) {
    violations.push({
      type: 'dev_surface_gate',
      path: DEV_SURFACE_PATH,
      rule: 'dev_surface_visible_to_non_development',
      line: 0,
      excerpt: 'isDevSurfaceVisible não é DEVELOPMENT-only (SUPPORT/PRODUCTION alcançariam a superfície de engenharia).',
    });
  }
  return violations;
}

/**
 * Check C2 — superfícies SUPPORT não importam nem renderizam módulos de
 * engenharia. Analisa imports (especificador resolvido como string) e JSX.
 */
function scanSupportSurfaceContent(content) {
  const lines = String(content).split('\n');
  const hits = [];
  const importRe = /(?:\bimport\b[\s\S]*?\bfrom\b|\brequire\s*\()\s*['"]([^'"]+)['"]/;

  lines.forEach((line, idx) => {
    const importMatch = importRe.exec(line);
    if (importMatch) {
      const specifier = importMatch[1];
      for (const rule of ENGINEERING_IMPORT_RULES) {
        if (rule.pattern.test(specifier)) {
          hits.push({ rule: rule.id, line: idx + 1, excerpt: line.trim().slice(0, 160) });
        }
      }
    }
    for (const rule of ENGINEERING_JSX_RULES) {
      if (rule.pattern.test(line)) {
        hits.push({ rule: rule.id, line: idx + 1, excerpt: line.trim().slice(0, 160) });
      }
    }
  });
  return hits;
}

function collectViolations() {
  const exemptions = loadExemptions();
  const violations = [];
  const surfaces = collectProductionSurfaces();
  const supportSurfaces = collectSupportSurfaces();
  const isExempted = (rel, rule) => exemptions.some((e) => e.path === rel && e.rule === rule);

  // A. Conteúdo técnico proibido em superfícies PRODUCTION.
  for (const rel of surfaces) {
    const hits = scanFile(rel, FORBIDDEN_RULES);
    for (const hit of hits) {
      if (!isExempted(rel, hit.rule)) {
        violations.push({ type: 'production_surface_technical_content', path: rel, ...hit });
      }
    }
  }

  // B. Contrato /support — capability caseManagement end-to-end.
  const contractInputs = {
    menuContent: fs.readFileSync(path.join(ROOT_DIR, MENU_PATH), 'utf8'),
    menuPermissionsContent: fs.readFileSync(path.join(ROOT_DIR, MENU_PERMISSIONS_PATH), 'utf8'),
    supportPageContent: fs.readFileSync(path.join(ROOT_DIR, SUPPORT_PAGE_PATH), 'utf8'),
  };
  for (const violation of analyzeSupportCapabilityContract(contractInputs)) {
    if (!isExempted(violation.path, violation.rule)) violations.push(violation);
  }

  // C1. Dev surface do workspace DEVELOPMENT-only.
  const devSurfaceContent = fs.readFileSync(path.join(ROOT_DIR, DEV_SURFACE_PATH), 'utf8');
  for (const violation of analyzeDevSurfaceGate(devSurfaceContent)) {
    if (!isExempted(violation.path, violation.rule)) violations.push(violation);
  }

  // C2. Superfícies SUPPORT sem imports/JSX de engenharia.
  for (const rel of supportSurfaces) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    const hits = scanSupportSurfaceContent(content);
    for (const hit of hits) {
      if (!isExempted(rel, hit.rule)) {
        violations.push({ type: 'support_surface_engineering_content', path: rel, ...hit });
      }
    }
  }

  return { violations, surfaces, supportSurfaces, exemptions };
}

function run() {
  const { violations, surfaces, supportSurfaces, exemptions } = collectViolations();
  const generatedAt = new Date().toISOString();
  const report = {
    artifactType: 'experience-segregation-report',
    artifactVersion: '1.0.0',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    generatedAt,
    checkedAt: generatedAt,
    policy: {
      scannedSurfaces: surfaces.length,
      scannedSupportSurfaces: supportSurfaces.length,
      forbiddenRules: FORBIDDEN_RULES.map((r) => r.id),
      supportCapabilityContract: ['support_menu_item', 'support_path_capability_gate', 'support_page_capability_guard', 'support_page_deprecation'],
      devSurfaceGate: ['dev_surface_development_only'],
      engineeringImportRules: ENGINEERING_IMPORT_RULES.map((r) => r.id),
      engineeringJsxRules: ENGINEERING_JSX_RULES.map((r) => r.id),
      exemptionsApplied: exemptions.length,
      exemptionsPath: path.relative(ROOT_DIR, EXEMPTIONS_PATH),
    },
    violationCount: violations.length,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  // Cópia canônica para o payload: governance/ entra no ZIP do release e o
  // evidence-manifest marca esta prova como packageRequired=true. O
  // stamp-report-lineage regrava runId/sourceFingerprint em AMBAS as cópias.
  fs.writeFileSync(PAYLOAD_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[experience-segregation] status=${report.status} surfaces=${surfaces.length} supportSurfaces=${supportSurfaces.length} violations=${violations.length}`);
  for (const violation of violations) {
    console.log(`[experience-segregation] VIOLATION ${violation.path}:${violation.line} [${violation.rule}] ${violation.excerpt}`);
  }
  console.log(`[experience-segregation] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  console.log(`[experience-segregation] cópia payload: ${path.relative(ROOT_DIR, PAYLOAD_REPORT_PATH)}`);

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
  collectSupportSurfaces,
  scanFile,
  scanContentLines,
  scanSupportSurfaceContent,
  analyzeSupportCapabilityContract,
  analyzeDevSurfaceGate,
  findMenuPathEntries,
  extractEnclosingBlock,
  extractFunctionBody,
  isDevOnly,
  FORBIDDEN_RULES,
  ENGINEERING_IMPORT_RULES,
  ENGINEERING_JSX_RULES,
  DEV_ONLY_PAGES,
  run,
};
