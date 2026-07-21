'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  listFiles,
  readText,
  readJson,
  statusFromIssues,
  writeReport,
} = require('./common');

const AI_MEMORY_DIR = path.join(ROOT, 'AI_MEMORY');
const issues = [];

// ── Helpers ──────────────────────────────────────────────────────────
function addIssue(severity, category, message, suggestion) {
  issues.push({ severity, category, message, suggestion });
}

function globExists(pattern) {
  try {
    const files = listFiles('.', () => true);
    // pattern like "api/services/*.js"
    const parts = pattern.split('/');
    const dir = parts.slice(0, -1).join('/');
    const suffix = parts[parts.length - 1].replace('*', '');
    const prefix = parts[parts.length - 1].startsWith('*.') ? '' : parts[parts.length - 1].split('*')[0];
    const ext = parts[parts.length - 1].endsWith('.*') ? parts[parts.length - 1].replace('*', '') : parts[parts.length - 1].split('.').pop();

    return files.some(f => {
      if (!f.startsWith(dir + '/')) return false;
      const name = path.basename(f);
      if (ext && !name.endsWith('.' + ext)) return false;
      if (prefix && !name.startsWith(prefix)) return false;
      return true;
    });
  } catch (_) {
    return false;
  }
}

function findFiles(dir, ext) {
  try {
    return listFiles(dir).filter(f => f.endsWith('.' + ext));
  } catch (_) {
    return [];
  }
}

function extractReferencesFromMd(filePath) {
  try {
    const content = readText(filePath);
    const refs = [];
    // Extract backtick-quoted file paths: `api/services/foo.js`
    const backtickRe = /`([a-zA-Z0-9_/.\-]+(?:\.[a-z]{2,5}))`/g;
    let match;
    while ((match = backtickRe.exec(content)) !== null) {
      const ref = match[1];
      if (ref.includes('/') && ref.includes('.')) {
        refs.push({ ref, line: content.substring(0, match.index).split('\n').length });
      }
    }
    // Extract plain paths like "api/services/foo.js"
    const pathRe = /\b([a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_\-.]*)+\.(?:js|json|md|yml|sh|mjs|cjs|html|css))\b/g;
    while ((match = pathRe.exec(content)) !== null) {
      const ref = match[1];
      if (!refs.some(r => r.ref === ref)) {
        refs.push({ ref, line: content.substring(0, match.index).split('\n').length });
      }
    }
    return refs;
  } catch (_) {
    return [];
  }
}

// ── 1. Check architecture.md references against actual code ──────────
function checkArchitectureReferences() {
  if (!exists('AI_MEMORY/architecture.md')) {
    addIssue('critical', 'architecture', 'AI_MEMORY/architecture.md not found', 'Restore from git or regenerate');
    return;
  }

  const archRefs = extractReferencesFromMd('AI_MEMORY/architecture.md');

  // Check key directories mentioned in architecture.md
  const keyDirs = [
    { path: 'frontend/src/main.jsx', label: 'frontend/src/main.jsx (route truth)' },
    { path: 'frontend/src/navigation/menu.js', label: 'frontend/src/navigation/menu.js (menu truth)' },
    { path: 'api/server.js', label: 'api/server.js' },
    { path: 'api/app/registerRoutes.js', label: 'api/app/registerRoutes.js' },
    { path: 'api/app/routeRegistry.js', label: 'api/app/routeRegistry.js' },
    { path: 'core/rpa/', label: 'core/rpa/ (RPA core)' },
    { path: 'qa-mesh/', label: 'qa-mesh/ (QA Mesh)' },
    { path: 'qa-waves/', label: 'qa-waves/ (QA Waves)' },
    { path: 'governance/', label: 'governance/ (governance)' },
    { path: 'rag/', label: 'rag/ (RAG)' },
    { path: 'rag-service/', label: 'rag-service/ (RAG service)' },
    { path: 'pbx/', label: 'pbx/ (PBX)' },
  ];

  for (const dir of keyDirs) {
    if (!exists(dir.path)) {
      addIssue('error', 'architecture-refs', `${dir.label} referenced in architecture.md but not found on disk`, 'Create directory or update architecture.md');
    }
  }

  // Check specific files referenced
  for (const ref of archRefs) {
    if (!exists(ref.ref)) {
      addIssue('warning', 'architecture-refs', `architecture.md L${ref.line}: \`${ref.ref}\` not found on disk`, 'Update reference or restore file');
    }
  }
}

// ── 2. Check runtime-navigation.md routes against frontend router ───
function checkRuntimeNavigationRoutes() {
  if (!exists('AI_MEMORY/runtime-navigation.md')) {
    addIssue('critical', 'navigation', 'AI_MEMORY/runtime-navigation.md not found', 'Restore from git or regenerate');
    return;
  }

  if (!exists('frontend/src/main.jsx')) {
    addIssue('critical', 'navigation', 'frontend/src/main.jsx not found - cannot validate routes', 'Restore frontend source');
    return;
  }

  const navContent = readText('AI_MEMORY/runtime-navigation.md');
  const routerContent = readText('frontend/src/main.jsx');

  // Extract routes from navigation table
  const routeRe = /\|\s*`(\/[^`]+)`\s*\|/g;
  let match;
  const documentedRoutes = [];
  while ((match = routeRe.exec(navContent)) !== null) {
    documentedRoutes.push(match[1]);
  }

  // Check each documented route exists in router
  for (const route of documentedRoutes) {
    if (!routerContent.includes(route)) {
      addIssue('warning', 'navigation-stale', `Route ${route} documented in runtime-navigation.md but not found in frontend/src/main.jsx`, 'Update runtime-navigation.md or add route to router');
    }
  }

  // Check for routes in router not in navigation doc
  const routerRoutes = [];
  const routerRouteRe = /path\s*[=:]\s*["'`]([^"'`]+)["'`]/g;
  while ((match = routerRouteRe.exec(routerContent)) !== null) {
    const p = match[1];
    if (p.startsWith('/') && !p.includes('*') && !p.includes(':')) {
      routerRoutes.push(p);
    }
  }

  for (const route of routerRoutes) {
    if (!documentedRoutes.some(d => d === route || d.startsWith(route + '/') || route.startsWith(d + '/'))) {
      if (route !== '/' && route !== '/login' && route !== '/404') {
        addIssue('info', 'navigation-undocumented', `Route ${route} exists in router but not in runtime-navigation.md`, 'Document route in runtime-navigation.md');
      }
    }
  }
}

// ── 3. Check project-map.md references ──────────────────────────────
function checkProjectMapReferences() {
  if (!exists('AI_MEMORY/project-map.md')) {
    addIssue('critical', 'project-map', 'AI_MEMORY/project-map.md not found', 'Restore from git');
    return;
  }

  const mapContent = readText('AI_MEMORY/project-map.md');

  // Extract npm script references
  const npmRe = /`npm run ([a-z][a-z0-9_:.\-]+)`/g;
  let match;
  const scriptRefs = [];
  while ((match = npmRe.exec(mapContent)) !== null) {
    scriptRefs.push(match[1]);
  }

  const pkg = readJson('package.json');
  if (pkg && pkg.scripts) {
    for (const script of scriptRefs) {
      if (!pkg.scripts[script]) {
        addIssue('warning', 'project-map-scripts', `npm script "${script}" referenced in project-map.md but not in package.json`, 'Remove from project-map.md or add to package.json');
      }
    }
  }

  // Check file references
  const fileRefs = extractReferencesFromMd('AI_MEMORY/project-map.md');
  for (const ref of fileRefs) {
    if (!exists(ref.ref)) {
      addIssue('warning', 'project-map-refs', `project-map.md L${ref.line}: \`${ref.ref}\` not found on disk`, 'Update or remove reference');
    }
  }
}

// ── 4. Check AI_MEMORY files for stale references ───────────────────
function checkAllMemoryFilesForStaleRefs() {
  const memoryFiles = findFiles('AI_MEMORY', 'md')
    .filter(f => !f.includes('/evidence/') && !f.includes('/operational-checklists/'));

  for (const file of memoryFiles) {
    if (!exists(file)) continue;

    const refs = extractReferencesFromMd(file);
    let fileIssues = 0;

    for (const ref of refs) {
      // Skip external URLs
      if (ref.ref.startsWith('http://') || ref.ref.startsWith('https://')) continue;
      // Skip npm package names
      if (!ref.ref.includes('/')) continue;

      if (!exists(ref.ref)) {
        fileIssues++;
        addIssue('info', 'stale-ref', `${file} L${ref.line}: \`${ref.ref}\` not found on disk`, 'Update reference in AI_MEMORY file');
      }
    }

    if (fileIssues > 8) {
      addIssue('warning', 'stale-bulk', `${file}: ${fileIssues} stale references — may need audit`, 'Review and update file');
    }
  }
}

// ── 5. Cross-validate AI_MEMORY with actual code layers ─────────────
function checkMemoryCodeConsistency() {
  // Check that services mentioned exist
  const archContent = readText('AI_MEMORY/architecture.md');

  // Extract service-like references: "api/services/fooService"
  const serviceRe = /api\/services\/([a-zA-Z0-9]+(?:Service)?)/g;
  let match;
  const mentionedServices = new Set();
  while ((match = serviceRe.exec(archContent)) !== null) {
    mentionedServices.add(match[1]);
  }

  const actualServices = findFiles('api/services', 'js').map(f => path.basename(f, '.js'));
  for (const svc of mentionedServices) {
    const found = actualServices.some(a => a === svc || a === svc + '.impl' || svc === a.replace('.impl', ''));
    if (!found) {
      // Only flag if it looks like a real service name
      if (svc.endsWith('Service') || svc.endsWith('Manager') || svc.endsWith('Handler')) {
        addIssue('warning', 'service-mismatch', `Service "${svc}" mentioned in architecture.md but not found in api/services/`, 'Verify service name or update architecture.md');
      }
    }
  }

  // Check that model references match
  const modelRe = /api\/models\/([a-zA-Z]+)/g;
  const mentionedModels = new Set();
  while ((match = modelRe.exec(archContent)) !== null) {
    mentionedModels.add(match[1]);
  }

  const actualModels = findFiles('api/models', 'js').map(f => path.basename(f, '.js'));
  for (const model of mentionedModels) {
    if (!actualModels.includes(model)) {
      addIssue('info', 'model-mismatch', `Model "${model}" referenced but not found in api/models/`, 'Verify model name');
    }
  }

  // Check that modules mentioned exist
  const moduleRe = /api\/modules\/([a-zA-Z0-9\-]+)/g;
  const mentionedModules = new Set();
  while ((match = moduleRe.exec(archContent)) !== null) {
    mentionedModules.add(match[1]);
  }

  const actualModuleDirs = fs.readdirSync(path.join(ROOT, 'api', 'modules'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const mod of mentionedModules) {
    if (!actualModuleDirs.includes(mod) && !actualModuleDirs.some(d => d.includes(mod) || mod.includes(d))) {
      addIssue('info', 'module-mismatch', `Module "${mod}" referenced but not found in api/modules/`, 'Verify module name');
    }
  }
}

// ── 6. Check AI_MEMORY operational rules against reality ────────────
function checkOperationalRules() {
  if (!exists('AI_MEMORY/operational-rules.md')) return;

  const rules = readText('AI_MEMORY/operational-rules.md');

  // Check if validate scripts mentioned in rules exist in package.json
  const pkg = readJson('package.json');
  if (pkg && pkg.scripts) {
    const validateRe = /`npm run (validate:[a-z\-]+)`/g;
    let match;
    while ((match = validateRe.exec(rules)) !== null) {
      if (!pkg.scripts[match[1]]) {
        addIssue('error', 'rules-script-missing', `operational-rules.md references "${match[1]}" but not in package.json`, 'Add script or update rules');
      }
    }
  }

  // Check required files
  const requiredFiles = [
    { path: 'AGENTS.md', label: 'AGENTS.md (agent contract)' },
    { path: 'CLAUDE.md', label: 'CLAUDE.md (Claude instructions)' },
    { path: '.github/copilot-instructions.md', label: '.github/copilot-instructions.md' },
    { path: 'reports/governance-score.json', label: 'governance-score.json' },
  ];

  for (const file of requiredFiles) {
    if (!exists(file.path)) {
      addIssue('warning', 'required-file-missing', `${file.label} not found`, 'Create or restore file');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[ai-memory-consistency] Iniciando validacao cruzada AI_MEMORY ↔ codigo real...\n');

  checkArchitectureReferences();
  checkRuntimeNavigationRoutes();
  checkProjectMapReferences();
  checkAllMemoryFilesForStaleRefs();
  checkMemoryCodeConsistency();
  checkOperationalRules();

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  console.log(`  Criticals: ${criticals}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Warnings:  ${warnings}`);
  console.log(`  Infos:     ${infos}`);
  console.log(`  Total:     ${issues.length}\n`);

  const status = criticals > 0 ? 'FAIL' : errors > 0 ? 'WARN' : 'PASS';

  const report = {
    name: 'ai-memory-consistency-validation',
    status,
    criticals,
    errors,
    warnings,
    infos,
    totalIssues: issues.length,
    issues: issues.slice(0, 100), // limit to 100
    summary: status === 'PASS'
      ? 'All AI_MEMORY references consistent with actual code'
      : `${criticals} critical, ${errors} error, ${warnings} warning issues found`,
  };

  const outPath = writeReport('ai-memory-consistency-report.json', report);

  // Print detailed issues
  if (issues.length > 0) {
    console.log('Issues found:');
    for (const issue of issues.slice(0, 20)) {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'error' ? '🟠' : issue.severity === 'warning' ? '🟡' : '🔵';
      console.log(`  ${icon} [${issue.category}] ${issue.message}`);
      if (issue.suggestion) console.log(`     → ${issue.suggestion}`);
    }
    if (issues.length > 20) console.log(`  ... and ${issues.length - 20} more (see ${outPath})`);
  }

  console.log(`\nReport: ${outPath}`);
  return status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
