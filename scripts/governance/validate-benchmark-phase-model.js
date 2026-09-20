#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-phase-model.js — gate BENCHMARK_ENGINE_GOVERNANCE.
 *
 * Separa DUAS perguntas que estavam coladas numa só:
 *
 *   BENCHMARK_ENGINE_GOVERNANCE — o MOTOR avalia corretamente? (regras certas,
 *                                aplicadas com a fase certa)
 *   CERTIFIED_VERTICALS         — QUANTAS verticais estão certificadas? (N de M)
 *
 * Medição de 2026-09-19 que motivou a separação: 5 verticais (bakery, clinic,
 * food, market, services) faziam o gate de suficiência FALHAR por
 * `holdout_not_preregistered` — mas elas nem começaram (`SAMPLE_NOT_RESEARCHED`).
 * Um "FAIL" assim não distingue "o motor está errado" de "o trabalho não
 * terminou", e a leitura natural ("o benchmark está quebrado") é falsa. O
 * inverso também engana: PASS de motor não significa 7/7 certificadas.
 *
 * A regra do holdout passa a ser SENSÍVEL À FASE:
 *   - pesquisa NÃO iniciada + holdout ausente  -> BLOCKER (não pode iniciar
 *     assim; é pendência de trabalho, não falha do motor);
 *   - pesquisa JÁ iniciada + holdout ausente   -> VIOLATION (contaminação
 *     irreversível: o holdout deixou de medir generalização no instante em que
 *     foi escolhido com o resultado à vista).
 *
 * A fase é DERIVADA de evidência (runs, achados, saturação, holdout) — nunca
 * declarada. Fase declarada seria afirmação sobre o que existe; o modelo
 * precisa MEDIR.
 *
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-benchmark-phase-model.js
 */

const fs = require('fs');
const path = require('path');

const {
  PHASES,
  PHASE_ORDER,
  resolveHoldoutId,
  resolvePhase,
  evaluatePhaseRequirements,
} = require('../../api/services/benchmark/benchmarkPhaseModel');
const { loadRegisteredVerticals } = require('./lib/registered-verticals');
const { getSemanticPipelineVersion } = require('../../api/services/benchmark/semantic/semanticPipelineVersion');
const { loadCertificationAuthority } = require('./lib/benchmarkCertificationAuthority');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-phase-model-report.json');

const VIOLATION_CODES = Object.freeze({
  HOLDOUT_NOT_PREREGISTERED: 'holdout_not_preregistered',
  SAMPLE_MALFORMED: 'benchmark_sample_malformed',
  PHASE_REGRESSION: 'benchmark_phase_regression',
});

function loadSamples() {
  const samples = new Map();
  if (!fs.existsSync(SAMPLES_DIR)) return samples;
  for (const name of fs.readdirSync(SAMPLES_DIR).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, name), 'utf8'));
      if (doc && typeof doc.vertical === 'string') samples.set(doc.vertical, { doc, file: name });
    } catch (_) {
      samples.set(name.replace(/\.json$/, ''), { doc: null, file: name, malformed: true });
    }
  }
  return samples;
}

async function loadResearchState() {
  const { connect, close } = require('../../api/db/sequelize');
  const getRun = require('../../api/db/models/BenchmarkResearchRun');
  const getFinding = require('../../api/db/models/BenchmarkResearchFinding');
  const getInspection = require('../../api/db/models/BenchmarkSourceInspection');

  await connect();
  try {
    const runs = await getRun().findAll({ order: [['registered_at', 'ASC']] });
    const findings = await getFinding().findAll();
    const inspections = await getInspection().findAll();
    return { runs, findings, inspections };
  } finally {
    await close().catch(() => {});
  }
}

/**
 * Status de inspeção considerados NÃO terminais: a fonte foi tocada mas a
 * análise não concluiu. Só inspeção terminal conta como "holdout respondeu".
 */
const NON_TERMINAL_INSPECTION_STATES = Object.freeze([
  'PENDING', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_RESEARCHED', 'FAILED', 'ERROR',
]);

function buildMeasurement({ verticals, samples, runs, findings, inspections = [], currentSemanticVersion, certifiedVerticals = [] }) {
  const certifiedSet = new Set(certifiedVerticals.map(String));
  const runsByVertical = new Map();
  for (const run of runs) {
    if (!runsByVertical.has(run.vertical)) runsByVertical.set(run.vertical, []);
    runsByVertical.get(run.vertical).push(run);
  }
  const findingsByRun = new Map();
  const benchmarksByRun = new Map();
  for (const finding of findings) {
    const runId = finding.run_id;
    if (!findingsByRun.has(runId)) findingsByRun.set(runId, 0);
    findingsByRun.set(runId, findingsByRun.get(runId) + 1);
    if (!benchmarksByRun.has(runId)) benchmarksByRun.set(runId, new Set());
    benchmarksByRun.get(runId).add(String(finding.benchmark_id));
  }
  const inspectedBenchmarks = new Set();
  for (const inspection of inspections) {
    const states = [inspection.documentation_status, inspection.capability_axis_status, inspection.api_status];
    const terminal = states.some((state) => {
      const value = String(state || '').toUpperCase();
      return value !== '' && !NON_TERMINAL_INSPECTION_STATES.includes(value);
    });
    if (terminal) inspectedBenchmarks.add(String(inspection.benchmark_id));
  }

  const entries = [];
  const violations = [];

  for (const vertical of verticals) {
    const sampleEntry = samples.get(vertical) || null;
    const sample = sampleEntry ? sampleEntry.doc : null;
    const verticalRuns = (runsByVertical.get(vertical) || []).map((run) => ({
      id: run.id,
      registeredAt: run.registered_at,
      saturated: run.saturation_reached === true,
      hasDiscoverySet: Array.isArray(run.discovery_set) ? run.discovery_set.length > 0 : Boolean(run.discovery_set),
    }));

    const totalFindings = verticalRuns.reduce((sum, run) => sum + (findingsByRun.get(run.id) || 0), 0);
    const latestRun = verticalRuns.length > 0 ? verticalRuns[verticalRuns.length - 1] : null;
    const analyzedBenchmarks = latestRun ? (benchmarksByRun.get(latestRun.id) || new Set()).size : 0;

    const holdoutId = resolveHoldoutId(sample);
    const holdoutAnalyzed = holdoutId
      ? verticalRuns.some((run) => (benchmarksByRun.get(run.id) || new Set()).has(holdoutId))
      : false;
    // "Respondeu" inclui o caso legítimo de ZERO achados: a inspeção terminal
    // é uma resposta, e é justamente ela que mede especificidade do inventário.
    const holdoutInspected = holdoutId ? inspectedBenchmarks.has(String(holdoutId)) : false;

    // GAP DECLARAÇÃO x BANCO: a fase acima mede o que EXISTE no corpus. Mas o
    // artefato que se certifica é o SAMPLE versionado, e a pesquisa só entra
    // nele por decisão governada ("pesquisa propõe, humano decide"). Medido em
    // 2026-09-19: beauty tem achados no banco e o sample ainda diz
    // "não pesquisada" — as duas leituras estão certas e medem coisas
    // diferentes. Reportar só uma esconderia a outra, então as duas aparecem.
    const sampleBenchmarks = sample && Array.isArray(sample.benchmarks) ? sample.benchmarks : [];
    const sampleBenchmarksResearched = sampleBenchmarks.filter((b) => b && (b.analyzedAt || b.analysedAt)).length;
    const sampleNotApplied = sampleBenchmarks.length > 0 && sampleBenchmarksResearched === 0 && totalFindings > 0;

    if (sampleEntry && sampleEntry.malformed) {
      violations.push({ code: VIOLATION_CODES.SAMPLE_MALFORMED, vertical, detail: `amostra inválida: ${sampleEntry.file}` });
      continue;
    }

    const { phase, evidence } = resolvePhase({
      sample,
      runs: verticalRuns,
      counts: { findings: totalFindings, analyzedBenchmarks },
      holdoutAnalyzed,
      holdoutInspected,
      currentSemanticVersion,
      authorityCertified: certifiedSet.has(String(vertical)),
    });

    const { blockers, violations: phaseViolations, researchStarted } = evaluatePhaseRequirements({
      phase,
      holdoutPreregistered: holdoutId !== null,
      sample,
    });
    violations.push(...phaseViolations.map((v) => ({ ...v, vertical })));

    entries.push({
      vertical,
      phase,
      researchStarted,
      certifiedByAuthority: certifiedSet.has(String(vertical)),
      declaredClaim: sample ? sample.claim || null : null,
      holdoutPreregistered: holdoutId !== null,
      holdoutId,
      holdoutAnalyzed,
      holdoutInspected,
      // Pesquisa existente no banco que ainda NÃO foi aplicada ao sample
      // versionado (é proposta, não estado certificado).
      sampleBenchmarks: sampleBenchmarks.length,
      sampleBenchmarksResearched,
      sampleNotApplied,
      semanticPipelineVersion: sample ? sample.semanticPipelineVersion || null : null,
      blockers,
      evidence,
    });
  }

  // O modelo não pode reportar fase acima de SAMPLE_SUFFICIENT sem a
  // AUTORIDADE certificar: fase alta sem derivação do engine seria
  // certificação por omissão. (`declaredClaim` fica no relatório como
  // evidência, mas não levanta fase — declaração não é prova.)
  for (const entry of entries) {
    const aboveSufficient = PHASE_ORDER.indexOf(entry.phase) >= PHASE_ORDER.indexOf(PHASES.SAMPLE_SUFFICIENT);
    if (aboveSufficient && !entry.certifiedByAuthority) {
      violations.push({
        code: VIOLATION_CODES.PHASE_REGRESSION,
        vertical: entry.vertical,
        detail: `fase ${entry.phase} sem certificação derivada pela autoridade — certificação por omissão`,
      });
    }
  }

  const certified = entries.filter((entry) => entry.phase === PHASES.CERTIFIED).map((entry) => entry.vertical);
  const sufficient = entries.filter((entry) => PHASES.SAMPLE_SUFFICIENT === entry.phase || entry.phase === PHASES.CERTIFIED);
  const notApplied = entries.filter((entry) => entry.sampleNotApplied).map((entry) => entry.vertical);

  return { entries, violations, certified, sufficient, notApplied };
}

async function main() {
  let model;
  try {
    model = require('../../api/services/benchmark/benchmarkPhaseModel');
  } catch (error) {
    console.error(`[benchmark-phase-model] modelo indisponível: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const verticals = loadRegisteredVerticals();
  const samples = loadSamples();
  const { version: currentSemanticVersion } = getSemanticPipelineVersion();

  // AUTORIDADE ÚNICA: fase >= SAMPLE_SUFFICIENT só existe quando o engine
  // derivou a certificação. Sem o relatório canônico o modelo não pode
  // distinguir "nenhuma certificada" de "certificação não medida" — fail-closed.
  let authority;
  try {
    authority = loadCertificationAuthority();
  } catch (error) {
    console.error(`[benchmark-phase-model] autoridade de certificação indisponível: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let researchState;
  try {
    researchState = await loadResearchState();
  } catch (error) {
    console.error(`[benchmark-phase-model] estado de pesquisa indisponível: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { entries, violations, certified, sufficient, notApplied } = buildMeasurement({
    verticals,
    samples,
    runs: researchState.runs,
    findings: researchState.findings,
    inspections: researchState.inspections,
    currentSemanticVersion,
    certifiedVerticals: authority.certifiedVerticals,
  });

  const engineGovernance = violations.length === 0 ? 'PASS' : 'FAIL';
  const report = {
    validator: 'validate-benchmark-phase-model',
    gate: 'BENCHMARK_ENGINE_GOVERNANCE',
    generatedAt: new Date().toISOString(),
    status: engineGovernance,
    // Duas respostas separadas, de propósito: um PASS de motor não afirma
    // cobertura de verticais, e N/M certificadas não afirma motor quebrado.
    benchmarkEngineGovernance: engineGovernance,
    certifiedVerticals: {
      certified: certified.length,
      sufficient: sufficient.length,
      total: entries.length,
      list: certified,
      sufficientList: sufficient.map((entry) => entry.vertical),
      // Pesquisa que existe no corpus mas não foi aplicada ao sample: é
      // proposta pendente de decisão, não estado certificado.
      researchNotAppliedToSample: notApplied,
    },
    semanticPipelineVersion: currentSemanticVersion,
    // A autoridade que define quais verticais podem estar >= SAMPLE_SUFFICIENT.
    authority: {
      reportPath: path.relative(ROOT_DIR, authority.reportPath),
      generatedAt: authority.generatedAt,
      commit: authority.commit,
      certifiedVerticals: authority.certifiedVerticals,
    },
    phaseOrder: model.PHASE_ORDER,
    verticals: entries,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `[benchmark-phase-model] BENCHMARK_ENGINE_GOVERNANCE=${engineGovernance} `
    + `CERTIFIED_VERTICALS=${sufficient.length}/${entries.length} `
    + `violacoes=${violations.length}`
  );
  for (const entry of entries) {
    const blocker = entry.blockers.length > 0 ? ` | bloqueio: ${entry.blockers[0].code}` : '';
    console.log(`  ${String(entry.vertical).padEnd(10)} ${String(entry.phase).padEnd(20)}${blocker}`);
  }
  for (const violation of violations) {
    console.log(`  ! ${violation.code}: ${violation.vertical} — ${violation.detail}`);
  }
  console.log(`[benchmark-phase-model] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  // Só VIOLAÇÃO derruba o motor. BLOCKER é pendência: bloqueia avançar, não
  // invalida o motor — e transformá-lo em FAIL era exatamente o defeito antigo.
  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { VIOLATION_CODES, buildMeasurement, loadSamples };
