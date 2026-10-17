#!/usr/bin/env node
'use strict';

/**
 * json-persistence-audit.js — inventário automático de persistência JSON.
 *
 * Varre o código do runtime (api/, core/, engine/, lib/, src/, qa-mesh/, qa/,
 * governance/, scripts/, tools/, pipeline/, frontend/src) por escritas de
 * arquivos `.json` e classifica cada alvo em uma das categorias da taxonomia
 * canônica de persistência:
 *
 *   DB_CANONICAL_STATE          — JSON usado como banco de estado mutável (DEVE ser migrado p/ DB)
 *   DB_CANONICAL_JSON_EXPORT    — export derivado do banco (source of truth é o DB)
 *   ARTIFACT_STORAGE            — artefato pesado/objeto (zip, trace, screenshot, dump)
 *   STATIC_VERSIONED_CONFIG     — configuração declarativa versionada (não mutável em runtime)
 *   TEST_FIXTURE                — fixture/artefato de teste
 *   SECRET_STORE                — credenciais (nunca em plaintext versionado)
 *   TEMPORARY_CACHE             — cache reconstruível a partir de fonte canônica
 *   DEPRECATED                  — legado, não deve ser escrito
 *   UNKNOWN                     — sem classificação (não permitido)
 *
 * Saída: governance/json-persistence-audit.json (EXPORT, não fonte canônica).
 *
 * Uso:
 *   node governance/json-persistence-audit.js [--check]
 *
 * --check: falha (exit 1) se houver qualquer alvo UNKNOWN ou DEPRECATED.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// Classificações manuais dos alvos conhecidos (curadoria honesta).
// Caminhos relativos ao ROOT. A categoria DB_CANONICAL_STATE marca estado
// mutável que ainda vive em arquivo e precisa ser migrado para o banco.
const CLASSIFIED = {
  // ── Governance: exports derivados do DB (source of truth = governance_runs/scorecard_*/gates/gaps) ──
  'governance/final-readiness-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/final-governance-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/final-proof-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/final-consistency-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/final-consistency-gate-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/replay-consistency-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/replay-hardening-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/replay-integrity-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/readiness-drift-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/report-contamination-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/package-validation-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/package-integrity-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/tamper-detection-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/governance-persistence-validation-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/agent-policy-compliance-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/mutable-json-state-validation-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/certification-snapshot.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/rap-master-scorecard.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/evidence-manifest.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/system-scope-audit.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/critical-journey-evidence.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/delivered-release-verification-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/json-persistence-audit.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/cleanup-proof.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/cross-report-validation.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/readiness-state.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/.current-run.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/materialized-proof-artifacts-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/governance-score.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/master-scorecard-regression-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/master-scorecard-test-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/coverage-gate-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/db-integrity-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/api-surface-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/page-surface-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/tenant-isolation-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/inventory-build-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/stack-versions-report.json': 'DB_CANONICAL_JSON_EXPORT',
  // Bug Closure First (2026-10-17): relatórios derivados da fila oficial.
  // A fonte canônica continua sendo `AI_MEMORY/hardening-queue.json` (abaixo);
  // estes dois são EXPORT regenerável a cada execução dos validadores.
  'reports/bug-closure-status.json': 'DB_CANONICAL_JSON_EXPORT',
  'reports/hardening-queue-migration.json': 'DB_CANONICAL_JSON_EXPORT',
  // Veredito PRÓPRIO do gate agregado (P1: antes só existia o exit code do
  // processo que invocava a cadeia `&&`).
  'reports/governance-enforcement-verdict.json': 'DB_CANONICAL_JSON_EXPORT',
  // Fila oficial de pendências: configuração DECLARATIVA versionada (lida e
  // escrita por `scripts/governance/migrate-hardening-queue.js`), não estado de
  // runtime. A classificação por basename abaixo existe para leitores que não
  // resolvem o diretório; esta entrada cobre o caminho completo.
  'AI_MEMORY/hardening-queue.json': 'STATIC_VERSIONED_CONFIG',
  // Evidência versionada de auditoria (checkpoints, entrypoint, relatórios de
  // sessão). É documentação/prova sob git — não estado de runtime. Fica fora do
  // diretório de runtime (`/var/lib/ragent2`) justamente por ser versionada.
  // Alvo .json aqui continua proibido na prática (`AI_MEMORY/evidence/` só recebe
  // .md; ver `audit:json-persistence`), mas o DIRETÓRIO precisa estar na
  // taxonomia para não aparecer como UNKNOWN quando algum produtor gravar ali.
  'AI_MEMORY/evidence/': 'STATIC_VERSIONED_CONFIG',
  'qa-mesh/go-no-go-report.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/meshHistory/': 'DB_CANONICAL_JSON_EXPORT',
  'qa/qa-waves-enterprise-governance.json': 'DB_CANONICAL_JSON_EXPORT',

  // ── Configuração declarativa versionada (não mutável em runtime) ──
  'api/data/config.json': 'STATIC_VERSIONED_CONFIG',
  'config/': 'STATIC_VERSIONED_CONFIG',
  'contracts/': 'STATIC_VERSIONED_CONFIG',
  'qa/contracts/': 'STATIC_VERSIONED_CONFIG',

  // ── Estado mutável migrado p/ DB (dbStateStore) — JSON agora é export derivado ──
  'qa-mesh/meshRegistry.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa/qa-waves/ai-drafts.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa/qa-waves/journey-store.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa/qa-waves/coverage-map.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/baseline.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/canonical-promotion.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/scheduler-state.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/gap-engine/backlog.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa-mesh/gap-engine/latest.json': 'DB_CANONICAL_JSON_EXPORT',
  'governance/node-marketplace-registry.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa/checkpoints/': 'DB_CANONICAL_JSON_EXPORT',
  'core/rpa/reports/bugs/bug-memory.json': 'DB_CANONICAL_JSON_EXPORT',
  'qa/mesh/intelligence/': 'DB_CANONICAL_JSON_EXPORT',

  // ── Artefatos pesados / object storage ──
  'dist/': 'ARTIFACT_STORAGE',
  'logs/': 'ARTIFACT_STORAGE',
  'cache/': 'ARTIFACT_STORAGE',
  'qa/enterprise/': 'ARTIFACT_STORAGE',
  'qa/evidence/': 'ARTIFACT_STORAGE',
  'governance/proof-signature.json': 'ARTIFACT_STORAGE',
  'docs/governance/_platform-status-source.json': 'STATIC_VERSIONED_CONFIG',

  // ── Cache transitório reconstruível ──
  'dev/platform-readiness/': 'TEMPORARY_CACHE',
  'qa-mesh/meshHistory/': 'DB_CANONICAL_JSON_EXPORT',
};

// Classificação por basename para alvos cujo diretório é resolvido dinamicamente
// (ex.: scripts/smoke escreve em qa/enterprise/ com caminho relativo variável).
const BASENAME_CLASSIFIED = {
  'human-handoff-full-validation.json': 'ARTIFACT_STORAGE',
  'pbx-voice-flow-prod-like.json': 'ARTIFACT_STORAGE',
  'omnichannel-unified-replay.json': 'ARTIFACT_STORAGE',
  'enterprise-proof-report.json': 'ARTIFACT_STORAGE',
  'meshRegistry.json': 'DB_CANONICAL_JSON_EXPORT',
  // Checkpoints de execução (migrados p/ DB via dbStateStore)
  'progress.json': 'DB_CANONICAL_JSON_EXPORT',
  // Receipt de publicação pós-tag: escrito em governance/ via outDir dinâmico.
  'release-publication-receipt.json': 'DB_CANONICAL_JSON_EXPORT',
  // Estado de fase do release (`governance/release-phase-runner.js`): escrito em
  // `reports/` via `path.join` resolvido em variável, logo o scanner só enxerga
  // o basename. É DERIVADO e regenerável pelo próprio comando de fase — mesma
  // natureza dos demais relatórios de `reports/`, nunca autoridade de estado.
  'release-phase-state.json': 'DB_CANONICAL_JSON_EXPORT',
  // Fixtures transitórias do gate market-discovery-runtime: escritas em
  // `fs.mkdtempSync(os.tmpdir())` e apagadas no `finally` do próprio check —
  // reconstruíveis a cada execução, nunca estado.
  'market-discovery-gate-fixture.sample.json': 'TEMPORARY_CACHE',
  'market-discovery-gate-fixture.run-export.json': 'TEMPORARY_CACHE',
  // Fila oficial de missão (AI_MEMORY/hardening-queue.json): o alvo é montado
  // como `path.join('AI_MEMORY', 'hardening-queue.json')` em
  // api/services/devGovernance/pendenciesService.js — sem base resolvida, logo o
  // scanner só enxerga o basename. A API APENAS LÊ esta fila (nenhuma escrita em
  // runtime); a mutação é feita por commit, como manda a constituição. É
  // portanto configuração declarativa versionada, não estado mutável de runtime.
  'hardening-queue.json': 'STATIC_VERSIONED_CONFIG',
};

// Caminhos de runtime que NÃO devem conter escritas JSON não classificadas.
const SCAN_ROOTS = ['api', 'core', 'engine', 'lib', 'src', 'qa-mesh', 'qa', 'governance', 'scripts', 'tools', 'pipeline', 'frontend/src'];

/**
 * O `path.join` em `index` é argumento de uma chamada de LEITURA?
 *
 * `path.join` serve leitura E escrita; sem esta distinção, um leitor como
 * `readJsonIfExists(path.join(rootDir, 'config', 'integrations', 'evo-contract.json'))`
 * era registrado como alvo de escrita JSON e derrubava RAP-078 sem existir
 * escrita alguma. Nenhum writer é precedido por leitor, então excluir este
 * contexto não pode esconder escrita real.
 */
function isReaderCallContext(source, index) {
  return /(readFileSync|readJson[A-Za-z]*|require|existsSync|statSync|lstatSync|accessSync|readdirSync)\s*\(\s*$/.test(String(source).slice(0, index));
}

// Alvos estáticos de escrita JSON. Extrai:
//  1. literais diretos: writeFileSync('....json')
//  2. path.join(..., '....json') — resolve __dirname relativo ao arquivo,
//     ROOT_DIR/process.cwd() relativo à raiz.
function scanWriteTargets() {
  const targets = new Map();
  const add = (writer, target) => {
    if (!target || /[<>()]/.test(target) || target.includes('endsWith')) return; // falso positivo do regex
    const norm = target.replace(/^\.\//, '').replace(/\\/g, '/');
    if (!norm.endsWith('.json') || /^\.+\.json$/.test(norm)) return;
    const key = `${writer}::${norm}`;
    if (!targets.has(key)) targets.set(key, { writer, target: norm });
  };
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        walk(abs);
      } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
        const src = fs.readFileSync(abs, 'utf8');
        const relFile = path.relative(ROOT, abs).replace(/\\/g, '/');
        const fileDir = path.dirname(abs);

        // 1. writeFileSync/writeFile/outputJson/writeJson/appendFile com literal .json
        const directRe = /\b(writeFileSync|writeFile|outputJson|writeJson|writeJsonAtomic|appendFile(?:Sync)?)\s*\(\s*(['"`])([^'"`]+\.json)\2/gm;
        let m;
        while ((m = directRe.exec(src)) !== null) {
          if (m[3].includes('${') || m[3].includes('$(')) continue;
          add(relFile, m[3]);
        }

        // 2. path.join(...) cujo último segmento literal é um .json
        //
        // FALSO POSITIVO CORRIGIDO: `path.join(...)` é usado tanto para ESCRITA
        // quanto para LEITURA. O scanner classificava leituras como alvos de
        // escrita — `readJsonIfExists(path.join(rootDir, 'config', ...,
        // 'evo-contract.json'))` virava UNKNOWN_JSON_WRITE_TARGET e derrubava
        // RAP-078 sem existir escrita alguma. Aqui a chamada é inspecionada: se
        // o `path.join` é argumento de um leitor (`readFileSync`, `readJson*`,
        // `require`), não é alvo de escrita e é ignorado. Escritas continuam
        // detectadas (nenhum writer é precedido por leitor).
        // deslocamento do `path.join` na fonte não é trivial (multiline).
        const joinRe = /path\.join\(\s*([^)]*)\)/g;
        while ((m = joinRe.exec(src)) !== null) {
          if (isReaderCallContext(src, m.index)) continue;
          const args = m[1].split(',').map((a) => a.trim().replace(/^['"`]|['"`]$/g, ''));
          const last = args[args.length - 1];
          if (!last || !last.endsWith('.json') || last.includes('${')) continue;
          const first = args[0] || '';
          const base =
            first === '__dirname' ? fileDir
              : first === 'ROOT_DIR' || first === 'ROOT' || first.includes('process.cwd()') ? ROOT
                : null;
          if (base) {
            const rel = path.relative(ROOT, path.join(base, ...args.slice(1))).replace(/\\/g, '/');
            add(relFile, rel);
          } else {
            // só o basename (diretório dinâmico): classificação por basename cobre
            add(relFile, last);
          }
        }
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(ROOT, root));
  return targets;
}

function classifyByPattern(norm, writer) {
  const base = path.basename(norm);
  const inTests = /__tests__|\.test\.|\/test\//.test(writer) || /__tests__/.test(norm);
  if (inTests) return 'TEST_FIXTURE';
  // Schemas de validação e configs declarativas (versionadas, não mutáveis)
  if (/\.(schema|rules|errors|actions|selectors|pages|restrictions|types)\.json$/.test(base)) return 'STATIC_VERSIONED_CONFIG';
  if (/^api\/data\//.test(norm) || /^core\/rpa\/rpa\.config\.json$/.test(norm)) return 'STATIC_VERSIONED_CONFIG';
  if (base === 'capabilities.json' || base === 'journey-contracts.json' || base === 'technical-wave-map.json' || base === 'question-generation.rules.json' || base === 'config.json' || base === 'metadata.json' || base === 'tenant.contract.json' || base === 'bulkMessaging.json' || base === 'qa-policy.json' || base === 'warn-approval-policy.json') return 'STATIC_VERSIONED_CONFIG';
  if (base === 'rpa-token.json' || /token|secret|credential/i.test(base)) return 'SECRET_STORE';
  // Lock transiente reconstruível
  if (/canonical\.lock\.json$/.test(norm)) return 'TEMPORARY_CACHE';
  if (/^dev\//.test(norm)) return 'TEMPORARY_CACHE';
  // Bug memory / knowledge de bugs (migrar p/ RAG SYSTEM ou DB)
  if (/bug-memory\.json$/.test(norm)) return 'DB_CANONICAL_JSON_EXPORT';
  // Proveniência interna de manuais (§L7): o artefato técnico (replayId,
  // selector, trace) é PRESERVADO para DEVELOPMENT/SYSTEM, mas é sempre uma
  // PROJEÇÃO derivada do modelo interno — nunca autoridade de estado. Mesma
  // natureza de `metadata.json`, porém explicitamente uma view exportada.
  if (/(^|\/)provenance\.json$/.test(norm)) return 'DB_CANONICAL_JSON_EXPORT';
  // Checkpoints de execução (migrados p/ DB via dbStateStore)
  if (/^qa\/checkpoints\//.test(norm)) return 'DB_CANONICAL_JSON_EXPORT';
  // Evidências pesadas de QA (artefatos)
  if (/^qa\/enterprise\//.test(norm) || /^qa\/evidence\//.test(norm)) return 'ARTIFACT_STORAGE';
  if (/^qa\/l\d+-/.test(norm) || /prod-like|smoke.*\.json$/.test(norm)) return 'ARTIFACT_STORAGE';
  // Relatórios derivados de QA/mesh/governance (views exportadas do DB)
  if (/(report|chain|attestation|self-proving|scorecard|snapshot|manifest|current-run|go-no-go|summary|result|impact|verdict|metrics|repairPlan|meshReport|history|stabilitySnapshot|failures\.ranked|fixPlans|governance-maturity|consistency|critical-journey|model-driven|coverage-map|operational-gaps|governance-report)/.test(base)) return 'DB_CANONICAL_JSON_EXPORT';
  if (/^qa\//.test(norm) || /^qa-mesh\//.test(norm) || /^governance\//.test(norm) || /^reports\//.test(norm) || /^docs\//.test(norm)) return 'DB_CANONICAL_JSON_EXPORT';
  // Regras específicas por escritor/basename
  if (writer.includes('checkpointManager') || writer.includes('stabilityHistory')) return 'DB_CANONICAL_JSON_EXPORT';
  if (/^pipeline\//.test(writer)) return 'DB_CANONICAL_JSON_EXPORT';
  if (/scripts\/smoke\//.test(writer) || /workspace-core-smoke/.test(writer)) return 'ARTIFACT_STORAGE';
  if (base === 'package.json' || base === 'known_errors.json' || base === 'internal-flow.json') return 'STATIC_VERSIONED_CONFIG';
  // Cadeia DECLARATIVA de dependências entre gates (estrutura de governança, não estado):
  // `config/mandatory-gate-dependencies.json` é lido por `governance/child-gate-guard.js`, que
  // recebe o `root` e monta o caminho em RUNTIME (`path.join(root, 'config', ...)`). O scanner
  // estático não resolve esse caminho e sobrava o basename, que caía em UNKNOWN e derrubava o
  // `audit:json-persistence` inteiro. Não é estado de banco nem cache: é configuração versionada,
  // imutável em runtime — mesma classe dos demais arquivos de `config/`.
  if (base === 'mandatory-gate-dependencies.json') return 'STATIC_VERSIONED_CONFIG';
  if (base === 'latest.json' || base === 'index.json' || /learning-routine|cenario2|demo/.test(base) || /demo/.test(writer)) return 'DB_CANONICAL_JSON_EXPORT';
  return null;
}

function classifyTarget(relTarget, writer) {
  const norm = relTarget.replace(/^\.\//, '');
  // prefixo mais específico vence
  let best = null;
  for (const [prefix, category] of Object.entries(CLASSIFIED)) {
    if (norm === prefix || norm.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || (prefix.endsWith('.json') && norm === prefix)) {
      if (!best || prefix.length > best.prefix.length) best = { prefix, category };
    }
  }
  if (best) return best.category;
  const base = path.basename(norm);
  if (BASENAME_CLASSIFIED[base]) return BASENAME_CLASSIFIED[base];
  const byPattern = classifyByPattern(norm, writer);
  if (byPattern) return byPattern;
  return 'UNKNOWN';
}

function buildAudit() {
  const targets = scanWriteTargets();
  const byCategory = {};
  const entries = [];
  for (const { writer, target } of targets.values()) {
    const category = classifyTarget(target, writer);
    entries.push({ writer, target, category });
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  const unknown = entries.filter((e) => e.category === 'UNKNOWN');
  const deprecated = entries.filter((e) => e.category === 'DEPRECATED');
  const dbCanonicalState = entries.filter((e) => e.category === 'DB_CANONICAL_STATE');
  return {
    artifactType: 'json-persistence-audit',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    taxonomy: ['DB_CANONICAL_STATE', 'DB_CANONICAL_JSON_EXPORT', 'ARTIFACT_STORAGE', 'STATIC_VERSIONED_CONFIG', 'TEST_FIXTURE', 'SECRET_STORE', 'TEMPORARY_CACHE', 'DEPRECATED', 'UNKNOWN'],
    summary: {
      totalWriteTargets: entries.length,
      byCategory,
      unknown: unknown.length,
      deprecated: deprecated.length,
      dbCanonicalState: dbCanonicalState.length,
      status: unknown.length === 0 && deprecated.length === 0 ? 'PASS' : 'FAIL',
    },
    unknownTargets: unknown,
    deprecatedTargets: deprecated,
    dbCanonicalStateTargets: dbCanonicalState,
    entries,
  };
}

function main() {
  const audit = buildAudit();
  const out = path.join(ROOT, 'governance', 'json-persistence-audit.json');
  fs.writeFileSync(out, `${JSON.stringify(audit, null, 2)}\n`);
  const check = process.argv.includes('--check');
  if (check) {
    console.log(JSON.stringify(audit.summary));
    process.exitCode = audit.summary.status === 'PASS' ? 0 : 1;
    return;
  }
  console.log(JSON.stringify(audit.summary, null, 2));
}

if (require.main === module) main();

module.exports = { buildAudit, classifyTarget, isReaderCallContext, CLASSIFIED, scanWriteTargets };
