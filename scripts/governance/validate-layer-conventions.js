'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  listFiles,
  readText,
  statusFromIssues,
  writeReport,
} = require('./common');

const issues = [];

// ── Helpers ──────────────────────────────────────────────────────────
function addIssue(severity, layer, file, line, message, suggestion) {
  issues.push({ severity, layer, file, line, message, suggestion });
}

function scanFiles(dir, ext, checkFn) {
  if (!exists(dir)) return;

  const files = listFiles(dir).filter(f => f.endsWith('.' + ext));
  for (const file of files) {
    try {
      const content = readText(file);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        checkFn(file, i + 1, lines[i], content);
      }
    } catch (_) {}
  }
}

function dirExists(dir) {
  return exists(dir);
}

// ── 1. Backend (api/) must be CommonJS ──────────────────────────────
function checkBackendCjs() {
  if (!dirExists('api/')) return;

  scanFiles('api', 'js', (file, line, text) => {
    // Skip test files
    if (file.includes('__tests__') || file.includes('.test.')) return;
    // Skip specific known ESM files
    if (file.includes('api/bootstrap/')) return;

    // Check for ESM import (not in comments)
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (trimmed.startsWith('/*')) return;

    // import ... from (ESM style) — only flag actual imports, not strings
    if (/^import\s+/.test(trimmed) && !trimmed.includes("'") === false) {
      if (trimmed.startsWith('import ') || trimmed.startsWith('import{') || trimmed.startsWith('import {')) {
        addIssue('error', 'api', file, line, `ESM import in backend: "${trimmed.substring(0, 80)}"`, 'Use const x = require(...) em api/');
      }
    }

    // export default / export const (ESM style)
    if (/^export\s+(default|const|function|class|{)/.test(trimmed)) {
      addIssue('error', 'api', file, line, `ESM export in backend: "${trimmed.substring(0, 80)}"`, 'Use module.exports = ... em api/');
    }
  });
}

// ── 2. Frontend (frontend/src/) must be ES modules ──────────────────
function checkFrontendEsm() {
  if (!dirExists('frontend/src/')) return;

  // Files with legitimate CJS patterns (browser compatibility wrappers, etc.)
  const cjsAllowed = [
    'frontend/src/utils/textToSpeech.js',
  ];

  scanFiles('frontend/src', 'js', (file, line, text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (trimmed.startsWith('/*')) return;

    // Skip allowed CJS files
    if (cjsAllowed.includes(file)) return;

    // require() in frontend
    if (/\brequire\s*\(/.test(trimmed) && !trimmed.includes('require.resolve')) {
      addIssue('error', 'frontend', file, line, `CommonJS require() in frontend: "${trimmed.substring(0, 80)}"`, 'Use import ... from ... em frontend/src/');
    }

    // module.exports in frontend
    if (/\bmodule\.exports\b/.test(trimmed)) {
      addIssue('error', 'frontend', file, line, `module.exports in frontend: "${trimmed.substring(0, 80)}"`, 'Use export default/export const em frontend/src/');
    }
  });

  // Also check .jsx files
  scanFiles('frontend/src', 'jsx', (file, line, text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    if (/\brequire\s*\(/.test(trimmed) && !trimmed.includes('require.resolve')) {
      addIssue('error', 'frontend', file, line, `CommonJS require() in frontend JSX: "${trimmed.substring(0, 80)}"`, 'Use import ... from ...');
    }
  });
}

// ── 3. Engine (engine/) must be pure functions, no I/O ──────────────
function checkEnginePurity() {
  if (!dirExists('engine/')) return;

  // Known bridge/config files in engine that are allowed I/O
  const ioAllowedFiles = [
    'engine/ai/aiEnvelope.js',
    'engine/ai/aiEnvelopeSchema.js',
  ];

  const ioPatterns = [
    { pattern: /\brequire\s*\(\s*['"](?:fs|http|https|net|dgram|child_process|process|os)['"]/, name: 'require(fs/http/process)' },
    { pattern: /\bfs\./, name: 'fs.*' },
    { pattern: /\bprocess\.(?!env\.NODE_ENV)/, name: 'process.* (não NODE_ENV)' },
    { pattern: /\bconsole\.(?:log|error|warn|info|debug)/, name: 'console.log' },
    { pattern: /\b(setTimeout|setInterval|setImmediate)\s*\(/, name: 'timer (side effect)' },
    { pattern: /\bMath\.random\b/, name: 'Math.random (não determinístico)' },
    { pattern: /\bnew\s+Date\b/, name: 'new Date (não determinístico)' },
  ];

  scanFiles('engine', 'js', (file, line, text, fullContent) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // Skip test files
    if (file.includes('.test.') || file.includes('__tests__')) return;

    // Skip known bridge/config files
    if (ioAllowedFiles.includes(file)) return;

    for (const { pattern, name } of ioPatterns) {
      if (pattern.test(trimmed)) {
        addIssue('error', 'engine', file, line, `I/O ou side-effect em engine/: ${name} — "${trimmed.substring(0, 80)}"`, 'Engine deve conter apenas funções puras. Mova I/O para api/services/.');
      }
    }
  });
}

// ── 4. No console.log in api/ (use logger) ──────────────────────────
function checkApiNoConsoleLog() {
  if (!dirExists('api/')) return;

  scanFiles('api', 'js', (file, line, text) => {
    // Skip test files
    if (file.includes('__tests__') || file.includes('.test.')) return;
    // Skip known allowed files
    if (file.includes('api/utils/logger')) return;

    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    if (/\bconsole\.(log|error|warn|info|debug)\s*\(/.test(trimmed)) {
      // Allow console.error in bootstrap/entrypoint files
      if (file.includes('api/server.js') || file.includes('api/bootstrap/') || file.includes('api/wait-for-')) {
        if (/console\.error/.test(trimmed)) return;
      }
      addIssue('warning', 'api', file, line, `console.log/error/warn em api/: "${trimmed.substring(0, 80)}"`, 'Use api/utils/logger em vez de console.log');
    }
  });
}

// ── 5. No setInterval for state sync (use WebSocket) ────────────────
function checkNoSetIntervalStateSync() {
  const dirs = ['api/', 'frontend/src/'];

  for (const dir of dirs) {
    if (!dirExists(dir)) continue;

    const exts = dir === 'frontend/src/' ? ['js', 'jsx'] : ['js'];
    for (const ext of exts) {
      scanFiles(dir, ext, (file, line, text) => {
        if (file.includes('__tests__') || file.includes('.test.')) return;

        const trimmed = text.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        if (/\bsetInterval\s*\(/.test(trimmed)) {
          // Not a false positive: flag all setInterval
          addIssue('error', 'state-sync', file, line, `setInterval detectado: "${trimmed.substring(0, 80)}"`, 'Use WebSocket para sincronização de estado. setInterval é proibido para state sync.');
        }
      });
    }
  }
}

// ── 6. Check shared module imports ──────────────────────────────────
function checkSharedModulePattern() {
  if (!dirExists('frontend/src/shared/')) return;

  scanFiles('frontend/src/shared', 'js', (file, line, text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // Shared should re-export from engine/utils
    if (/\brequire\s*\(/.test(trimmed)) {
      addIssue('warning', 'shared', file, line, `require() em frontend/src/shared/: "${trimmed.substring(0, 80)}"`, 'Use import para re-exportar de engine/utils/');
    }
  });
}

// ── 7. Check nodeSchemas.js as single source of truth ───────────────
function checkNodeSchemasExists() {
  const nodeSchemasPaths = ['frontend/src/editor/nodeSchemas.js', 'frontend/src/flow/nodes/nodeSchemas.js'];
  const foundSchemas = nodeSchemasPaths.find(p => exists(p));
  if (!foundSchemas) {
    addIssue('critical', 'flow-editor', 'nodeSchemas.js', 0, 'nodeSchemas.js (fonte única para campos/portas/validação) não encontrado', 'Restaurar arquivo canônico');
  } else if (foundSchemas !== nodeSchemasPaths[0]) {
    addIssue('info', 'flow-editor', foundSchemas, 0, `nodeSchemas.js em local alternativo: ${foundSchemas}`, 'Atualizar referências em CLAUDE.md/architecture.md');
  }
}

// ── 8. Check persistence: no in-memory fallback ─────────────────────
function checkNoMemoryFallback() {
  if (!dirExists('api/services/')) return;

  const memoryFallbackPatterns = [
    /\binMemory\b.*=.*(?:true|\[\]|\{\})/,
    /\bfallback.*memory\b/i,
    /\bcache\s*=\s*\{\}/,
  ];

  scanFiles('api/services', 'js', (file, line, text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    for (const pattern of memoryFallbackPatterns) {
      if (pattern.test(trimmed)) {
        addIssue('error', 'persistence', file, line, `Possível fallback em memória: "${trimmed.substring(0, 80)}"`, 'Sem fallback em memória. Erro explícito (persistence_required) em falha de DB.');
      }
    }
  });
}

// ── 9. Check defensive coercion ─────────────────────────────────────
function checkDefensiveCoercion() {
  if (!exists('api/utils/defensiveCoercion.js')) {
    addIssue('warning', 'api-utils', 'api/utils/defensiveCoercion.js', 0, 'api/utils/defensiveCoercion.js não encontrado', 'Criar módulo de coerção defensiva');
    return;
  }

  // Check that key services import it
  const keyServices = [
    'api/services/flowGeneratorService.impl.js',
    'api/services/rpaService.impl.js',
    'api/services/generationOrchestrator.impl.js',
  ];

  for (const svc of keyServices) {
    if (exists(svc)) {
      const content = readText(svc);
      if (!content.includes('defensiveCoercion') && !content.includes('defensive-coercion')) {
        addIssue('info', 'best-practice', svc, 0, 'Serviço chave não importa defensiveCoercion', 'Considere usar api/utils/defensiveCoercion para validação de inputs');
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[layer-conventions] Validando convenções de camada...\n');

  checkBackendCjs();
  checkFrontendEsm();
  checkEnginePurity();
  checkApiNoConsoleLog();
  checkNoSetIntervalStateSync();
  checkSharedModulePattern();
  checkNodeSchemasExists();
  checkNoMemoryFallback();
  checkDefensiveCoercion();

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  console.log(`  Criticals: ${criticals}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Warnings:  ${warnings}`);
  console.log(`  Infos:     ${infos}`);
  console.log(`  Total:     ${issues.length}\n`);

  // Defeito corrigido (2026-09-12): `errors > 0` mapeava para 'WARN' e o exit
  // code só considerava 'FAIL'. Como nenhum check emite 'critical' em operação
  // normal, este validador era ESTRUTURALMENTE incapaz de falhar: 338 violações
  // (51 delas `setInterval`, regra documentada como PROIBIDA) conviviam com
  // `status = PASS / overallGovernance = 100`. Violação de severidade `error`
  // precisa falhar; do contrário o relatório informa e não protege nada.
  const status = (criticals > 0 || errors > 0) ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS';

  // Group by layer
  const byLayer = {};
  for (const issue of issues) {
    if (!byLayer[issue.layer]) byLayer[issue.layer] = [];
    byLayer[issue.layer].push(issue);
  }

  const report = {
    name: 'layer-conventions-validation',
    status,
    criticals,
    errors,
    warnings,
    infos,
    totalIssues: issues.length,
    byLayer: Object.fromEntries(
      Object.entries(byLayer).map(([k, v]) => [k, v.length])
    ),
    // Sem truncamento: antes era `issues.slice(0, 200)` enquanto o console
    // apontava para este relatório pedindo as violações restantes (138 delas
    // não existiam no arquivo). Um artefato de prova não pode subnotificar a
    // si mesmo.
    issues,
  };

  const outPath = writeReport('layer-conventions-report.json', report);

  // Print layer summary
  console.log('Violações por camada:');
  for (const [layer, count] of Object.entries(report.byLayer)) {
    const icon = layer === 'api' ? '🔵' : layer === 'frontend' ? '🟢' : layer === 'engine' ? '🟣' : '⚪';
    console.log(`  ${icon} ${layer}: ${count}`);
  }
  console.log('');

  // Print sample issues
  if (issues.length > 0) {
    console.log('Amostra de issues:');
    for (const issue of issues.slice(0, 10)) {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'error' ? '🟠' : issue.severity === 'warning' ? '🟡' : '🔵';
      console.log(`  ${icon} [${issue.layer}] ${issue.file}:${issue.line} — ${issue.message}`);
    }
    if (issues.length > 10) console.log(`  ... and ${issues.length - 10} more (see ${outPath})`);
  }

  console.log(`\nReport: ${outPath}`);
  return status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
