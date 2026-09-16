#!/usr/bin/env node
'use strict';

/**
 * reprocess-semantic-research.js — REPROCESSA a pesquisa competitiva já
 * obtida pelo funil semântico (`api/services/benchmark/semantic/`), SEM
 * refazer fetch: as observações brutas persistidas (achados do run de origem,
 * com locator/fragmentHash/contentHash ligados à evidência real) são a entrada
 * do funil. Nenhuma página é re-obtida; nenhum conteúdo é inventado.
 *
 * Por que existe (missão 2026-09-15): o último run real fitness promoveu
 * headlines/slogans a "capabilities" por palavra-chave. O funil semântico
 * corrige a leitura do MESMO material obtido — a evidência (hash-bound) é a
 * mesma, o que muda é a classificação.
 *
 * O que o script faz:
 *   1. abre um NOVO run (`--to-version`) com o discovery set do sample;
 *   2. para cada benchmark, escolhe o run de origem MAIS RECENTE com análise e
 *      achados (`--from-version` força um run específico);
 *   3. recria fontes/evidências/inspeções no novo run (ids determinísticos,
 *      hashes preservados — binding criptográfico intacto);
 *   4. roda o funil por FONTE (observações agrupadas por fonte/hash) e grava:
 *      candidatos NORMALIZED (canonical_id quando há equivalência declarada) e
 *      UNRESOLVED_SEMANTIC_CANDIDATE (auditoria, fora da novidade);
 *   5. refaz estados de eixo/inspeções e tenta markAnalyzed com o MESMO
 *      critério do serviço (recusas são reportadas nominalmente);
 *   6. saturação aparente só é marcada se o engine PASSar nas três dimensões;
 *      o holdout só é reprocessado depois disso (ordem protegida pelo serviço);
 *   7. escreve o relatório BEFORE/AFTER com as decisões REAIS do engine
 *      (evaluateSampleSufficiency) — nunca patcha veredito.
 *
 * O sample versionado NÃO é reescrito: o merge é calculado em memória e vai
 * para o relatório. Aplicar o patch ao sample é decisão governada à parte.
 *
 * Uso:
 *   node scripts/benchmark/reprocess-semantic-research.js \
 *     --vertical fitness --to-version fitness-semantic-2026-09-15-r1 \
 *     [--from-version fitness-real-2026-09-15-r5] \
 *     [--sample config/benchmarks/fitness.json] \
 *     [--report reports/benchmark-semantic-reprocess-fitness.json]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const VERTICAL = arg('vertical', 'fitness');
const TO_VERSION = arg('to-version');
const FROM_VERSION = arg('from-version', null);
const SAMPLE_PATH = path.resolve(ROOT_DIR, arg('sample', `config/benchmarks/${VERTICAL}.json`));
const REPORT_PATH = path.resolve(ROOT_DIR, arg('report', `reports/benchmark-semantic-reprocess-${VERTICAL}.json`));

/**
 * Decisão PURA de reprocessamento do holdout (loop de absorção 2026-09-15).
 *
 * O reprocesso semântico reclassifica achados JÁ persistidos — não é pesquisa
 * nova e NUNCA abre o holdout cedo. Duas bases legítimas, ambas auditáveis:
 *   - `saturation_marked`: o engine marcou saturação aparente NESTE ciclo (o
 *     caminho original: holdout abre depois da saturação);
 *   - `previously_analyzed_in_sample`: o sample versionado registra
 *     `analyzedAt` do holdout — ele já foi ABERTO legitimamente (pré-registro
 *     + saturação de um ciclo anterior). Sem esta base, um holdout medido com
 *     o classificador antigo ficaria preso à novelty bruta para sempre.
 * Holdout nunca aberto continua proibido (`holdout_not_opened`).
 */
function shouldReprocessHoldout({ holdoutBenchmarkId, saturationMarked, previouslyAnalyzed }) {
  if (!isNonEmptyString(holdoutBenchmarkId)) return { reprocess: false, basis: 'no_holdout' };
  if (saturationMarked === true) return { reprocess: true, basis: 'saturation_marked' };
  if (previouslyAnalyzed === true) return { reprocess: true, basis: 'previously_analyzed_in_sample' };
  return { reprocess: false, basis: 'holdout_not_opened' };
}

const { connect, getSequelize, close } = require('../../api/db/sequelize');
const { createBenchmarkResearchStore } = require('../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../api/services/benchmark/benchmarkResearchService');
const { runNormalizationPipeline, emptyMetrics, mergePipelineMetrics, SEMANTIC_STATUS } = require('../../api/services/benchmark/semantic/normalizationPipeline');
const { RESEARCH_AXES, RESEARCH_AXIS_LIST, AXIS_STATES, axisForKind } = require('../../api/services/benchmark/benchmarkResearchSemantics');
const { mergeSamplePatch } = require('../../api/services/benchmark/benchmarkSampleRegistry');
const { evaluateSampleSufficiency, evaluateSaturation } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');

const SATURATION_POLICY = require('../../config/benchmark-sufficiency-policy.json');

const TENANT = 'system';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Métricas brutas (BEFORE) de um conjunto de runs de origem. */
function rawMetricsOf(findings) {
  const noveltyRaw = { newCapabilities: 0, newJourneys: 0, newBusinessRules: 0 };
  for (const finding of findings) {
    if (finding.verified !== true) continue;
    if (isNonEmptyString(finding.canonical_id)) continue;
    if (finding.kind === 'capability') noveltyRaw.newCapabilities += 1;
    if (finding.kind === 'journey') noveltyRaw.newJourneys += 1;
    if (finding.kind === 'businessRule') noveltyRaw.newBusinessRules += 1;
  }
  return noveltyRaw;
}

async function main() {
  if (!TO_VERSION) {
    process.stderr.write('uso: --to-version é obrigatório\n');
    process.exit(2);
  }
  const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  const sampleBenchmarks = new Map((sample.benchmarks || []).map((benchmark) => [benchmark.id, benchmark]));
  const discoverySet = (sample.benchmarks || [])
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((benchmark) => benchmark.id);
  const holdoutBenchmarkId = sample.holdout?.benchmarkId || null;

  await connect(3, 500);
  const sequelize = getSequelize();
  const store = createBenchmarkResearchStore();
  const service = createBenchmarkResearchService({ store });

  // Run de origem por benchmark: o MAIS RECENTE (registered_at) com análise e
  // achados — ou o --from-version quando declarado.
  async function pickSourceRun(benchmarkId) {
    if (FROM_VERSION) {
      const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL, researchVersion: FROM_VERSION });
      if (!run) return null;
      const subject = await store.getSubject({ tenantId: TENANT, runId: run.id, benchmarkId });
      return subject ? run : null;
    }
    const [rows] = await sequelize.query(
      `SELECT r.id, r.research_version, r.registered_at
         FROM benchmark_research_subjects s
         JOIN benchmark_research_runs r ON r.id = s.run_id
        WHERE s.tenant_key = :tenant AND r.vertical = :vertical AND s.benchmark_id = :benchmarkId
          AND s.analyzed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM benchmark_research_findings f WHERE f.run_id = s.run_id AND f.benchmark_id = s.benchmark_id)
        ORDER BY r.registered_at DESC
        LIMIT 1`,
      { replacements: { tenant: TENANT, vertical: VERTICAL, benchmarkId } },
    );
    return rows[0] || null;
  }

  // Novo run com o discovery set do sample (ordem canônica do sample).
  const newRun = await store.openRun({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion: TO_VERSION,
    benchmarkIds: discoverySet,
    holdoutBenchmarkId,
    registeredAt: new Date().toISOString(),
    metadata: { reprocessedFrom: FROM_VERSION || 'latest-per-benchmark', pipeline: 'semantic-v1' },
  });

  const report = {
    reportType: 'benchmark-semantic-reprocess',
    vertical: VERTICAL,
    toVersion: TO_VERSION,
    fromVersion: FROM_VERSION || 'latest-per-benchmark',
    generatedAt: new Date().toISOString(),
    before: null,
    benchmarks: [],
    after: null,
    engineVerdicts: { before: null, after: null },
  };

  // BEFORE: veredito do engine sobre o sample versionado atual.
  report.engineVerdicts.before = evaluateSampleSufficiency({ sample, policy: SATURATION_POLICY });

  const totals = { before: emptyMetrics(), after: emptyMetrics(), rawFindings: 0, rawNovelty: { newCapabilities: 0, newJourneys: 0, newBusinessRules: 0 } };

  async function reprocessBenchmark(benchmarkId) {
    const entry = {
      benchmarkId,
      sourceRun: null,
      rawObservations: 0,
      pipeline: emptyMetrics(),
      candidates: 0,
      unresolved: 0,
      analysisRefused: null,
      analyzed: false,
    };

    const sourceRun = await pickSourceRun(benchmarkId);
    if (!sourceRun) {
      entry.analysisRefused = 'no_source_run_with_analysis';
      return entry;
    }
    entry.sourceRun = sourceRun.research_version;

    const runId = sourceRun.id;
    const [subject, findings, sources, evidence, inspections] = await Promise.all([
      store.getSubject({ tenantId: TENANT, runId, benchmarkId }),
      store.listFindings({ tenantId: TENANT, runId, benchmarkId }),
      store.listSources({ tenantId: TENANT, runId, benchmarkId }),
      store.listEvidence({ tenantId: TENANT, runId, benchmarkId }),
      store.listSourceInspections({ tenantId: TENANT, runId, benchmarkId }),
    ]);

    totals.rawFindings += findings.length;
    const rawNovelty = rawMetricsOf(findings);
    totals.rawNovelty.newCapabilities += rawNovelty.newCapabilities;
    totals.rawNovelty.newJourneys += rawNovelty.newJourneys;
    totals.rawNovelty.newBusinessRules += rawNovelty.newBusinessRules;
    entry.rawObservations = findings.length;

    const subjectMetadata = subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
    const sampleBenchmark = sampleBenchmarks.get(benchmarkId) || { id: benchmarkId };
    const subjectBenchmark = subjectMetadata.benchmark
      || { id: benchmarkId, name: sampleBenchmark.name || benchmarkId, aliases: [] };
    const refAxes = subjectMetadata.researchAxes || {};
    const refInspections = subjectMetadata.inspections || {};
    const apiApplicable = refInspections.apiApplicable !== false;

    const sourcesById = new Map(sources.map((row) => [row.id, row]));
    const evidenceById = new Map(evidence.map((row) => [row.id, row]));

    // Copia fontes + evidências + inspeções (binding preservado).
    const newSourceIdByOld = new Map();
    for (const sourceRow of sources) {
      const created = await store.upsertSource({
        tenantId: TENANT,
        runId: newRun.id,
        benchmarkId,
        source: {
          url: sourceRow.url,
          tier: sourceRow.tier,
          specificity: sourceRow.specificity,
          httpStatus: sourceRow.http_status,
          verified: sourceRow.verified === true,
          verificationState: sourceRow.verification_state,
        },
      });
      newSourceIdByOld.set(sourceRow.id, created.id);
    }
    for (const evidenceRow of evidence) {
      await store.appendEvidence({
        tenantId: TENANT,
        runId: newRun.id,
        benchmarkId,
        sourceId: evidenceRow.source_id ? (newSourceIdByOld.get(evidenceRow.source_id) || null) : null,
        evidenceRef: evidenceRow.evidence_ref,
        contentHash: evidenceRow.content_hash,
        httpStatus: evidenceRow.http_status,
        capturedAt: toIso(evidenceRow.captured_at),
        metadata: evidenceRow.metadata && typeof evidenceRow.metadata === 'object' ? evidenceRow.metadata : {},
      });
    }
    for (const inspectionRow of inspections) {
      await store.upsertSourceInspection({
        tenantId: TENANT,
        runId: newRun.id,
        benchmarkId,
        subjectId: null,
        sourceId: inspectionRow.source_id ? (newSourceIdByOld.get(inspectionRow.source_id) || null) : null,
        url: inspectionRow.url,
        contentHash: inspectionRow.content_hash,
        retrievedAt: toIso(inspectionRow.retrieved_at),
        inspectedAt: toIso(inspectionRow.inspected_at),
        documentType: inspectionRow.document_type,
        provider: inspectionRow.provider,
        documentationStatus: inspectionRow.documentation_status,
        apiStatus: inspectionRow.api_status,
        axisStatuses: {
          CAPABILITY_AXIS: inspectionRow.capability_axis_status,
          JOURNEY_AXIS: inspectionRow.journey_axis_status,
          BUSINESS_RULE_AXIS: inspectionRow.business_rule_axis_status,
        },
        errors: Array.isArray(inspectionRow.errors) ? inspectionRow.errors : [],
        metadata: inspectionRow.metadata && typeof inspectionRow.metadata === 'object' ? inspectionRow.metadata : {},
      });
    }

    // Funil por FONTE: observações agrupadas pelo vínculo de evidência.
    const findingsBySource = new Map();
    for (const finding of findings) {
      const key = finding.source_id || 'no-source';
      if (!findingsBySource.has(key)) findingsBySource.set(key, []);
      findingsBySource.get(key).push(finding);
    }

    const candidatesByAxis = { [RESEARCH_AXES.CAPABILITY]: 0, [RESEARCH_AXES.JOURNEY]: 0, [RESEARCH_AXES.BUSINESS_RULE]: 0 };
    let benchmarkMetrics = emptyMetrics();

    for (const [sourceId, sourceFindings] of findingsBySource.entries()) {
      const sourceRow = sourceId === 'no-source' ? null : sourcesById.get(sourceId);
      const evidenceRow = sourceFindings.map((finding) => evidenceById.get(finding.evidence_id)).find(Boolean)
        || [...evidenceById.values()].find((row) => row.source_id === sourceId)
        || null;
      const contentHash = evidenceRow?.content_hash
        || sourceFindings.map((finding) => finding.metadata?.contentHash).find(isNonEmptyString)
        || null;

      const observations = sourceFindings.map((finding) => ({
        text: finding.external_name,
        locator: finding.metadata?.locator || null,
        fragmentHash: finding.metadata?.fragmentHash || null,
        description: finding.metadata?.description || null,
        classification: finding.classification || null,
        axis: axisForKind(finding.kind),
      }));

      const pipeline = runNormalizationPipeline({
        observations,
        contentHash,
        source: sourceRow ? { url: sourceRow.url, tier: sourceRow.tier } : null,
        benchmark: subjectBenchmark,
      });
      benchmarkMetrics = mergePipelineMetrics(benchmarkMetrics, pipeline.metrics);

      const recordBase = {
        tenantId: TENANT,
        vertical: VERTICAL,
        benchmarkId,
        source: sourceRow
          ? {
            url: sourceRow.url,
            tier: sourceRow.tier,
            specificity: sourceRow.specificity,
            httpStatus: sourceRow.http_status,
            // A verificação vem da fonte PERSISTIDA no run de origem (status
            // HTTP real da obtenção original) — nunca assumida pelo script.
            verified: sourceRow.verified === true,
            contentHash,
          }
          : { url: null },
        evidenceRef: evidenceRow?.evidence_ref || null,
        analyzedContentHash: contentHash,
        benchmark: subjectBenchmark,
      };

      for (const candidate of pipeline.candidates) {
        try {
          await service.recordFinding({
            ...recordBase,
            kind: candidate.kind,
            externalName: candidate.externalName,
            canonicalId: candidate.canonicalId,
            classification: candidate.classification,
            archetype: sampleBenchmark.archetype || subject.archetype || null,
            origin: candidate.origin,
            locator: candidate.locator,
            normalizedId: candidate.normalizedId,
            metadata: {
              description: candidate.description,
              fragmentHash: candidate.fragmentHash,
              confidence: candidate.confidence,
              semanticStatus: SEMANTIC_STATUS.NORMALIZED,
              form: candidate.form,
              structuredRule: candidate.structuredRule,
              clusterId: candidate.clusterId,
              normalizationRationale: candidate.normalizationRationale,
              variants: candidate.variants,
              reprocessedFrom: sourceRun.research_version,
            },
          });
          const axis = axisForKind(candidate.kind);
          if (axis) candidatesByAxis[axis] += 1;
          entry.candidates += 1;
        } catch (error) {
          entry.recordErrors = [...(entry.recordErrors || []), `${candidate.externalName}: ${error.code || error.message}`];
        }
      }

      for (const pending of pipeline.unresolved) {
        try {
          await service.recordFinding({
            ...recordBase,
            kind: pending.kind,
            externalName: pending.externalName,
            canonicalId: null,
            classification: pending.classification,
            archetype: sampleBenchmark.archetype || subject.archetype || null,
            origin: pending.origin,
            locator: pending.locator,
            normalizedId: null,
            metadata: {
              description: pending.description,
              fragmentHash: pending.fragmentHash,
              confidence: pending.confidence,
              semanticStatus: SEMANTIC_STATUS.UNRESOLVED,
              normalizationRationale: pending.normalizationRationale,
              reprocessedFrom: sourceRun.research_version,
            },
          });
          entry.unresolved += 1;
        } catch (error) {
          entry.recordErrors = [...(entry.recordErrors || []), `${pending.externalName}: ${error.code || error.message}`];
        }
      }
    }

    // Estados de eixo: o eixo pesquisado no run de origem continua pesquisado;
    // WITH/NO_FINDINGS reflete o funil NOVO (honesto sobre o que sobrou).
    for (const axis of RESEARCH_AXIS_LIST) {
      const refState = String(refAxes[axis] || AXIS_STATES.NOT_RESEARCHED);
      let state = refState;
      if (refState === AXIS_STATES.RESEARCHED_WITH_FINDINGS || refState === AXIS_STATES.RESEARCHED_NO_FINDINGS) {
        state = candidatesByAxis[axis] > 0 ? AXIS_STATES.RESEARCHED_WITH_FINDINGS : AXIS_STATES.RESEARCHED_NO_FINDINGS;
      }
      await service.setAxisState({
        tenantId: TENANT,
        vertical: VERTICAL,
        benchmarkId,
        axis,
        state,
        reason: null,
      });
    }

    await service.recordInspections({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId,
      inspections: { ...refInspections, reprocessedAt: new Date().toISOString() },
      metadata: {
        benchmark: subjectBenchmark,
        errors: Array.isArray(subjectMetadata.errors) ? subjectMetadata.errors : [],
        pipelineMetrics: benchmarkMetrics,
      },
    });

    entry.pipeline = benchmarkMetrics;

    try {
      await service.markAnalyzed({
        tenantId: TENANT,
        vertical: VERTICAL,
        benchmarkId,
        marketArchetypeMapping: {
          archetype: sampleBenchmark.archetype || 'unmapped',
          rationale: 'mapeamento declarado no sample do benchmark (reprocessamento semântico)',
        },
      });
      entry.analyzed = true;
    } catch (error) {
      entry.analysisRefused = error.code ? `${error.code}: ${error.message}` : error.message;
    }

    return entry;
  }

  // Ordem: todos exceto o holdout primeiro (ordem do sample); holdout por
  // último e SÓ se a saturação aparente for marcada pelo engine.
  const ordered = discoverySet.filter((id) => id !== holdoutBenchmarkId);

  for (const benchmarkId of ordered) {
    const entry = await reprocessBenchmark(benchmarkId);
    report.benchmarks.push(entry);
    totals.after = mergePipelineMetrics(totals.after, entry.pipeline);
  }

  // Saturação aparente pelo engine REAL sobre o sample mesclado.
  let saturationMarked = false;
  let saturationEvaluation = null;
  try {
    const partialPatch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: VERTICAL,
      inventoryVersion: sample.inventoryVersion || null,
    });
    const merged = mergeSamplePatch(sample, partialPatch).sample;
    saturationEvaluation = evaluateSaturation({ sample: merged, policy: SATURATION_POLICY });
    const gates = [
      saturationEvaluation.capability.status,
      saturationEvaluation.journey.status,
      saturationEvaluation.businessRule.status,
    ];
    if (gates.every((status) => status === 'PASS')) {
      await service.markApparentSaturation({ tenantId: TENANT, vertical: VERTICAL });
      saturationMarked = true;
    }
  } catch (error) {
    saturationEvaluation = { error: error.code || error.message };
  }

  const holdoutPreviouslyAnalyzed = isNonEmptyString(
    holdoutBenchmarkId && sampleBenchmarks.get(holdoutBenchmarkId)?.analyzedAt,
  );
  const holdoutDecision = shouldReprocessHoldout({
    holdoutBenchmarkId,
    saturationMarked,
    previouslyAnalyzed: holdoutPreviouslyAnalyzed,
  });
  const holdout = { benchmarkId: holdoutBenchmarkId, saturationMarked, reprocessBasis: holdoutDecision.basis, saturationEvaluation, reprocessed: false, entry: null };
  if (holdoutDecision.reprocess) {
    if (!saturationMarked) {
      // Reprocessar um holdout JÁ ABERTO legitimamente exige o flag operacional
      // no run novo (a máquina de estados recusa markAnalyzed sem ele). A base
      // registrada é a abertura anterior — NUNCA uma alegação de saturação.
      await service.markApparentSaturation({ tenantId: TENANT, vertical: VERTICAL });
    }
    holdout.entry = await reprocessBenchmark(holdoutBenchmarkId);
    holdout.reprocessed = true;
    if (holdout.entry?.pipeline) totals.after = mergePipelineMetrics(totals.after, holdout.entry.pipeline);
  }
  report.holdout = holdout;

  // AFTER: patch completo mesclado em memória + veredito REAL do engine.
  const patch = await service.buildSamplePatch({
    tenantId: TENANT,
    vertical: VERTICAL,
    inventoryVersion: sample.inventoryVersion || null,
  });
  const mergedSample = mergeSamplePatch(sample, patch).sample;
  report.engineVerdicts.after = evaluateSampleSufficiency({ sample: mergedSample, policy: SATURATION_POLICY });

  report.before = {
    rawFindings: totals.rawFindings,
    rawNovelty: totals.rawNovelty,
    sampleNovelty: {
      newCapabilities: (sample.benchmarks || []).reduce((sum, b) => sum + (b.novelty?.newCapabilities?.length || 0), 0),
      newJourneys: (sample.benchmarks || []).reduce((sum, b) => sum + (b.novelty?.newJourneys?.length || 0), 0),
      newBusinessRules: (sample.benchmarks || []).reduce((sum, b) => sum + (b.novelty?.newBusinessRules?.length || 0), 0),
    },
  };
  report.after = {
    pipelineMetrics: totals.after,
    novelty: {
      newCapabilities: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newCapabilities?.length || 0), 0),
      newJourneys: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newJourneys?.length || 0), 0),
      newBusinessRules: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newBusinessRules?.length || 0), 0),
    },
    unresolvedSemanticCandidates: patch.benchmarks.reduce((sum, b) => sum + (b.unresolvedSemanticCandidates || 0), 0),
    analyzedBenchmarks: patch.benchmarks.filter((b) => b.analyzedAt).map((b) => b.id),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const before = report.engineVerdicts.before;
  const after = report.engineVerdicts.after;
  process.stdout.write(`[reprocess] vertical=${VERTICAL} to=${TO_VERSION}\n`);
  process.stdout.write(`[reprocess] BEFORE rawFindings=${report.before.rawFindings} rawNovelty(cap/j/r)=${report.before.rawNovelty.newCapabilities}/${report.before.rawNovelty.newJourneys}/${report.before.rawNovelty.newBusinessRules} sampleNovelty=${report.before.sampleNovelty.newCapabilities}/${report.before.sampleNovelty.newJourneys}/${report.before.sampleNovelty.newBusinessRules}\n`);
  const m = totals.after;
  process.stdout.write(`[reprocess] AFTER  candidates(cap/j/r)=${m.normalizedCapabilities}/${m.normalizedJourneys}/${m.normalizedBusinessRules} unresolved=${m.unresolvedSemanticCandidates} rejected(mkt=${m.marketingClaimsRejected} faq=${m.faqQuestionsRejected} headline=${m.headlinesRejected} noise=${m.noiseRejected} benefit=${m.benefitStatementsRejected} pricing=${m.pricingTextRejected} nav=${m.navigationRejected} testimonial=${m.testimonialsRejected} legal=${m.legalTextRejected}) dup=${m.duplicatesCollapsed} overMerge=${m.overMergeRejected} evidMissing=${m.evidenceMissingRejected} hashMismatch=${m.hashMismatchRejected}\n`);
  process.stdout.write(`[reprocess] AFTER  novelty(cap/j/r)=${report.after.novelty.newCapabilities}/${report.after.novelty.newJourneys}/${report.after.novelty.newBusinessRules} analyzed=${report.after.analyzedBenchmarks.length}\n`);
  process.stdout.write(`[reprocess] engine BEFORE: status=${before.status} certifiable=${before.certifiable} sat(cap=${before.gates.capabilitySaturation.status},journey=${before.gates.journeySaturation.status},bizRule=${before.gates.businessRuleSaturation.status}) holdout=${before.gates.holdoutValidation.status}\n`);
  process.stdout.write(`[reprocess] engine AFTER:  status=${after.status} certifiable=${after.certifiable} sat(cap=${after.gates.capabilitySaturation.status},journey=${after.gates.journeySaturation.status},bizRule=${after.gates.businessRuleSaturation.status}) holdout=${after.gates.holdoutValidation.status}\n`);
  process.stdout.write(`[reprocess] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}\n`);

  await close();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[reprocess] FALHOU: ${error.code || ''} ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { shouldReprocessHoldout };
