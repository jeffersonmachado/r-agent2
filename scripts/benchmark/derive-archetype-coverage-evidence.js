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
 * Uso: node scripts/benchmark/derive-archetype-coverage-evidence.js [--vertical fitness] [--json]
 */

const fs = require('fs');
const path = require('path');

const { createBenchmarkResearchStore } = require('../../api/services/benchmark/benchmarkResearchStore');
const {
  deriveArchetypeEvidence,
  deriveSampleArchetypeEvidence,
} = require('../../qa/benchmarks/archetypeEvidenceDerivation');

const ROOT_DIR = path.join(__dirname, '..', '..');
const NORMALIZATION_PATH = path.join(ROOT_DIR, 'config', 'benchmark-normalization.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-archetype-evidence.json');

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function parseArgs(argv) {
  const args = { vertical: 'fitness', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--vertical') { args.vertical = argv[index + 1]; index += 1; }
    if (argv[index] === '--json') args.json = true;
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
  const run = await store.getRun({ tenantId: 'system', vertical: args.vertical });
  if (!run) {
    throw new Error(`nenhum run de pesquisa para a vertical ${args.vertical} (tenant system)`);
  }

  const findings = await store.listFindings({ tenantId: 'system', runId: run.id });
  const benchmarks = (sample.benchmarks || []).map((benchmark) => ({
    id: benchmark.id,
    archetype: benchmark.archetype || null,
    findings: findings.filter((finding) => finding.benchmark_id === benchmark.id),
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
    researchVersion: run.research_version,
    normalizationVersion: normalization.version || null,
    rule: 'arquétipo só tem suporte quando existe achado VERIFICADO casando o vocabulário versionado; ausência de evidência é lacuna declarada, nunca cobertura',
    archetypes: derivation.results,
    benchmarkVerdicts,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of derivation.results) {
      const supporters = entry.supportingBenchmarks.map((b) => b.benchmarkId).join(', ');
      process.stdout.write(`  ${entry.supported ? 'SUPORTADO  ' : 'SEM PROVA  '}${entry.archetype}${supporters ? ` ← ${supporters}` : ''}\n`);
    }
    process.stdout.write(`[archetype-evidence] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)} (run ${run.research_version})\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[archetype-evidence] FALHOU: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { main, REPORT_PATH };
