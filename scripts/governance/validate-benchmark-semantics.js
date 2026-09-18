#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-semantics.js — gate de QUALIDADE SEMÂNTICA do benchmark.
 *
 * Responde, com o funil semântico REAL do produto, três perguntas que já foram
 * respondidas errado em material persistido:
 *
 *  1. BENCHMARK_CONTEXTUAL_VERB_NORMALIZATION — um verbo ambíguo está sendo
 *     resolvido por PALAVRA isolada?
 *
 *     Defeito medido (2026-09-18): `VERB_CANONICAL_MAP` mapeava `check: 'checkin'`.
 *     "We check our recurring payments constantly" virava `payment.checkin` —
 *     uma entrada de academia atribuída a verificação de cobrança. `check` só é
 *     check-in em CONSTRUÇÃO de entrada (composto `check-in`, `check <pessoa> in`,
 *     `check in at <local>`); sobre um objeto de negócio é verificação.
 *
 *  2. BENCHMARK_NO_MARKETING_AS_CAPABILITY — texto promocional está virando
 *     capability?
 *
 *     Defeito medido: "Uma ferramenta completa para simplificar todo o processo
 *     de venda" produzia a capability `sell`. Promessa não é recurso.
 *
 *  3. BENCHMARK_ZERO_FINDINGS_ANALYZED — zero achados continua sendo tratado
 *     como ausência de trabalho?
 *
 *     "Pesquisei e nada era novo" é MEDIÇÃO. O critério de ANALYZED não pode
 *     exigir >= 1 achado como condição absoluta.
 *
 * Saída: `reports/benchmark-semantics-report.json` (versionado).
 *
 * Uso: node scripts/governance/validate-benchmark-semantics.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-semantics-report.json');

const {
  classifyObservation,
  OBSERVATION_TYPES,
} = require('../../api/services/benchmark/semantic/observationClassifier');
const {
  extractCandidate,
  VERB_CANONICAL_MAP,
  resolveContextualVerb,
} = require('../../api/services/benchmark/semantic/semanticExtractor');
const { evaluateAnalyzedCriterion, AXIS_STATES, RESEARCH_AXES } = require('../../api/services/benchmark/benchmarkResearchSemantics');
const { tokenize } = require('../../api/services/benchmark/benchmarkResearchSemantics');

const SIGNAL_TYPES = new Set([
  OBSERVATION_TYPES.CAPABILITY_SIGNAL,
  OBSERVATION_TYPES.JOURNEY_SIGNAL,
  OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL,
]);

/** Frases cuja semântica NÃO pode ser confundida (todas do corpus dourado). */
const CONTEXT_CASES = [
  { text: 'We check our recurring payments constantly', forbiddenForm: 'payment.checkin' },
  { text: 'payment status check', forbiddenForm: 'payment.checkin' },
  { text: 'Check members in at the front desk.', expectedForm: 'member.checkin' },
  { text: 'Check in at the front desk', expectedForm: 'checkin' },
];

const MARKETING_CASES = [
  'Uma ferramenta completa para simplificar todo o processo de venda',
  'Grow your business faster.',
  'All-in-one platform to manage your entire studio',
  'Tudo em um só lugar para a sua academia',
  'Get started free',
];

function analyze(text) {
  const classified = classifyObservation({ text, locator: 'section/feature' });
  if (!SIGNAL_TYPES.has(classified.type)) return { type: classified.type, form: null };
  const kind = classified.type === OBSERVATION_TYPES.CAPABILITY_SIGNAL
    ? 'capability'
    : (classified.type === OBSERVATION_TYPES.JOURNEY_SIGNAL ? 'journey' : 'businessRule');
  const candidate = extractCandidate({ observation: { text, locator: 'section/feature' }, classified, kind });
  return { type: classified.type, form: candidate.form || null };
}

function checkContextualVerb() {
  const violations = [];

  // A raiz do defeito: mapeamento de PALAVRA isolada.
  if (VERB_CANONICAL_MAP.check) {
    violations.push({
      code: 'AMBIGUOUS_VERB_MAPPED_AS_ISOLATED_WORD',
      detail: `VERB_CANONICAL_MAP mapeia 'check' para '${VERB_CANONICAL_MAP.check}'. Verbos ambíguos exigem resolução CONTEXTUAL.`,
    });
  }

  for (const testCase of CONTEXT_CASES) {
    const tokens = tokenize(testCase.text);
    const resolved = resolveContextualVerb('check', tokens, testCase.text);
    const { form } = analyze(testCase.text);

    if (testCase.forbiddenForm && form === testCase.forbiddenForm) {
      violations.push({
        code: 'CONTEXTUAL_VERB_FALSE_POSITIVE',
        text: testCase.text,
        form,
        detail: `Resolveu para '${testCase.forbiddenForm}', que é semanticamente incorreto.`,
      });
    }
    if (testCase.forbiddenForm && String(form || '').includes('checkin')) {
      violations.push({
        code: 'CONTEXTUAL_VERB_CHECKIN_LEAK',
        text: testCase.text,
        form,
        detail: 'Texto de verificação não pode produzir forma de check-in.',
      });
    }
    if (testCase.expectedForm && form !== testCase.expectedForm) {
      violations.push({
        code: 'CONTEXTUAL_VERB_FALSE_NEGATIVE',
        text: testCase.text,
        form,
        expected: testCase.expectedForm,
        resolved,
      });
    }
  }

  return violations;
}

function checkMarketingFilter() {
  const violations = [];
  for (const text of MARKETING_CASES) {
    const { type } = analyze(text);
    if (SIGNAL_TYPES.has(type)) {
      violations.push({
        code: 'MARKETING_TEXT_CLASSIFIED_AS_SIGNAL',
        text,
        type,
        detail: 'Texto promocional não pode virar capability/jornada/regra.',
      });
    }
  }
  return violations;
}

function checkZeroFindingsCriterion() {
  const violations = [];

  // Todos os eixos pesquisados SEM achados + inspeção executada + evidência
  // válida (hash + locator) ⇒ ANALYZED, com novidade zero.
  const researchedNoFindings = Object.fromEntries(
    Object.values(RESEARCH_AXES).map((axis) => [axis, AXIS_STATES.RESEARCHED_NO_FINDINGS]),
  );
  const evidence = [{ verified: true, contentHash: 'sha256:abc', locator: 'section/1' }];

  const analyzed = evaluateAnalyzedCriterion({
    // `apiApplicable: false` exige JUSTIFICATIVA registrada — "não aplicável" é
    // uma DECLARAÇÃO auditável, nunca uma omissão (é o próprio critério da
    // missão: "API inspection concluída ou NOT_APPLICABLE justificada").
    benchmark: { apiApplicable: false, apiNotApplicableRationale: 'Benchmark sem superfície de API pública documentada.' },
    inspections: { documentation: true, apiApplicable: false },
    axes: researchedNoFindings,
    findings: [],
    evidence,
    errors: [],
    sourceDiscovery: true,
  });

  if (!analyzed.satisfied) {
    violations.push({
      code: 'ZERO_FINDINGS_NOT_ANALYZED',
      missing: analyzed.missing,
      detail: 'Pesquisa completa com zero achados é MEDIÇÃO e deve satisfazer o critério de ANALYZED.',
    });
  }

  // Controle negativo: sem evidência NÃO pode satisfazer (a lacuna continua
  // bloqueando — o que se proíbe é o bloqueio ABSOLUTO por ausência de achado).
  const withoutEvidence = evaluateAnalyzedCriterion({
    benchmark: { apiApplicable: false, apiNotApplicableRationale: 'Benchmark sem superfície de API pública documentada.' },
    inspections: { documentation: true, apiApplicable: false },
    axes: researchedNoFindings,
    findings: [],
    evidence: [],
    errors: [],
    sourceDiscovery: true,
  });
  if (withoutEvidence.satisfied) {
    violations.push({
      code: 'ZERO_FINDINGS_WITHOUT_EVIDENCE_ACCEPTED',
      detail: 'Ausência total de evidência não pode ser aceita como análise.',
    });
  }

  return violations;
}

function run() {
  const contextualVerb = checkContextualVerb();
  const marketing = checkMarketingFilter();
  const zeroFindings = checkZeroFindingsCriterion();

  const violations = [
    ...contextualVerb.map((v) => ({ ...v, check: 'BENCHMARK_CONTEXTUAL_VERB_NORMALIZATION' })),
    ...marketing.map((v) => ({ ...v, check: 'BENCHMARK_NO_MARKETING_AS_CAPABILITY' })),
    ...zeroFindings.map((v) => ({ ...v, check: 'BENCHMARK_ZERO_FINDINGS_ANALYZED' })),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    checks: {
      BENCHMARK_CONTEXTUAL_VERB_NORMALIZATION: contextualVerb.length === 0 ? 'PASS' : 'FAIL',
      BENCHMARK_NO_MARKETING_AS_CAPABILITY: marketing.length === 0 ? 'PASS' : 'FAIL',
      BENCHMARK_ZERO_FINDINGS_ANALYZED: zeroFindings.length === 0 ? 'PASS' : 'FAIL',
    },
    violations,
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function main() {
  const report = run();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(
      `[benchmark-semantics] status=${report.status} `
      + `verb=${report.checks.BENCHMARK_CONTEXTUAL_VERB_NORMALIZATION} `
      + `marketing=${report.checks.BENCHMARK_NO_MARKETING_AS_CAPABILITY} `
      + `zeroFindings=${report.checks.BENCHMARK_ZERO_FINDINGS_ANALYZED}`,
    );
    for (const violation of report.violations) {
      console.log(`  - [${violation.check}] ${violation.code}${violation.text ? `: "${violation.text}"` : ''} — ${violation.detail || ''}`);
    }
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { run, checkContextualVerb, checkMarketingFilter, checkZeroFindingsCriterion };
