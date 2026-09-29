#!/usr/bin/env node
'use strict';

/**
 * validate-bug-autonomous-loop.js — GATE DO CICLO AUTÔNOMO DE BUG (`BUG_AUTONOMOUS_LOOP`).
 *
 * Este gate NÃO declara verde: ele COMPÕE provas que existem e diz o estado real. Não roda testes,
 * não gera evidência de runtime e não escreve nenhum arquivo que sirva de entrada para si mesmo —
 * a única coisa que ele produz é o próprio relatório de veredito.
 *
 * O que ele mede:
 *   1. cada um dos 20 testes obrigatórios (BUG-01..BUG-20) existe no disco, contém a prova do ID e
 *      está dentro do manifesto autoritativo (um teste silenciosamente excluído não governa nada);
 *   2. nenhuma prova foi enfraquecida: `.skip`/`.only`/`xit`/`xdescribe` nos arquivos das suítes
 *      obrigatórias é violação — "regression test removido" e "mandatory test skipped" são
 *      exatamente os atalhos que a missão proíbe;
 *   3. o estado de cada suíte é o REAL da execução autoritativa
 *      (`reports/release-suite-execution.json`), nunca presumido. Ausente ⇒ PENDING, nunca PASS;
 *   4. as provas de RUNTIME específicas do ciclo (missão → bug → reprodução → task → fix →
 *      regressão → missão) precisam ter rodado e passado;
 *   5. o motor de regras é ÚNICO: as transições/regras vêm de `engine/engineeringMission/bugFinding`
 *      (a mesma implementação usada em runtime), e o gate não as reimplementa nem as afrouxa.
 *
 * Saída: `reports/bug-autonomous-loop-report.json`
 * Uso: node scripts/governance/validate-bug-autonomous-loop.js [--json]
 */

const fs = require('fs');
const path = require('path');

// AUTORIDADE ÚNICA DAS REGRAS: o gate consome o MESMO motor puro que o runtime usa. Sem isso, o
// ciclo teria duas opiniões — a que corrige e a que julga.
const engine = require('../../engine/engineeringMission/bugFinding');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'engineering-bug-loop-required-tests.json');
const SUITE_REPORT_PATH = path.join(ROOT, 'reports', 'release-suite-execution.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'bug-autonomous-loop-report.json');
const ENGINE_DIR = path.join(ROOT, 'engine', 'engineeringMission', 'bugFinding');
const GATE_SELF = path.join(__dirname, 'validate-bug-autonomous-loop.js');

/** Atalhos de enfraquecimento: qualquer um deles invalida a prova do ID. */
const WEAKENING_PATTERNS = Object.freeze([
  { pattern: /(?:^|\s)(?:it|test|describe)\.skip\s*\(/m, code: 'SKIPPED_TEST' },
  { pattern: /(?:^|\s)(?:it|test|describe)\.only\s*\(/m, code: 'ONLY_TEST' },
  { pattern: /(?:^|\s)(?:xit|xdescribe)\s*\(/m, code: 'XIT_TEST' },
]);

function readJsonAbs(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readTextAbs(absPath) {
  try {
    return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
  } catch (_) {
    return null;
  }
}

/** Estado REAL de cada suíte na execução autoritativa. */
function suiteStateReader() {
  const execution = readJsonAbs(SUITE_REPORT_PATH);
  const bySuite = new Map();
  for (const row of (execution && execution.results) || []) {
    if (row && row.suite) bySuite.set(row.suite, row);
  }
  return {
    get: (suite) => (bySuite.has(suite) ? bySuite.get(suite) : null),
    generatedAt: (execution && execution.generatedAt) || null,
    status: (execution && execution.status) || null,
    suitesExecuted: bySuite.size,
  };
}

/**
 * O motor de regras é ÚNICO? Verificações estruturais contra o arquivo do PRÓPRIO gate e contra o
 * diretório do motor — é o "o detector não pode ser autoridade única sobre si mesmo".
 */
function structuralChecks(config) {
  const checks = [];

  // 1. Motor presente e completo (as regras que o runtime usa).
  const engineFiles = ['constants.js', 'fingerprint.js', 'classification.js', 'lifecycle.js', 'reproductionPlan.js', 'selfModification.js', 'anomalyDetection.js', 'routing.js', 'index.js'];
  const missing = engineFiles.filter((file) => !fs.existsSync(path.join(ENGINE_DIR, file)));
  checks.push({
    id: 'BUG_LOOP_ENGINE_SINGLE_AUTHORITY',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: missing.length === 0
      ? `motor de regras completo em engine/engineeringMission/bugFinding (${engineFiles.length} módulos)`
      : `módulos ausentes no motor: ${missing.join(', ')}`,
  });

  // 2. O gate não escreve a própria evidência de runtime (nada de auto-certificação): ele só lê.
  const gateSource = readTextAbs(GATE_SELF) || '';
  const writesEvidence = /writeFileSync\([^)]*bug-autonomous-loop-evidence/i.test(gateSource);
  checks.push({
    id: 'BUG_LOOP_NO_SELF_CERTIFICATION',
    status: writesEvidence ? 'FAIL' : 'PASS',
    detail: writesEvidence
      ? 'o gate escreve a própria evidência de runtime — evidência precisa vir de execução real, nunca do validador'
      : 'o gate apenas LÊ evidência de runtime; não produz a prova que julga',
  });

  // 3. O gate consome o motor (não reimplementa tabela de transições).
  const reimplements = /FINDING_TRANSITIONS\s*[:=]\s*\{|const\s+TRANSITIONS\s*=\s*\{/.test(gateSource);
  const usesEngine = /require\(['"][^'"]*bugFinding['"]\)/.test(gateSource);
  checks.push({
    id: 'BUG_LOOP_ENGINE_REUSED_BY_GATE',
    status: reimplements ? 'FAIL' : (usesEngine ? 'PASS' : 'FAIL'),
    detail: reimplements
      ? 'o gate reimplementa a tabela de transições — duas autoridades sobre o mesmo ciclo'
      : (usesEngine ? 'gate usa o MESMO motor de regras do runtime' : 'gate não referencia o motor de regras'),
  });

  // 4. Conjunto de veredito fechado e completo.
  const expectedVerdicts = [
    'BUG_DETECTION', 'BUG_TRIAGE', 'BUG_REPRODUCTION', 'BUG_CONFIRMATION', 'BUG_TASK_GENERATION',
    'AUTONOMOUS_FIX_LOOP', 'REGRESSION_VALIDATION', 'MISSION_CONTINUATION', 'SELF_MODIFICATION_GUARD',
    'BUG_AUTONOMOUS_LOOP',
  ];
  const declared = Object.keys(config.verdicts || {});
  const missingVerdicts = expectedVerdicts.filter((v) => !declared.includes(v));
  const idsDeclared = Object.values(config.verdicts || {}).flat();
  const idsRequired = (config.requiredTests || []).map((t) => t.id);
  const unknownIds = idsDeclared.filter((id) => !idsRequired.includes(id));
  checks.push({
    id: 'BUG_LOOP_VERDICTS_COMPLETE',
    status: missingVerdicts.length === 0 && unknownIds.length === 0 ? 'PASS' : 'FAIL',
    detail: missingVerdicts.length === 0 && unknownIds.length === 0
      ? `${expectedVerdicts.length} vereditos declarados, todos apoiados em IDs existentes`
      : `vereditos ausentes: ${missingVerdicts.join(', ') || 'nenhum'}; IDs desconhecidos: ${unknownIds.join(', ') || 'nenhum'}`,
  });

  // 5. Cobertura: todo ID obrigatório tem ao menos uma suíte declarada.
  const withoutSuite = (config.requiredTests || []).filter((t) => !Array.isArray(t.suites) || t.suites.length === 0).map((t) => t.id);
  checks.push({
    id: 'BUG_LOOP_EVERY_ID_HAS_SUITE',
    status: withoutSuite.length === 0 ? 'PASS' : 'FAIL',
    detail: withoutSuite.length === 0 ? 'todos os 20 IDs apontam para ao menos uma suíte' : `IDs sem suíte: ${withoutSuite.join(', ')}`,
  });

  // 6. VOCABULÁRIO do ciclo: derivado do MOTOR (autoridade única), não de uma cópia no gate.
  //
  // A prova de que uma recusa de honestidade é reconhecível exige que as bases de confirmação
  // objetivas e as não-objetivas venham do mesmo módulo que o serviço usa em runtime. Se o gate
  // tivesse a própria lista, uma base "conveniente" poderia ser aceita aqui e recusada lá (ou o
  // inverso) — duas autoridades sobre a mesma regra.
  const suspicionOnly = (engine.NON_CONFIRMATION_BASES || []).includes('LLM_SUSPICION');
  const recurrenceSource = (engine.RECURRENCE_SOURCE_STATUSES || []).includes('FIXED');
  const lifecycleOk = ['SUSPECTED', 'REPRODUCING', 'CONFIRMED', 'NOT_REPRODUCED', 'DUPLICATE', 'FIXING', 'FIXED', 'REGRESSION_VALIDATED', 'CLOSED'].every((s) => engine.FINDING_STATUSES.includes(s));
  checks.push({
    id: 'BUG_LOOP_LIFECYCLE_VOCABULARY_FROM_ENGINE',
    status: suspicionOnly && recurrenceSource && lifecycleOk ? 'PASS' : 'FAIL',
    detail: suspicionOnly && recurrenceSource && lifecycleOk
      ? `vocabulário derivado do motor: ${engine.FINDING_STATUSES.length} estados, ${engine.CONFIRMATION_BASES.length} bases objetivas, LLM nunca confirmando`
      : `vocabulário divergente do motor (lifecycleOk=${lifecycleOk}, llmNaoConfirma=${suspicionOnly}, reincidencia=${recurrenceSource})`,
  });

  return checks;
}

/**
 * Prova de um ID: arquivo existe, contém o ID, não foi enfraquecido, está no manifesto autoritativo
 * e a suíte passou na execução real.
 */
function assessItem(item, { suiteReader, authoritative }) {
  const problems = [];
  const proofs = [];

  for (const suite of item.suites || []) {
    const abs = path.join(ROOT, suite);
    const source = readTextAbs(abs);
    if (source === null) {
      problems.push(`${suite}: ARQUIVO_AUSENTE`);
      continue;
    }
    if (!source.includes(item.id)) {
      problems.push(`${suite}: PROVA_DO_ID_AUSENTE (${item.id})`);
      continue;
    }
    const weakened = WEAKENING_PATTERNS.filter((w) => w.pattern.test(source)).map((w) => w.code);
    if (weakened.length > 0) {
      problems.push(`${suite}: PROVA_ENFRAQUECIDA (${weakened.join(', ')})`);
      continue;
    }
    if (Array.isArray(authoritative) && !authoritative.includes(suite)) {
      problems.push(`${suite}: FORA_DO_MANIFESTO_AUTORITATIVO`);
      continue;
    }
    const state = suiteReader.get(suite);
    if (!state) {
      problems.push(`${suite}: NAO_EXECUTADA (PENDING)`);
      continue;
    }
    if (state.state !== 'PASS') {
      problems.push(`${suite}: ${state.state}`);
      continue;
    }
    proofs.push({ suite, state: state.state, testsExecuted: state.testsExecuted });
  }

  return { id: item.id, requirement: item.requirement, proofs, problems, status: problems.length === 0 ? 'PASS' : 'FAIL' };
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[bug-loop] configuração ausente: ${path.relative(ROOT, CONFIG_PATH)}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const suiteReader = suiteStateReader();

  const { resolveManifest } = require('./lib/releaseSuiteManifest');
  const manifest = resolveManifest();
  const authoritative = manifest.ok ? manifest.authoritative : null;

  const structural = structuralChecks(config);
  const items = (config.requiredTests || []).map((item) => assessItem(item, { suiteReader, authoritative }));
  const failedItems = items.filter((i) => i.status !== 'PASS');

  // Provas de RUNTIME específicas do ciclo (o E2E que exercita Router real + sandbox real).
  const runtimeProofs = (config.runtimeProofs || []).map((suite) => {
    const state = suiteReader.get(suite);
    return {
      suite,
      state: state ? state.state : null,
      testsExecuted: state ? state.testsExecuted : 0,
      status: state && state.state === 'PASS' ? 'PASS' : 'FAIL',
    };
  });
  const runtimeOk = runtimeProofs.length > 0 && runtimeProofs.every((p) => p.status === 'PASS');

  const verdicts = {};
  for (const [verdict, ids] of Object.entries(config.verdicts || {})) {
    const relevant = items.filter((i) => ids.includes(i.id));
    const allPass = relevant.length === ids.length && relevant.every((i) => i.status === 'PASS');
    const needsRuntime = (config.verdictsRequiringRuntimeProof || []).includes(verdict);
    verdicts[verdict] = allPass && (!needsRuntime || runtimeOk) ? 'GREEN' : 'NO_GO';
  }

  const structuralFailures = structural.filter((c) => c.status !== 'PASS');
  const status = structuralFailures.length === 0 && failedItems.length === 0 && runtimeOk && verdicts.BUG_AUTONOMOUS_LOOP === 'GREEN'
    ? 'GREEN'
    : 'NO_GO';

  const report = {
    report: 'BUG_AUTONOMOUS_LOOP',
    generatedAt: new Date().toISOString(),
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1',
    config: path.relative(ROOT, CONFIG_PATH),
    engineAuthority: path.relative(ROOT, ENGINE_DIR),
    suiteExecution: {
      report: path.relative(ROOT, SUITE_REPORT_PATH),
      status: suiteReader.status,
      generatedAt: suiteReader.generatedAt,
      suitesExecuted: suiteReader.suitesExecuted,
    },
    structuralChecks: structural,
    items,
    itemFailures: failedItems.map((i) => ({ id: i.id, problems: i.problems })),
    runtimeProofs,
    verdicts,
    BUG_AUTONOMOUS_LOOP: verdicts.BUG_AUTONOMOUS_LOOP,
    status,
    note: 'Este gate COMPÕE provas reais (execução autoritativa + estrutura). Ele não roda testes, não gera evidência de runtime e nunca declara GREEN sem prova executada.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const check of structural) process.stdout.write(`  [${check.status}] ${check.id} — ${check.detail}\n`);
    for (const item of items) {
      process.stdout.write(`  [${item.status}] ${item.id} — ${item.requirement}${item.problems.length ? ` :: ${item.problems.join(' | ')}` : ''}\n`);
    }
    for (const proof of runtimeProofs) process.stdout.write(`  [${proof.status}] RUNTIME ${proof.suite} — state=${proof.state}\n`);
    for (const [verdict, value] of Object.entries(verdicts)) process.stdout.write(`  ${verdict} = ${value}\n`);
    process.stdout.write(`[bug-loop] status=${status} itens=${items.length} falhas=${failedItems.length} runtime=${runtimeOk ? 'PROVEN' : 'NOT_PROVEN'}\n`);
  }
  process.exit(status === 'GREEN' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { WEAKENING_PATTERNS, structuralChecks, assessItem };
