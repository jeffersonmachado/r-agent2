#!/usr/bin/env node
'use strict';

/**
 * derive-archetype-coverage-evidence.js — prova (ou recusa) a cobertura de
 * arquétipos de mercado a partir dos achados PERSISTIDOS da pesquisa real.
 *
 * Contexto (GAP_CLOSURE 2026-09-15): a amostra fitness tinha dois arquétipos
 * REQUIRED sem representante (`financial-billing`, `student-digital-experience`).
 * Este script NÃO declara cobertura: ele deriva, para cada arquétipo do sample,
 * quais benchmarks têm achados VERIFICADOS que casam o vocabulário versionado
 * do arquétipo (`config/benchmark-normalization.json#archetypeEvidenceTerms`).
 * Arquétipo sem achado verificado que case é reportado como NÃO suportado —
 * uma lacuna honesta, nunca um mapeamento fabricado.
 *
 * Entrada: Postgres (benchmark_research_runs/findings, run = versão mais
 * recente da vertical no tenant system) + config/benchmarks/<vertical>.json.
 * Saída: reports/benchmark-archetype-evidence.json.
 *
 * WRITE MODE (2026-09-16): o bloco `archetypeEvidence` do sample é DERIVADO
 * por este gerador (`--write`), nunca digitado. Quando um patch de pesquisa
 * substitui o `findingsInventory`, o bloco anterior fica stale (referências
 * a achados de outro run) e precisa ser re-derivado do MESMO run corrente —
 * `--check` detecta o drift. Benchmark sem suporte tem o bloco removido:
 * prova velha não é prova.
 *
 * Uso: node scripts/benchmark/derive-archetype-coverage-evidence.js [--vertical fitness] [--json] [--write|--check]
 */

const fs = require('fs');
const path = require('path');

const { createBenchmarkResearchStore } = require('../../api/services/benchmark/benchmarkResearchStore');
const {
  deriveArchetypeEvidence,
  deriveSampleArchetypeEvidence,
  selectFindingsPerBenchmark,
} = require('../../qa/benchmarks/archetypeEvidenceDerivation');

const ROOT_DIR = path.join(__dirname, '..', '..');
const NORMALIZATION_PATH = path.join(ROOT_DIR, 'config', 'benchmark-normalization.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-archetype-evidence.json');
const GENERATOR_ID = 'scripts/benchmark/derive-archetype-coverage-evidence.js';

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

/**
 * Núcleo PURO: aplica os vereditos derivados ao sample. Só a chave
 * `archetypeEvidence` dos benchmarks é gerenciada; todo o resto é preservado.
 * Determinístico: `provenance.derivedAt` vem do `registered_at` do run (fato
 * persistido), nunca do relógio.
 *
 * Contrato do bloco (histórico, verificado pelos testes de honestidade):
 *  - `derivation` é uma STRING descritiva (módulo + run + vocabulário + contagem);
 *  - cada ref de suporte carrega `findingId` + `evidenceId` + `sourceId` —
 *    a cadeia de proveniência completa finding→evidence→source;
 *  - a proveniência estruturada do gerador fica sob `provenance` (aditiva).
 */
function applyArchetypeEvidence({ sample, benchmarkVerdicts, provenance }) {
  const verdictsByBenchmark = new Map(
    (Array.isArray(benchmarkVerdicts) ? benchmarkVerdicts : []).map((v) => [String(v.benchmarkId), v]),
  );
  const next = JSON.parse(JSON.stringify(sample));
  next.benchmarks = (Array.isArray(next.benchmarks) ? next.benchmarks : []).map((benchmark) => {
    const verdict = verdictsByBenchmark.get(String(benchmark.id));
    const evidence = verdict && verdict.declaredArchetypeEvidence;
    const copy = { ...benchmark };
    if (evidence && evidence.supported === true) {
      const supporting = (Array.isArray(evidence.supportingFindings) ? evidence.supportingFindings : [])
        .map((entry) => ({
          findingId: entry.findingId || entry.id || null,
          evidenceId: entry.evidenceId || null,
          sourceId: entry.sourceId || null,
          name: entry.name || null,
          kind: entry.kind || null,
          matchedTerm: entry.matchedTerm || null,
        }));
      copy.archetypeEvidence = {
        // FITNESS-ABS-14 — escopo multi-run: a string NOMEIA os runs cujos
        // findings verificados sustentam o bloco (o último run que contém cada
        // benchmark, não apenas o mais recente da vertical).
        derivation: `${provenance.generator} sobre os findings VERIFICADOS ${Array.isArray(provenance.researchVersions) && provenance.researchVersions.length > 0 ? `dos runs ${provenance.researchVersions.join(', ')}` : `do run ${provenance.researchVersion}`} (vocabulário config/benchmark-normalization.json#archetypeEvidenceTerms[${verdict.declaredArchetype}]): ${supporting.length} achado(s) verificado(s) casam.`,
        supported: true,
        reason: evidence.reason || null,
        supportingFindings: supporting,
        verifiedFindings: Number(evidence.verifiedFindings) || 0,
        totalFindings: Number(evidence.totalFindings) || 0,
        provenance: { ...provenance },
      };
    } else {
      delete copy.archetypeEvidence;
    }
    return copy;
  });
  return next;
}

function parseArgs(argv) {
  const args = { vertical: 'fitness', json: false, write: false, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--vertical') { args.vertical = argv[index + 1]; index += 1; }
    if (argv[index] === '--json') args.json = true;
    if (argv[index] === '--write') args.write = true;
    if (argv[index] === '--check') args.check = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const normalization = readJson(NORMALIZATION_PATH);
  const samplePath = path.join(ROOT_DIR, 'config', 'benchmarks', `${args.vertical}.json`);
  const sample = readJson(samplePath);

  // Store real (Postgres): sem conexão a operação falha — nunca fallback.
  await require('../../api/db').connect(1, 500);
  const store = createBenchmarkResearchStore();
  const latestRun = await store.getRun({ tenantId: 'system', vertical: args.vertical });
  if (!latestRun) {
    throw new Error(`nenhum run de pesquisa para a vertical ${args.vertical} (tenant system)`);
  }

  // FITNESS-ABS-14 — escopo MULTI-RUN: os findings que respaldam um benchmark
  // são os do ÚLTIMO run que o contém como subject (a fonte do
  // `findingsInventory` vigente — cada patch substitui os campos de pesquisa
  // por inteiro). Ler só o run mais recente apagava a prova de benchmarks
  // analisados em runs anteriores (abcfitness/wellhub perderam o bloco quando
  // o run r11 — sem eles — virou o mais recente).
  const allRuns = await store.listRuns({ tenantId: 'system', vertical: args.vertical });
  const runsWithData = [];
  for (const run of allRuns) {
    const [subjects, findings] = await Promise.all([
      store.listSubjects({ tenantId: 'system', runId: run.id }),
      store.listFindings({ tenantId: 'system', runId: run.id }),
    ]);
    runsWithData.push({
      researchVersion: run.research_version,
      subjects: subjects.map((subject) => String(subject.benchmark_id)),
      findings,
    });
  }
  const selected = selectFindingsPerBenchmark({ runs: runsWithData });
  const contributingVersions = [...new Set([...selected.values()]
    .map((entry) => entry.researchVersion)
    .filter(Boolean))];

  const benchmarks = (sample.benchmarks || []).map((benchmark) => ({
    id: benchmark.id,
    archetype: benchmark.archetype || null,
    findings: (selected.get(String(benchmark.id)) || { findings: [] }).findings,
  }));

  const derivation = deriveSampleArchetypeEvidence({
    archetypes: sample.archetypes || [],
    benchmarks,
    normalizationConfig: normalization,
  });

  // Veredito por benchmark: o arquétipo DECLARADO do benchmark tem suporte de
  // evidência nos seus próprios achados verificados?
  const benchmarkVerdicts = benchmarks.map((benchmark) => {
    const declared = benchmark.archetype
      ? deriveArchetypeEvidence({
        archetype: benchmark.archetype,
        findings: benchmark.findings,
        normalizationConfig: normalization,
      })
      : null;
    return {
      benchmarkId: benchmark.id,
      declaredArchetype: benchmark.archetype || null,
      declaredArchetypeEvidence: declared
        ? {
          supported: declared.supported,
          reason: declared.reason,
          supportingFindings: declared.supportingFindings,
          verifiedFindings: declared.verifiedFindings,
          totalFindings: declared.totalFindings,
        }
        : null,
    };
  });

  const report = {
    reportType: 'benchmark-archetype-evidence',
    generatedAt: new Date().toISOString(),
    vertical: args.vertical,
    sampleVersion: sample.sampleVersion || null,
    researchVersion: latestRun.research_version,
    researchVersions: contributingVersions,
    normalizationVersion: normalization.version || null,
    rule: 'arquétipo só tem suporte quando existe achado VERIFICADO casando o vocabulário versionado; ausência de evidência é lacuna declarada, nunca cobertura',
    archetypes: derivation.results,
    benchmarkVerdicts,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const provenance = {
    generator: GENERATOR_ID,
    researchVersion: latestRun.research_version,
    researchVersions: contributingVersions,
    normalizationVersion: normalization.version || null,
    derivedAt: latestRun.registered_at instanceof Date
      ? latestRun.registered_at.toISOString()
      : String(latestRun.registered_at),
  };
  const nextSample = applyArchetypeEvidence({ sample, benchmarkVerdicts, provenance });

  if (args.write) {
    const tmpPath = `${samplePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(nextSample, null, 2)}\n`);
    fs.renameSync(tmpPath, samplePath);
    process.stdout.write(`[archetype-evidence] sample ${args.vertical}.json re-derivado (runs ${contributingVersions.join(", ")})\n`);
  }

  if (args.check) {
    const drifted = [];
    const currentById = new Map((sample.benchmarks || []).map((b) => [String(b.id), b]));
    for (const benchmark of nextSample.benchmarks || []) {
      const current = currentById.get(String(benchmark.id));
      const currentBlock = current ? current.archetypeEvidence || null : null;
      const derivedBlock = benchmark.archetypeEvidence || null;
      if (JSON.stringify(currentBlock) !== JSON.stringify(derivedBlock)) {
        drifted.push(benchmark.id);
      }
    }
    if (drifted.length > 0) {
      process.stderr.write(`[archetype-evidence] DRIFT em ${drifted.length} benchmark(s): ${drifted.join(', ')} — rode --write com o run corrente\n`);
      process.exit(1);
    }
    process.stdout.write('[archetype-evidence] --check OK: archetypeEvidence consistente com o run corrente\n');
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of derivation.results) {
      const supporters = entry.supportingBenchmarks.map((b) => b.benchmarkId).join(', ');
      process.stdout.write(`  ${entry.supported ? 'SUPORTADO  ' : 'SEM PROVA  '}${entry.archetype}${supporters ? ` ← ${supporters}` : ''}\n`);
    }
    process.stdout.write(`[archetype-evidence] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)} (runs ${contributingVersions.join(", ")})\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[archetype-evidence] FALHOU: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { main, REPORT_PATH, GENERATOR_ID, applyArchetypeEvidence };
