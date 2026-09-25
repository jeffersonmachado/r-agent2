'use strict';

/**
 * scripts/governance/lib/releaseSuiteManifest.js — MANIFESTO CANÔNICO de suítes autoritativas.
 *
 * ACHADO REAL (2026-09-25): a lista de suítes autoritativas era escrita À MÃO dentro do validador
 * anti-greenwashing. Consequências medidas:
 *
 *   1. a lista DIVERGIA do que a execução canônica realmente roda (`test:release-authoritative`
 *      usava globs, o validador usava uma lista de 17 itens) — ou seja, o gate verificava um
 *      conjunto e a execução rodava outro;
 *   2. toda suíte nova precisava ser adicionada manualmente em dois lugares. Durante esta própria
 *      sessão isso aconteceu DUAS vezes (uma suíte nova ficou fora do manifesto e o gate
 *      continuou PASS com a cobertura incompleta) — exatamente o "verde falso" que o gate existe
 *      para impedir.
 *
 * Correção: o manifesto é DERIVADO da descoberta (`discovery.globs` + `discovery.explicit`), com
 * `exclusions` justificadas como única forma legítima de manter algo fora. Um arquivo de teste que
 * casa com a descoberta e não está no manifesto (nem em exclusão) é VIOLAÇÃO — nunca um silêncio.
 *
 * Módulo de governança: lê o disco (é o trabalho dele), mas é PURO quanto a efeitos — não escreve.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'canonical-release-suites.json');

const MANIFEST_VIOLATION_CODES = Object.freeze({
  SUITE_NOT_IN_MANIFEST: 'SUITE_NOT_IN_MANIFEST',
  MANIFEST_SUITE_MISSING: 'MANIFEST_SUITE_MISSING',
  MANIFEST_EMPTY: 'MANIFEST_EMPTY',
  MANIFEST_INVALID: 'MANIFEST_INVALID',
});

/** Converte um glob simples (`*`) em regex — sem dependência externa. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function readConfig(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    return { config: null, error: `manifesto canônico não encontrado em ${configPath}` };
  }
  try {
    return { config: JSON.parse(fs.readFileSync(configPath, 'utf8')), error: null };
  } catch (err) {
    return { config: null, error: `manifesto canônico inválido: ${err.message}` };
  }
}

/** Todos os arquivos de teste do repositório que casam com algum glob (ordem alfabética estável). */
function listTestFiles(globs) {
  const regexps = globs.map(globToRegExp);
  const found = new Set();
  for (const dir of ['tests/unit', 'tests/integration']) {
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const name of fs.readdirSync(absolute)) {
      if (!name.endsWith('.test.js')) continue;
      const relative = `${dir}/${name}`;
      if (regexps.some((re) => re.test(relative))) found.add(relative);
    }
  }
  return [...found].sort();
}

/**
 * Resolve o manifesto.
 *
 * @returns {{
 *   manifestVersion:string, authoritative:string[], discovered:string[],
 *   excluded:{path:string, reason:string, glob:string}[], violations:Array, ok:boolean
 * }}
 */
function resolveManifest({ configPath = CONFIG_PATH } = {}) {
  const { config, error } = readConfig(configPath);
  if (error) {
    return { manifestVersion: null, authoritative: [], discovered: [], excluded: [], violations: [{ code: MANIFEST_VIOLATION_CODES.MANIFEST_INVALID, detail: error }], ok: false };
  }

  const discoveryGlobs = config.discovery?.globs || [];
  const explicit = config.discovery?.explicit || [];
  const exclusionRules = config.exclusions || [];

  const discovered = listTestFiles(discoveryGlobs);
  const excluded = [];
  const authoritative = [];
  const firedRules = new Set();

  // Exclusões declaradas: aplicadas SOMENTE à DESCOBERTA.
  // DEFEITO REAL medido em 2026-09-25: a exclusão por glob `tests/unit/engineeringRouter*.test.js`
  // engolia também o item declarado em `explicit` (o teste do provider Qwen), removendo-o do
  // manifesto em silêncio — e o eixo QWEN_PROVIDER_STRUCTURAL ficou NO_GO por "suíte não
  // executada". Declarar explicitamente é uma decisão mais forte que um padrão de exclusão:
  // `explicit` tem PRECEDÊNCIA.
  for (const candidate of discovered.sort()) {
    const rule = exclusionRules.find((r) => (r.glob ? globToRegExp(r.glob).test(candidate) : r.path === candidate));
    if (rule) {
      if (!rule.reason || String(rule.reason).trim().length < 20) {
        return {
          manifestVersion: config.manifestVersion || null,
          authoritative: [], discovered, excluded: [], ok: false,
          violations: [{ code: MANIFEST_VIOLATION_CODES.MANIFEST_INVALID, detail: `exclusão sem motivo suficiente: ${candidate}` }],
        };
      }
      firedRules.add(rule.glob || rule.path);
      excluded.push({ path: candidate, reason: rule.reason, glob: rule.glob || null });
      continue;
    }
    authoritative.push(candidate);
  }
  for (const candidate of [...explicit].sort()) {
    if (!authoritative.includes(candidate) && !excluded.some((e) => e.path === candidate)) {
      authoritative.push(candidate);
    }
  }

  const violations = [];

  // Suíte declarada que não existe no disco.
  for (const suite of authoritative) {
    if (!fs.existsSync(path.join(ROOT, suite))) {
      violations.push({ code: MANIFEST_VIOLATION_CODES.MANIFEST_SUITE_MISSING, suite, detail: 'suíte declarada no manifesto não existe' });
    }
  }

  if (authoritative.length === 0) {
    violations.push({ code: MANIFEST_VIOLATION_CODES.MANIFEST_EMPTY, detail: 'manifesto resolveu para ZERO suítes — gate vacuoso' });
  }

  // DIVERGÊNCIA: arquivo que casa com a descoberta e não está no manifesto nem excluído.
  // É o erro que este módulo existe para impedir (suíte nova fora do gate = verde falso).
  for (const suite of discovered) {
    const inManifest = authoritative.includes(suite);
    const isExcluded = excluded.some((e) => e.path === suite);
    if (!inManifest && !isExcluded) {
      violations.push({ code: MANIFEST_VIOLATION_CODES.SUITE_NOT_IN_MANIFEST, suite, detail: 'suíte existe e casa com a descoberta mas não está no manifesto nem em exclusão justificada' });
    }
  }

  // Exclusão que não casa com NENHUM candidato é decorativa: pode ser uma decisão de escopo
  // legítima a documentar (é o caso do Router unit, fora do escopo autoritativo), mas precisa
  // aparecer — porque uma exclusão que casa com itens declarados foi exatamente a origem do
  // defeito corrigido em 2026-09-25 (o teste do Qwen removido em silêncio). Reportada, não
  // violação: o escopo é uma decisão de governança, não um erro.
  const unusedExclusions = exclusionRules
    .filter((r) => !firedRules.has(r.glob || r.path))
    .map((r) => ({ glob: r.glob || null, path: r.path || null, reason: r.reason }));

  return {
    manifestVersion: config.manifestVersion || null,
    authoritative: [...new Set(authoritative)].sort(),
    discovered,
    excluded,
    unusedExclusions,
    explicit,
    execution: config.execution || {},
    violations,
    ok: violations.length === 0,
  };
}

/**
 * Avalia um relatório de execução contra o manifesto.
 *
 * @param {Object} manifest  saída de `resolveManifest`
 * @param {Object} execution `{ suites: { '<path>': { state, testsExecuted, reason } } }`
 */
function evaluateExecution(manifest, execution = {}) {
  const perSuite = execution.suites || {};
  const results = [];
  const violations = [];

  for (const suite of manifest.authoritative) {
    const entry = perSuite[suite];
    if (!entry) {
      results.push({ suite, state: 'NOT_EXECUTED', testsExecuted: 0, reason: 'suíte do manifesto não aparece no relatório de execução' });
      violations.push({ code: 'MANIFEST_SUITE_NOT_EXECUTED', suite, detail: 'suíte autoritativa não foi executada' });
      continue;
    }
    const testsExecuted = Number(entry.testsExecuted ?? entry.numTotalTests ?? 0);
    let state = entry.state || 'NOT_EXECUTED';
    if (testsExecuted === 0 && manifest.execution?.zeroTestsIsViolation !== false && state === 'PASS') {
      // Suíte que "passa" executando zero testes é o verde mais falso possível.
      state = 'FAIL';
      violations.push({ code: 'MANIFEST_SUITE_ZERO_TESTS', suite, detail: 'suíte marcada PASS executando 0 testes' });
    }
    if (state !== 'PASS') {
      violations.push({ code: `MANIFEST_SUITE_NOT_PASS:${state}`, suite, detail: entry.reason || null });
    }
    results.push({ suite, state, testsExecuted, reason: entry.reason || null });
  }

  const covered = results.filter((r) => r.state === 'PASS').length;
  const total = manifest.authoritative.length;
  return {
    results,
    violations,
    covered,
    total,
    coverageRatio: total === 0 ? 0 : Number((covered / total).toFixed(4)),
    states: {
      PASS: 'suíte executou e passou',
      FAIL: 'suíte falhou (ou passou com 0 testes)',
      BLOCKED: 'impedimento externo explícito',
      INFRA_ERROR: 'infraestrutura obrigatória ausente',
      NOT_EXECUTED: 'não rodou — nunca conta como cobertura',
      NOT_APPLICABLE: 'regra não se aplica',
    },
  };
}

module.exports = {
  ROOT,
  CONFIG_PATH,
  MANIFEST_VIOLATION_CODES,
  globToRegExp,
  listTestFiles,
  resolveManifest,
  evaluateExecution,
};
