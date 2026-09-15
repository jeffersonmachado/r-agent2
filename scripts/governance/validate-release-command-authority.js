#!/usr/bin/env node
'use strict';

/**
 * validate-release-command-authority.js — gate da AUTORIDADE ÚNICA DE RELEASE.
 *
 * Decisão ratificada (AGENTS.md): `npm run release:seal` é a única autoridade
 * de release completo (selagem + publicação). `system:release` é etapa interna
 * de validação+empacotamento e `zip:release` é helper de pacote, ambos
 * invocados pelas fases do seal — nenhum dos dois é o caminho de release.
 *
 * Invariantes verificados EXECUTAVELMENTE sobre os arquivos reais:
 *  1. package.json mapeia release:seal → scripts/governance/seal-release.sh;
 *  2. seal-release.sh existe e orquestra as 5 fases canônicas
 *     (prepare → candidate → final → publish → consolidate);
 *  3. AGENTS.md nomeia release:seal como o ciclo completo de selagem;
 *  4. docs/official-path.md nomeia release:seal como autoridade de release;
 *  5. nenhum doc governado apresenta system:release/zip:release isoladamente
 *     como release completo: todo doc que cita esses comandos deve citar
 *     release:seal, e cada um dos 4 docs governados deve conter a frase de
 *     autoridade canônica (reverter a edição do doc => FAIL);
 *  6. docs que documentam encadeamento manual devem classificar
 *     system:release/zip:release como etapas internas (frase canônica).
 *
 * Saída: `reports/release-command-authority-report.json` (versionado).
 * Uso: node scripts/governance/validate-release-command-authority.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'release-command-authority-report.json');
const SEAL_SCRIPT_REL = 'scripts/governance/seal-release.sh';
const EXPECTED_SEAL_NPM = `bash ${SEAL_SCRIPT_REL}`;

const SEAL_PHASES = Object.freeze(['prepare', 'candidate', 'final', 'publish', 'consolidate']);

const AUTHORITY_PHRASE = 'A autoridade única de release completo (selagem + publicação) é `npm run release:seal`';
const CLASSIFICATION_PHRASE = '`system:release` e `zip:release` são etapas internas do pipeline de release (validação+empacotamento e helper de pacote), invocadas pelas fases do `release:seal`, e não a autoridade de release';

const GOVERNED_DOCS = Object.freeze([
  'docs/official-path.md',
  'docs/DOUTRINA_OPERACIONAL.md',
  'docs/OPERACIONAL_CHEATSHEET.md',
  'docs/RUNBOOK_SUITES_V1.md',
]);

const SCANNED_DOCS = Object.freeze([
  ...GOVERNED_DOCS,
  'docs/00_DOCUMENTACAO_INDEX.md',
  'docs/governance/00_DOCUMENTATION_INDEX.md',
]);

const MANUAL_CHAIN_DOCS = Object.freeze([
  'docs/official-path.md',
  'docs/DOUTRINA_OPERACIONAL.md',
  'docs/OPERACIONAL_CHEATSHEET.md',
]);

const VIOLATION_CODES = Object.freeze({
  SEAL_SCRIPT_MISSING: 'release_command_authority_seal_script_missing',
  SEAL_NPM_MAPPING_WRONG: 'release_command_authority_seal_npm_mapping_wrong',
  SEAL_PHASE_MISSING: 'release_command_authority_seal_phase_missing',
  AGENTS_MD_NOT_NAMING_SEAL: 'release_command_authority_agents_md_not_naming_seal',
  OFFICIAL_PATH_NOT_NAMING_SEAL: 'release_command_authority_official_path_not_naming_seal',
  DOC_WITHOUT_AUTHORITY_STATEMENT: 'release_command_authority_doc_without_authority_statement',
  INTERNAL_STAGE_PRESENTED_AS_RELEASE: 'release_command_authority_internal_stage_presented_as_release',
  MANUAL_CHAIN_NOT_CLASSIFIED: 'release_command_authority_manual_chain_not_classified',
});

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function violation(code, detail = {}) {
  return { code, ...detail };
}

function check(id, description, fn, checks, violations) {
  try {
    const detail = fn();
    checks.push({ id, description, status: 'PASS', ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({ id, description, status: 'FAIL', reason: error.message });
    violations.push(...(error.violations || [violation(error.code || 'release_command_authority_check_failed', { check: id, reason: error.message })]));
  }
}

function expect(condition, code, message, violations) {
  if (!condition) {
    const error = new Error(message);
    error.violations = violations || [violation(code, { reason: message })];
    throw error;
  }
}

/**
 * Núcleo puro do gate: recebe o conteúdo dos arquivos e devolve
 * checks/violations. `run()` apenas lê os arquivos reais e delega aqui, o que
 * permite teste adversarial com conteúdo regredido (sem tocar o disco).
 */
function evaluate(sources) {
  const checks = [];
  const violations = [];
  const { packageJson, sealScript, agentsMd, docs } = sources;

  // ── 1. package.json: release:seal → seal-release.sh ─────────────────────
  check('package_json_seal_script', 'package.json mapeia release:seal para scripts/governance/seal-release.sh', () => {
    const scripts = (packageJson && packageJson.scripts) || {};
    expect(
      scripts['release:seal'] === EXPECTED_SEAL_NPM,
      VIOLATION_CODES.SEAL_NPM_MAPPING_WRONG,
      `scripts["release:seal"]="${scripts['release:seal']}" (esperado "${EXPECTED_SEAL_NPM}")`,
    );
    return { mapping: scripts['release:seal'] };
  }, checks, violations);

  // ── 2. seal-release.sh existe e orquestra as 5 fases ────────────────────
  check('seal_script_phases', 'seal-release.sh existe e orquestra prepare/candidate/final/publish/consolidate', () => {
    expect(typeof sealScript === 'string', VIOLATION_CODES.SEAL_SCRIPT_MISSING, `${SEAL_SCRIPT_REL} ausente ou ilegível`);
    const bad = [];
    for (const phase of SEAL_PHASES) {
      const inPhasesArray = new RegExp(`PHASES=\\([^)]*\\b${phase}\\b`).test(sealScript);
      const hasPhaseFn = new RegExp(`phase_${phase}\\s*\\(`).test(sealScript);
      if (!inPhasesArray || !hasPhaseFn) {
        bad.push(violation(VIOLATION_CODES.SEAL_PHASE_MISSING, { phase, inPhasesArray, hasPhaseFn }));
      }
    }
    expect(bad.length === 0, VIOLATION_CODES.SEAL_PHASE_MISSING, 'fases canônicas ausentes no orquestrador', bad);
    return { phases: SEAL_PHASES };
  }, checks, violations);

  // ── 3. AGENTS.md nomeia release:seal como ciclo completo ────────────────
  check('agents_md_names_seal', 'AGENTS.md nomeia release:seal como o ciclo completo de selagem + publicação', () => {
    expect(typeof agentsMd === 'string' && agentsMd.includes('release:seal') && /selagem \+ publicação/.test(agentsMd),
      VIOLATION_CODES.AGENTS_MD_NOT_NAMING_SEAL,
      'AGENTS.md não nomeia release:seal como ciclo completo de selagem + publicação');
  }, checks, violations);

  // ── 4. docs/official-path.md nomeia release:seal como autoridade ────────
  check('official_path_authority', 'docs/official-path.md declara release:seal como autoridade de release', () => {
    const content = docs['docs/official-path.md'];
    expect(typeof content === 'string' && content.includes(AUTHORITY_PHRASE),
      VIOLATION_CODES.OFFICIAL_PATH_NOT_NAMING_SEAL,
      'docs/official-path.md sem a declaração canônica de autoridade de release');
  }, checks, violations);

  // ── 5. Nenhum doc apresenta etapa interna como release completo ─────────
  check('docs_no_internal_stage_as_release', 'docs governados declaram a autoridade; quem cita system:release/zip:release cita release:seal', () => {
    const bad = [];
    for (const doc of GOVERNED_DOCS) {
      const content = docs[doc];
      if (typeof content !== 'string' || !content.includes(AUTHORITY_PHRASE)) {
        bad.push(violation(VIOLATION_CODES.DOC_WITHOUT_AUTHORITY_STATEMENT, { doc, reason: 'authority_statement_missing' }));
      }
    }
    for (const doc of SCANNED_DOCS) {
      const content = docs[doc];
      if (typeof content !== 'string') {
        bad.push(violation(VIOLATION_CODES.DOC_WITHOUT_AUTHORITY_STATEMENT, { doc, reason: 'unreadable' }));
        continue;
      }
      const mentionsInternalStage = /system:release|zip:release/.test(content);
      const mentionsSeal = /release:seal/.test(content);
      if (mentionsInternalStage && !mentionsSeal) {
        bad.push(violation(VIOLATION_CODES.INTERNAL_STAGE_PRESENTED_AS_RELEASE, { doc, reason: 'mentions_internal_stage_without_release_seal' }));
      }
    }
    expect(bad.length === 0, VIOLATION_CODES.DOC_WITHOUT_AUTHORITY_STATEMENT, 'documentação de release fora da autoridade única', bad);
    return { scanned: SCANNED_DOCS.length };
  }, checks, violations);

  // ── 6. Encadeamento manual classificado como etapas internas ────────────
  check('manual_chain_classified', 'docs com encadeamento manual classificam system:release/zip:release como etapas internas', () => {
    const bad = [];
    for (const doc of MANUAL_CHAIN_DOCS) {
      const content = docs[doc];
      if (typeof content !== 'string' || !content.includes(CLASSIFICATION_PHRASE)) {
        bad.push(violation(VIOLATION_CODES.MANUAL_CHAIN_NOT_CLASSIFIED, { doc }));
      }
    }
    expect(bad.length === 0, VIOLATION_CODES.MANUAL_CHAIN_NOT_CLASSIFIED, 'encadeamento manual sem classificação de etapa interna', bad);
    return { docs: MANUAL_CHAIN_DOCS };
  }, checks, violations);

  return { checks, violations };
}

function readSources(rootDir = ROOT_DIR) {
  const read = (rel) => {
    const abs = path.join(rootDir, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  let packageJson = null;
  const packageRaw = read('package.json');
  if (packageRaw) {
    try {
      packageJson = JSON.parse(packageRaw);
    } catch {
      packageJson = null;
    }
  }
  const docs = {};
  for (const doc of SCANNED_DOCS) docs[doc] = read(doc);
  return {
    packageJson,
    sealScript: read(SEAL_SCRIPT_REL),
    agentsMd: read('AGENTS.md'),
    docs,
  };
}

function run(rootDir = ROOT_DIR) {
  return evaluate(readSources(rootDir));
}

function main() {
  const { checks, violations } = run();
  const report = {
    reportType: 'release-command-authority',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    checksExecuted: checks.length,
    checksPassed: checks.filter((c) => c.status === 'PASS').length,
    checks,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[release-command-authority] status=${report.status} checks=${report.checksPassed}/${report.checksExecuted} violações=${violations.length}\n`,
    );
    for (const c of checks) process.stdout.write(`  - ${c.id}: ${c.status}${c.reason ? ` (${c.reason})` : ''}\n`);
    for (const v of violations) process.stdout.write(`  ! ${v.code}: ${JSON.stringify(v)}\n`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[release-command-authority] falha fatal: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  evaluate,
  readSources,
  run,
  main,
  VIOLATION_CODES,
  AUTHORITY_PHRASE,
  CLASSIFICATION_PHRASE,
  GOVERNED_DOCS,
  SCANNED_DOCS,
  MANUAL_CHAIN_DOCS,
  REPORT_PATH,
};
