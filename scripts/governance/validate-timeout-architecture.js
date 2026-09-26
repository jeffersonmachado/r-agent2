#!/usr/bin/env node
'use strict';

/**
 * validate-timeout-architecture.js — gate da ARQUITETURA DE TIMEOUTS.
 *
 * PRINCÍPIO CENTRAL: SLOW != STUCK != DEAD.
 *   - liveness  = heartbeat + lease + fence (determinístico)
 *   - avanço    = progresso significativo (lastMeaningfulProgressAt)
 *   - limite    = deadline da OPERAÇÃO, nunca da missão por wall-clock
 *
 * Uma operação individual pode expirar (provider/HTTP/DB/comando) SEM matar a
 * missão: o esperado é retry/fallback/replan/BLOCKED, não FAILED.
 *
 * Emite `TIMEOUT_ARCHITECTURE_REPORT.json` com inventário, classificação,
 * achados legados, políticas, exceções e evidência de runtime.
 *
 * Uso:
 *   node scripts/governance/validate-timeout-architecture.js
 *   node scripts/governance/validate-timeout-architecture.js --json
 *
 * Exit 0 somente quando TIMEOUT_ARCHITECTURE = GREEN.
 */

const fs = require('fs');
const path = require('path');

const { buildInventory, TIMEOUT_CATEGORIES } = require('./lib/timeoutInventory');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'TIMEOUT_ARCHITECTURE_REPORT.json');
const EVIDENCE_PATH = path.join(ROOT_DIR, 'reports', 'timeout-architecture-evidence.json');

/** Diretórios varridos: só código de runtime/governança (nunca dist/node_modules). */
const SCAN_ROOTS = ['api', 'engine', 'governance', 'pipeline', 'scripts', 'tools', 'lib', 'src', 'qa'];
const SKIP_DIR_RE = /(node_modules|dist|\.git|coverage|venv|__pycache__|fixtures|frontend)/;

/** Capacidade: símbolo(s) que PROVAM a existência no código. */
const CAPABILITIES = Object.freeze({
  LEASE: {
    any: [/acquireTaskLease\s*\(/, /lease_expires_at/],
    all: [/renewTaskLease\s*\(/, /releaseTaskLease\s*\(/],
    desc: 'lease adquirido, renovável e liberado (duração ≠ duração da task)',
  },
  FENCING: {
    any: [/lease_fence/, /TASK_STALE_WORKER_WRITE/],
    all: [/lease_fence\s*\+\s*1/, /TASK_STALE_WORKER_WRITE/],
    desc: 'token de fencing monotônico que REJEITA escrita de worker antigo',
  },
  HEARTBEAT: {
    any: [/heartbeat/i],
    all: [/renewTaskLease\s*\(/],
    desc: 'heartbeat periódico que renova o lease',
  },
  NO_PROGRESS_DETECTION: {
    // Exige o núcleo puro de política de progresso E o marco persistido: sem
    // persistir `last_progress_at`, o detector não sobrevive a restart e a
    // distinção "vivo sem avançar" (STUCK) x "avançando" (SLOW) se perde.
    any: [/evaluateProgress\s*\(/, /last_meaningful_progress_at/, /last_progress_at/],
    all: [/evaluateProgress\s*\(/, /last_progress_at/],
    desc: 'detector de falta de PROGRESSO separado de liveness (heartbeat ≠ avanço)',
  },
  PROVIDER_TIMEOUT_ISOLATION: {
    any: [/PROVIDER_TIMEOUT/, /providerTimeout/, /ai_timeout/],
    all: [/PROVIDER_TIMEOUT|providerTimeout|ai_timeout/],
    desc: 'timeout de provider marca a TENTATIVA, sem matar worker/mission',
  },
  PROVIDER_FALLBACK: {
    any: [/fallback/i],
    all: [/fallback/i],
    desc: 'fallback de provider após esgotar retry',
  },
  COMMAND_TIMEOUT_ISOLATION: {
    any: [/commandTimeout|COMMAND_TIMEOUT|COMMAND_DEADLINE/],
    all: [/commandTimeout|COMMAND_TIMEOUT|COMMAND_DEADLINE/],
    desc: 'deadline de comando termina o CHILD, não o worker',
  },
  DATABASE_TIMEOUT_ISOLATION: {
    any: [/DB_TIMEOUT|databaseTimeout|DATABASE_TIMEOUT/],
    all: [/DB_TIMEOUT|databaseTimeout|DATABASE_TIMEOUT/],
    desc: 'timeout de banco classificado por operação, sem matar worker',
  },
  CIRCUIT_BREAKER: {
    any: [/circuitBreaker|CIRCUIT_OPEN|HALF_OPEN/],
    all: [/circuitBreaker|CIRCUIT_OPEN|HALF_OPEN/],
    desc: 'proteção contra retry storm / provider indisponível',
  },
  CHECKPOINT_RESUME: {
    any: [/checkpoint/i],
    all: [/checkpoint/i],
    desc: 'checkpoint antes de operação longa + resume que reconcilia outcome',
  },
});

/**
 * Evidência de capacidade tem de vir do PRODUTO, não de ferramenta de
 * governança.
 *
 * DEFEITO REAL do próprio validador (medido 2026-09-26): ele dava
 * `NO_PROGRESS_DETECTION = GREEN` sem existir UMA linha de implementação — a
 * regex `NO_PROGRESS` casava com a própria DOCUMENTAÇÃO deste arquivo, porque a
 * varredura inclui `scripts/`. Um gate que se auto-satisfaz é greenwashing, e é
 * exatamente o que a missão proíbe. Agora a evidência precisa estar em
 * api/ engine/ lib/ src/ qa-mesh/ pipeline/ (e nunca neste validador).
 */
const RUNTIME_EVIDENCE_RE = /^(api|engine|lib|src|qa-mesh|pipeline)\//;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT_DIR, full);
    if (SKIP_DIR_RE.test(rel)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push({ file: rel, abs: full });
  }
  return out;
}

function collectSources() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT_DIR, root);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      files.push({ file: f.file, source: fs.readFileSync(f.abs, 'utf8') });
    }
  }
  return files;
}

/** Explora a presença de uma capacidade nos fontes (nunca nos testes). */
function probeCapability(sources, spec) {
  // Somente código de PRODUTO: fora de testes, fora de ferramentas de governança.
  const runtime = sources.filter((s) => RUNTIME_EVIDENCE_RE.test(s.file));
  const hit = { any: [], all: [], runtimeFiles: [] };
  // `any` é OR: basta UMA das expressões casar. Marcar falta quando apenas uma
  // delas não casa produzia NO_GO FALSO (a capacidade era declarada ausente só
  // porque o sinônimo alternativo não aparecia no código).
  const anyHits = [];
  for (const re of spec.any) {
    const files = runtime.filter((s) => re.test(s.source)).map((s) => s.file);
    if (files.length > 0) anyHits.push(...files);
  }
  if (anyHits.length === 0) hit.missingAny = spec.any.map(String);
  hit.any.push(...anyHits);
  hit.runtimeFiles.push(...anyHits);

  // `all` é AND: cada expressão precisa de pelo menos um arquivo.
  for (const re of spec.all) {
    const files = runtime.filter((s) => re.test(s.source)).map((s) => s.file);
    if (files.length === 0) (hit.missingAll = hit.missingAll || []).push(String(re));
    hit.all.push(...files);
    hit.runtimeFiles.push(...files);
  }
  const ok = !hit.missingAny && !hit.missingAll;
  return { ok, missingAny: hit.missingAny || [], missingAll: hit.missingAll || [], files: [...new Set(hit.runtimeFiles)].slice(0, 6) };
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  const sources = collectSources();
  const inventory = buildInventory(sources);

  // ---- capacidades ---------------------------------------------------------
  const capabilities = {};
  for (const [name, spec] of Object.entries(CAPABILITIES)) {
    const probe = probeCapability(sources, spec);
    capabilities[name] = { ok: probe.ok, desc: spec.desc, evidenceFiles: probe.files, missingAny: probe.missingAny, missingAll: probe.missingAll };
  }

  // ---- padrões destrutivos (kill por wall-clock / stale por idade / PID) ----
  //
  // PID: a pergunta certa não é "existe process.kill(pid, 0)?" — é "quem DECIDE
  // a posse?". Se o MESMO arquivo contém autoridade de lease/fencing, o PID é
  // corroboração local (exceção auditável, registrada no relatório). Se não
  // contém, o PID É a autoridade — proibido pela missão (§"Não usar PID como
  // identidade distribuída autoritativa"). Sem essa distinção o gate acusa quem
  // já corrigiu o problema (falso alarme em cima de documentação correta).
  const LEASE_AUTHORITY_RE = /lease_token|lease_fence|lease_expires_at|lease_worker_instance_id|decideMeshLease|resolveLeaseState|canAcquire|assertWriterAuthorized/;
  const sourceByFile = new Map(sources.map((s) => [s.file, s.source]));

  const forbidden = [];
  const pidCorroborations = [];
  for (const d of inventory.destructive) {
    if (d.id === 'PID_AS_LIVENESS_AUTHORITY') {
      const src = sourceByFile.get(d.file) || '';
      if (LEASE_AUTHORITY_RE.test(src)) {
        pidCorroborations.push({
          ...d,
          id: 'PID_LIVENESS_CORROBORATION_DECLARED',
          note: 'arquivo contém autoridade de lease/fence; PID é apenas corroboração local de diagnóstico',
        });
        continue;
      }
    }
    if (d.id === 'MISSION_KILL_BY_WALL_CLOCK' || d.id === 'STALE_BY_AGE_ONLY' || d.id === 'PID_AS_LIVENESS_AUTHORITY') {
      forbidden.push(d);
    }
  }
  const forbiddenCritical = forbidden.filter((d) => d.critical);
  const unclassifiedCritical = inventory.destructive.filter((d) => d.id === 'UNCLASSIFIED_TIMER_IN_CRITICAL_COMPONENT');

  // ---- evidência de runtime (produzida pelos E2E; ausente = PENDING) -------
  const evidence = readJsonSafe(EVIDENCE_PATH);
  const ev = (key) => (evidence && evidence[key] ? evidence[key] : 'PENDING');

  const inventoryComplete = inventory.legacyUnknown === 0;
  const noMissionKill = forbiddenCritical.length === 0;

  const statusOf = (ok) => (ok ? 'GREEN' : 'NO_GO');

  const verdicts = {
    TIMEOUT_ARCHITECTURE: statusOf(inventoryComplete && noMissionKill
      && capabilities.LEASE.ok && capabilities.FENCING.ok && capabilities.HEARTBEAT.ok
      && capabilities.NO_PROGRESS_DETECTION.ok && capabilities.PROVIDER_TIMEOUT_ISOLATION.ok
      && capabilities.COMMAND_TIMEOUT_ISOLATION.ok && capabilities.DATABASE_TIMEOUT_ISOLATION.ok
      && ev('LONG_RUNNING_TASK') === 'PASS' && ev('REAL_DEAD_WORKER_RECOVERY') === 'PASS'),
    TIMEOUT_INVENTORY: inventoryComplete ? 'COMPLETE' : 'INCOMPLETE',
    MISSION_TIMEOUT_POLICY: statusOf(noMissionKill),
    TASK_DEADLINE_POLICY: statusOf(noMissionKill && capabilities.LEASE.ok),
    HEARTBEAT: statusOf(capabilities.HEARTBEAT.ok),
    LEASE: statusOf(capabilities.LEASE.ok),
    FENCING: statusOf(capabilities.FENCING.ok),
    NO_PROGRESS_DETECTION: statusOf(capabilities.NO_PROGRESS_DETECTION.ok),
    PROVIDER_TIMEOUT_ISOLATION: statusOf(capabilities.PROVIDER_TIMEOUT_ISOLATION.ok),
    PROVIDER_FALLBACK: statusOf(capabilities.PROVIDER_FALLBACK.ok),
    COMMAND_TIMEOUT_ISOLATION: statusOf(capabilities.COMMAND_TIMEOUT_ISOLATION.ok),
    DATABASE_TIMEOUT_ISOLATION: statusOf(capabilities.DATABASE_TIMEOUT_ISOLATION.ok),
    CIRCUIT_BREAKER: statusOf(capabilities.CIRCUIT_BREAKER.ok),
    CHECKPOINT_RESUME: statusOf(capabilities.CHECKPOINT_RESUME.ok),
    LONG_RUNNING_TASK: ev('LONG_RUNNING_TASK'),
    REAL_DEAD_WORKER_RECOVERY: ev('REAL_DEAD_WORKER_RECOVERY'),
    NO_PROGRESS_E2E: ev('NO_PROGRESS_E2E'),
    PROVIDER_FALLBACK_E2E: ev('PROVIDER_FALLBACK_E2E'),
    ENGINEERING_ROUTER_V2_SEAL: 'NO_GO',
    RAP_FINAL_RELEASE: 'NO_GO',
  };
  verdicts.ENGINEERING_ROUTER_V2_SEAL = verdicts.TIMEOUT_ARCHITECTURE === 'GREEN' ? 'GO' : 'NO_GO';
  verdicts.RAP_FINAL_RELEASE = verdicts.TIMEOUT_ARCHITECTURE === 'GREEN' ? 'GO' : 'NO_GO';

  const report = {
    artifactType: 'TIMEOUT_ARCHITECTURE_REPORT',
    generatedAt: new Date().toISOString(),
    commit: (() => {
      try {
        return require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch {
        return null;
      }
    })(),
    principle: 'SLOW != STUCK != DEAD — liveness por heartbeat/lease/fence; avanço por progresso; limite por deadline de operação',
    scanRoots: SCAN_ROOTS,
    inventorySummary: {
      filesScanned: inventory.filesScanned,
      total: inventory.total,
      byCategory: inventory.byCategory,
      legacyUnknownBefore: inventory.legacyUnknown,
      legacyUnknownAfter: inventory.legacyUnknown,
      categoriesDefined: Object.values(TIMEOUT_CATEGORIES).length,
    },
    // Inventário COMPLETO (machine-readable): cada timeout com arquivo, linha,
    // símbolo, valor, unidade, categoria, ação no disparo e as flags exigidas
    // (mata processo? falha task? falha missão? há retry/fallback/recovery?).
    inventory: inventory.entries,
    destructiveFindings: {
      total: inventory.destructive.length,
      critical: inventory.destructiveCritical,
      forbiddenTotal: forbidden.length,
      forbiddenCritical: forbiddenCritical.length,
      unclassifiedCriticalTimers: unclassifiedCritical.length,
      // Exceções AUDITÁVEIS: PID usado apenas como corroboração local, em arquivo
      // que tem lease/fence como autoridade. Listadas, nunca escondidas.
      pidCorroborations: pidCorroborations.length,
      items: inventory.destructive.slice(0, 200),
      exceptions: pidCorroborations.slice(0, 50),
    },
    capabilities,
    verdicts,
    runtimeEvidence: evidence || { status: 'PENDING', hint: 'rode os E2E de timeout para preencher reports/timeout-architecture-evidence.json' },
    inventoryPath: path.relative(ROOT_DIR, REPORT_PATH),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('[timeout-architecture] inventário:');
  console.log(`  arquivos varridos: ${inventory.filesScanned}`);
  console.log(`  timeouts encontrados: ${inventory.total}`);
  console.log(`  LEGACY_UNKNOWN: ${inventory.legacyUnknown}`);
  for (const [cat, n] of Object.entries(inventory.byCategory)) {
    if (n > 0) console.log(`    ${cat.padEnd(26)} ${n}`);
  }
  console.log(`[timeout-architecture] padrões destrutivos: ${inventory.destructive.length} (críticos: ${inventory.destructiveCritical})`);
  if (pidCorroborations.length > 0) {
    console.log(`  ⓘ PID como corroboração local (arquivo tem lease/fence): ${pidCorroborations.length} — exceções auditáveis`);
  }
  for (const d of forbiddenCritical.slice(0, 10)) {
    console.log(`  ✗ ${d.id} ${d.file}:${d.line} :: ${d.match}`);
  }
  if (unclassifiedCritical.length > 0) {
    console.log(`  ⚠ timers sem categoria em componente crítico: ${unclassifiedCritical.length}`);
    for (const d of unclassifiedCritical.slice(0, 8)) console.log(`     ${d.file}:${d.line}`);
  }
  console.log('[timeout-architecture] capacidades:');
  for (const [name, cap] of Object.entries(capabilities)) {
    console.log(`  ${cap.ok ? '✓' : '✗'} ${name.padEnd(30)} ${cap.ok ? '' : `faltando: ${[...cap.missingAny, ...cap.missingAll].slice(0, 2).join(', ')}`}`);
  }
  console.log('[timeout-architecture] veredictos:');
  for (const [k, v] of Object.entries(verdicts)) {
    console.log(`  ${String(v).padEnd(10)} ${k}`);
  }
  console.log(`[timeout-architecture] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  if (verdicts.TIMEOUT_ARCHITECTURE !== 'GREEN') {
    console.log('[timeout-architecture] RESULTADO: NO_GO — arquitetura de timeout ainda não é GREEN');
    process.exit(1);
  }
  console.log('[timeout-architecture] RESULTADO: GREEN');
}

if (require.main === module) {
  main();
}

module.exports = { CAPABILITIES, collectSources, probeCapability };
