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
const { evaluateStateSyncRule } = require('./state-sync-rule');

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
    // Ponte de TEMPO: a engine não lê o relógio espalhada por 20+ arquivos; ela lê
    // AQUI, e a borda (API/CLI/replay/teste) injeta o provider — inclusive um
    // relógio congelado, que é o que torna o replay determinístico de fato.
    // MEDIDO em 2026-10-13: eram 31 `new Date()` + 25 `Date.now()` no engine/.
    // Concentrar a porta é o oposto de espalhar exceção: mantém o resto puro.
    'engine/shared/clock.js',
    // MESMA POLÍTICA para as demais dependências de ambiente. Cada uma é PORTa
    // única e injetável (`setXProvider`), com default idêntico ao comportamento
    // anterior — a engine declara a dependência, a borda decide o valor.
    // Importar como NAMESPACE (`clock.nowMs()`, `timers.setTimeout()`), nunca como
    // nome solto: 7 arquivos do engine já declaram `now`/`nowIso`/`random` locais e
    // nome solto produziu recursão infinita + TDZ (medido em `engine/utils.js`).
    'engine/shared/random.js',   // aleatório  → `rng.random()`   (determinismo de replay)
    'engine/shared/logger.js',   // log        → `logPort.info()`  (observabilidade da borda)
    'engine/shared/scheduler.js',// timers     → `timers.setTimeout()`
    'engine/shared/fileSystem.js',// leitura   → `fsPort.readFileSync()`
    'engine/shared/runtimeEnv.js',// cwd/env   → `envPort.cwd()`
  ];

  const ioPatterns = [
    { pattern: /\brequire\s*\(\s*['"](?:fs|http|https|net|dgram|child_process|process|os)['"]/, name: 'require(fs/http/process)' },
    { pattern: /(?<![.\w])fs\./, name: 'fs.*' },
    { pattern: /\bprocess\.(?!env\.NODE_ENV)/, name: 'process.* (não NODE_ENV)' },
    { pattern: /\bconsole\.(?:log|error|warn|info|debug)/, name: 'console.log' },
    // PRECISÃO: `timers.setTimeout(...)` é a PORTA injetável, não efeito direto —
    // o `\b` anterior casava a chamada qualificada por namespace e acusava a própria
    // correção. A lookbehind mantém a acusação para a chamada GLOBAL (`setTimeout(`),
    // que é a que cria efeito fora do controle da engine.
    { pattern: /(?<![.\w])(setTimeout|setInterval|setImmediate)\s*\(/, name: 'timer (side effect)' },
    { pattern: /(?<![.\w])Math\.random\b/, name: 'Math.random (não determinístico)' },
    // LEITURA DE RELÓGIO — a regra precisa distinguir `new Date()` de `new Date(arg)`.
    //
    // MEDIDO em 2026-10-13 (engine/, fora de testes): 35 `new Date()` (leitura),
    // 16 `new Date(x)` (CONVERSÃO de valor — determinística) e **35 `Date.now()`
    // que a regra NÃO acusava**. Ou seja, a regra antiga (`/\bnew\s+Date\b/`) era ao
    // mesmo tempo IMPRECISA (16 falsos positivos) e INCOMPLETA (35 pontos cegos numa
    // classe que ela diz cobrir). Esta versão corrige os dois lados: acusa quem LÊ o
    // relógio (`new Date()` e `Date.now()`) e para de acusar quem apenas CONVERTE um
    // valor já conhecido (`new Date(ms)`).
    //
    // Atenção: `new Date(variavel)` com variável possivelmente `undefined` VOLTA a
    // ler o relógio. Esse é um defeito de TRATAMENTO DE ENTRADA (o valor deveria ser
    // validado antes), não de pureza determinística — e tratá-lo aqui faria a regra
    // voltar a acusar conversões legítimas. Fica registrado como classe própria.
    { pattern: /\bnew\s+Date\s*\(\s*\)/, name: 'new Date() — lê o relógio (não determinístico)' },
    { pattern: /\bDate\.now\s*\(\s*\)/, name: 'Date.now() — lê o relógio (não determinístico)' },
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

// ── 5. Nenhum setInterval para sincronizar estado (use WebSocket) ───
//
// A REGRA vive em `scripts/governance/state-sync-rule.js`, consumida TAMBÉM pelo
// gate bloqueante `validate-state-sync.js` — uma única fonte da verdade, sem
// lógica duplicada. Aqui ela apenas reporta; lá ela bloqueia.
//
// Histórico do defeito (2026-09-12): o check varria `api/` também (worker de
// backend em timer é o padrão correto — 19 falsos positivos de escopo) e marcava
// TODA ocorrência como `error`, enquanto o status do validador mapeava `error`
// para WARN e o exit só considerava FAIL: 45 violações conviviam com
// `overallGovernance = 100`.
function checkNoSetIntervalStateSync() {
  const result = evaluateStateSyncRule(ROOT);

  for (const issue of [...result.violations, ...result.stale]) {
    addIssue(issue.severity, 'state-sync', issue.file, issue.line, issue.message, issue.suggestion);
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
/** Padrões ORIGINAIS da política de camada (não afrouxados). */
const MEMORY_FALLBACK_PATTERNS = Object.freeze([
  /\binMemory\b.*=.*(?:true|\[\]|\{\})/,
  /\bfallback.*memory\b/i,
  /\bcache\s*=\s*\{\}/,
]);

/**
 * Linhas que apenas LEEM/REPORTAM a política de degradação não são a própria
 * degradação. A implementação real de um fallback está onde o store em memória
 * é CONSTRUÍDO (p.ex. `infra/rate-limit`), não na linha que consulta a chave de
 * configuração para informar o status.
 *
 * Falso positivo real corrigido aqui (2026-09-13):
 * `api/services/systemStatusService.js` marcava como violação de persistência a
 * linha `config.get('fallbacks.rateLimitRedisToMemory', false)` — que só
 * REPORTA o status do Redis (e cujo comportamento em produção é fail-closed:
 * `unhealthy`). O fallback existente é de RATE LIMITING, não de persistência.
 */
const POLICY_READ_PATTERN = /\b(?:config|settings)\.get\s*\(|\bprocess\.env\.[A-Z_]+\b/;

/** Construção/atribuição de store na própria linha (sinal de implementação). */
const CONSTRUCTS_STORE_PATTERN = /=\s*\{\}|=\s*\[\]|\bnew\s+[A-Za-z_$]|=\s*new\b/;

/**
 * Decide se UMA linha é violação de "fallback em memória".
 *
 * Mantém os três padrões originais (nenhum afrouxamento) e exclui apenas as
 * linhas que consultam configuração, que descrevem a política em vez de
 * implementá-la. O contrato é fixado nos DOIS sentidos em
 * `tests/unit/governance/layerConventionsPersistenceRule.test.js`.
 *
 * @param {string} rawLine linha do arquivo
 * @returns {boolean}
 */
function isInMemoryFallbackLine(rawLine) {
  const trimmed = String(rawLine || '').trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
  if (MEMORY_FALLBACK_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    // Ler a política não é implementar a degradação — MAS, se a MESMA linha
    // constrói o store, ela é a degradação e continua sendo violação.
    if (POLICY_READ_PATTERN.test(trimmed) && !CONSTRUCTS_STORE_PATTERN.test(trimmed)) return false;
    return true;
  }
  return false;
}

function checkNoMemoryFallback() {
  if (!dirExists('api/services/')) return;

  scanFiles('api/services', 'js', (file, line, text) => {
    if (isInMemoryFallbackLine(text)) {
      addIssue('error', 'persistence', file, line, `Possível fallback em memória: "${text.trim().substring(0, 80)}"`, 'Sem fallback em memória. Erro explícito (persistence_required) em falha de DB.');
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

module.exports = { run, isInMemoryFallbackLine };
