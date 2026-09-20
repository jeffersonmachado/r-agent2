#!/usr/bin/env node
'use strict';

/**
 * apply-semantic-reprocess.js — REPROCESSA a pesquisa competitiva pelo funil
 * semântico atual E GOVERNA O CORPUS no mesmo run: aposenta (sem apagar) os
 * achados que o pipeline de hoje não reproduz como corpus vigente.
 *
 * Por que existe (T3/T7, 2026-09-19): `reprocess-semantic-research.js` grava os
 * achados NOVOS mas deixa os 4.449 achados históricos do fitness ATIVOS — sem
 * `semanticPipelineVersion`, sustentando uma certificação que o programa atual
 * não produziria. Os gates (semantic-version, persisted-corpus) passaram a
 * auditar de verdade e ficaram RED. Os estados SUPERSEDED / REJECTED /
 * STALE_SEMANTICS tinham CONSUMIDOR nos gates e NENHUM produtor. Este script é
 * o produtor.
 *
 * O que ele faz, no MESMO run governado (`--to-version`):
 *   1. reprocessa as observações brutas persistidas (evidência hash-bound,
 *      NADA é re-obtido da web nem inventado) pelo funil semântico ATUAL;
 *   2. grava no run novo SOMENTE os achados que o pipeline valida de ponta a
 *      ponta (fonte verificada + evidência ligada + identidade normalizada) —
 *      é esse conjunto que os gates auditam como corpus vigente da certificação;
 *   3. aposenta os achados de origem, COM MOTIVO, sem apagar nada:
 *        - reproduzido pelo pipeline atual ....... SUPERSEDED (supersededBy =
 *          id do achado novo, oldSemanticVersion/newSemanticVersion, runId);
 *        - normalizado mas fonte não verificável . REJECTED (source_not_verifiable);
 *        - rejeitado pelo classificador atual ..... REJECTED (razão do funil:
 *          marketing_claim, headline, faq_question, noise...);
 *        - candidato não resolvido ................ REJECTED (unresolved_semantic_candidate);
 *   4. SWEEP: todo achado fitness ainda ativo em runs ANTERIORES (histórico de
 *      outras versões do pipeline) vira STALE_SEMANTICS com a versão antiga/
 *      nova registrada — ele existiu, foi produzido por outro programa e não
 *      sustenta mais a certificação. Nada é deletado: a trilha é o banco.
 *
 * IDEMPOTÊNCIA (re-rodar com o mesmo --to-version não duplica nem re-aposenta):
 *   - run/fontes/evidências/inspeções têm ids determinísticos (upsert);
 *   - `insertFinding` é idempotente por conteúdo — o retry devolve a MESMA
 *     linha, logo o `supersededBy` gravado é estável;
 *   - `retireFinding` recusa re-aposentar: a primeira decisão governada fica.
 *
 * O sample versionado NÃO é reescrito aqui: o patch vai para o relatório e a
 * aplicação é decisão governada à parte (fluxo de proposta em
 * `benchmarkChangeProposalService` → `applySamplePatch`).
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/benchmark/apply-semantic-reprocess.js \
 *     --vertical fitness --to-version fitness-semantic-2026-09-19-r2 \
 *     [--from-version fitness-semantic-2026-09-19-r1] \
 *     [--sample config/benchmarks/fitness.json] \
 *     [--report reports/benchmark-semantic-reprocess-fitness-apply.json]
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
const REPORT_PATH = path.resolve(ROOT_DIR, arg('report', `reports/benchmark-semantic-reprocess-${VERTICAL}-apply.json`));

const { connect, getSequelize, close } = require('../../api/db/sequelize');
const { createBenchmarkResearchStore, RETIRED_FINDING_STATES } = require('../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../api/services/benchmark/benchmarkResearchService');
const { runNormalizationPipeline, emptyMetrics, mergePipelineMetrics, SEMANTIC_STATUS } = require('../../api/services/benchmark/semantic/normalizationPipeline');
const { RESEARCH_AXES, RESEARCH_AXIS_LIST, AXIS_STATES, axisForKind } = require('../../api/services/benchmark/benchmarkResearchSemantics');
const { mergeSamplePatch } = require('../../api/services/benchmark/benchmarkSampleRegistry');
const { getSemanticPipelineVersion } = require('../../api/services/benchmark/semantic/semanticPipelineVersion');
const { evaluateSampleSufficiency, evaluateSaturation } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const { shouldReprocessHoldout } = require('./reprocess-semantic-research');

const SATURATION_POLICY = require('../../config/benchmark-sufficiency-policy.json');

const TENANT = 'system';

/** Razões de aposento — vocabulário auditável, nunca livre. */
const RETIRE_REASONS = Object.freeze({
  REPRODUCED: 'reproduced_by_current_semantic_pipeline',
  SOURCE_NOT_VERIFIABLE: 'source_not_verifiable',
  UNRESOLVED: 'unresolved_semantic_candidate',
  STALE_PIPELINE: 'produced_by_superseded_semantic_pipeline',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Chave de identidade semântica de um achado/candidato. */
function candidateKeyOf(kind, normalizedId) {
  return isNonEmptyString(normalizedId) ? `${kind}|${normalizedId}` : null;
}

/**
 * Decisão PURA de aposento de um achado ANTIGO, dado o resultado do funil
 * atual sobre a mesma fonte. Testável sem banco.
 *
 * `ownSourceValidated` distingue dois casos que a chave semântica sozinha
 * confunde (medido em 2026-09-19: o mesmo `normalizedId` aparece em fontes
 * verificadas E não verificadas): a identidade foi reproduzida e validada,
 * mas a PROVA do achado antigo é a fonte DELE. Substituído de verdade só
 * quando a própria fonte do achado validava.
 *
 * @param {object} args.finding            achado antigo (linha plain)
 * @param {Map}    args.candidatesByKey    `${kind}|${normalizedId}` -> { newId, validated }
 * @param {Map}    args.rejectedByName     externalName -> razão do funil
 * @param {boolean} args.ownSourceValidated a fonte DO PRÓPRIO achado valida?
 * @returns {{ action: 'SUPERSEDED'|'REJECTED', reason: string, newFindingId: string|null }}
 */
function decideOldFindingOutcome({ finding, candidatesByKey, rejectedByName, ownSourceValidated = false }) {
  const metadata = finding.metadata && typeof finding.metadata === 'object' ? finding.metadata : {};
  const key = candidateKeyOf(finding.kind, metadata.normalizedId);
  if (key && candidatesByKey.has(key)) {
    const candidate = candidatesByKey.get(key);
    if (candidate.validated && ownSourceValidated === true) {
      return { action: 'SUPERSEDED', reason: RETIRE_REASONS.REPRODUCED, newFindingId: candidate.newId };
    }
    // A identidade pode até ter sido reproduzida (por outra fonte), mas a
    // prova DESTE achado é uma fonte não verificável (homepage genérica,
    // obtenção não confirmada): a alegação existe, a prova não.
    return { action: 'REJECTED', reason: RETIRE_REASONS.SOURCE_NOT_VERIFIABLE, newFindingId: null };
  }
  const name = String(finding.external_name || '');
  if (rejectedByName.has(name)) {
    return { action: 'REJECTED', reason: rejectedByName.get(name), newFindingId: null };
  }
  return { action: 'REJECTED', reason: RETIRE_REASONS.UNRESOLVED, newFindingId: null };
}

/**
 * Metadados de aposento (PURA): trilha completa — quem substituiu, por quê,
 * em qual run, e as versões semânticas antiga/nova.
 */
function buildRetirementMetadata({ decision, finding, reprocessRunId, currentVersion }) {
  const metadata = finding.metadata && typeof finding.metadata === 'object' ? finding.metadata : {};
  const base = {
    supersededReason: decision.reason,
    reprocessRunId,
    oldSemanticVersion: isNonEmptyString(metadata.semanticPipelineVersion)
      ? metadata.semanticPipelineVersion
      : null,
    newSemanticVersion: currentVersion,
  };
  if (decision.action === 'SUPERSEDED') {
    return { ...base, superseded: true, supersededBy: decision.newFindingId };
  }
  return base;
}

/** Métricas brutas (BEFORE) de um conjunto de achados de origem. */
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
  const { version: currentVersion } = getSemanticPipelineVersion();

  await connect(3, 500);
  const sequelize = getSequelize();
  const store = createBenchmarkResearchStore();
  const service = createBenchmarkResearchService({ store });

  // Run de origem por benchmark: o MAIS RECENTE com análise e achados, EXCETO
  // o próprio run de destino (re-rodar não pode virar fonte de si mesmo).
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
          AND r.research_version <> :toVersion
          AND s.analyzed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM benchmark_research_findings f WHERE f.run_id = s.run_id AND f.benchmark_id = s.benchmark_id)
        ORDER BY r.registered_at DESC
        LIMIT 1`,
      { replacements: { tenant: TENANT, vertical: VERTICAL, benchmarkId, toVersion: TO_VERSION } },
    );
    return rows[0] || null;
  }

  const newRun = await store.openRun({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion: TO_VERSION,
    benchmarkIds: discoverySet,
    holdoutBenchmarkId,
    registeredAt: new Date().toISOString(),
    metadata: { reprocessedFrom: FROM_VERSION || 'latest-per-benchmark', pipeline: 'semantic-v1', applyMode: 'governed-corpus' },
  });

  const report = {
    reportType: 'benchmark-semantic-reprocess-apply',
    vertical: VERTICAL,
    toVersion: TO_VERSION,
    fromVersion: FROM_VERSION || 'latest-per-benchmark',
    semanticPipelineVersion: currentVersion,
    generatedAt: new Date().toISOString(),
    before: null,
    benchmarks: [],
    retirement: { superseded: 0, rejected: 0, staleSemantics: 0, alreadyRetired: 0, corrected: 0, byReason: {} },
    after: null,
    engineVerdicts: { before: null, after: null },
  };

  report.engineVerdicts.before = evaluateSampleSufficiency({ sample, policy: SATURATION_POLICY });

  const totals = { after: emptyMetrics(), rawFindings: 0, rawNovelty: { newCapabilities: 0, newJourneys: 0, newBusinessRules: 0 }, recorded: 0, notValidated: 0, unresolved: 0 };

  function countRetirement(result, reason) {
    if (result.alreadyRetired) {
      report.retirement.alreadyRetired += 1;
      return;
    }
    if (result.retired) {
      report.retirement.byReason[reason] = (report.retirement.byReason[reason] || 0) + 1;
    }
  }

  async function applyBenchmark(benchmarkId) {
    const entry = {
      benchmarkId,
      sourceRun: null,
      rawObservations: 0,
      pipeline: emptyMetrics(),
      recorded: 0,
      notValidated: 0,
      unresolved: 0,
      superseded: 0,
      rejected: 0,
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

    const sourcesById = new Map(sources.map((row) => [row.id, row]));
    const evidenceById = new Map(evidence.map((row) => [row.id, row]));

    // Copia fontes + evidências + inspeções (ids determinísticos, binding intacto).
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

    const findingsBySource = new Map();
    for (const finding of findings) {
      const key = finding.source_id || 'no-source';
      if (!findingsBySource.has(key)) findingsBySource.set(key, []);
      findingsBySource.get(key).push(finding);
    }

    const candidatesByAxis = { [RESEARCH_AXES.CAPABILITY]: 0, [RESEARCH_AXES.JOURNEY]: 0, [RESEARCH_AXES.BUSINESS_RULE]: 0 };
    let benchmarkMetrics = emptyMetrics();
    const candidatesByKey = new Map();
    const rejectedByName = new Map();
    const sourceValidatedByGroup = new Map();

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

      for (const rejected of pipeline.rejected) {
        if (isNonEmptyString(rejected.externalName) && !rejectedByName.has(rejected.externalName)) {
          rejectedByName.set(rejected.externalName, rejected.reason || 'semantic_pipeline_rejected');
        }
      }

      const sourceValidated = sourceRow !== null && sourceRow.verified === true && isNonEmptyString(evidenceRow?.evidence_ref);
      sourceValidatedByGroup.set(sourceId, sourceValidated);

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
            verified: sourceRow.verified === true,
            contentHash,
          }
          : { url: null },
        evidenceRef: evidenceRow?.evidence_ref || null,
        analyzedContentHash: contentHash,
        benchmark: subjectBenchmark,
      };

      for (const candidate of pipeline.candidates) {
        const key = candidateKeyOf(candidate.kind, candidate.normalizedId);
        const validated = sourceValidated && isNonEmptyString(candidate.normalizedId);
        if (!validated) {
          if (key && !candidatesByKey.has(key)) candidatesByKey.set(key, { newId: null, validated: false });
          entry.notValidated += 1;
          totals.notValidated += 1;
          continue;
        }
        try {
          const recorded = await service.recordFinding({
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
          // Validated VENCE: o mesmo normalizedId pode aparecer primeiro em
          // uma fonte não verificada (marca a chave como não validada) e
          // depois ser gravado de uma fonte verificada — a chave precisa
          // apontar para o achado novo, senão o aposento registra o motivo
          // errado (medido: 149 achados VERIFIED_OFFICIAL em 2026-09-19).
          if (key) candidatesByKey.set(key, { newId: recorded.id, validated: true });
          const axis = axisForKind(candidate.kind);
          if (axis) candidatesByAxis[axis] += 1;
          entry.recorded += 1;
          totals.recorded += 1;
        } catch (error) {
          entry.recordErrors = [...(entry.recordErrors || []), `${candidate.externalName}: ${error.code || error.message}`];
        }
      }
      entry.unresolved += pipeline.unresolved.length;
      totals.unresolved += pipeline.unresolved.length;
    }

    // APOSENTO dos achados de origem, com motivo (trilha preservada). Achados
    // já aposentados POR ESTE MESMO run têm a decisão recomputada: se o
    // produtor mudou (correção de bug no cálculo do aposento, nunca mudança
    // de política), a correção governada registra de/para na própria linha.
    for (const finding of findings) {
      const plain = typeof finding.get === 'function' ? finding.get({ plain: true }) : finding;
      const ownSourceValidated = sourceValidatedByGroup.get(plain.source_id || 'no-source') === true;
      if (RETIRED_FINDING_STATES.has(String(plain.verification_state))) {
        const metadata = plain.metadata && typeof plain.metadata === 'object' ? plain.metadata : {};
        if (String(metadata.reprocessRunId || '') !== String(newRun.id)) {
          report.retirement.alreadyRetired += 1;
          continue;
        }
        const decision = decideOldFindingOutcome({ finding: plain, candidatesByKey, rejectedByName, ownSourceValidated });
        const diverges = String(plain.verification_state) !== decision.action
          || (decision.action === 'SUPERSEDED' && metadata.supersededBy !== decision.newFindingId);
        if (!diverges) {
          report.retirement.alreadyRetired += 1;
          continue;
        }
        await store.correctRetirement({
          tenantId: TENANT,
          findingId: plain.id,
          expectedReprocessRunId: newRun.id,
          state: decision.action,
          metadata: buildRetirementMetadata({
            decision,
            finding: plain,
            reprocessRunId: newRun.id,
            currentVersion,
          }),
          correctionReason: 'producer_decision_recomputed',
        });
        report.retirement.corrected = (report.retirement.corrected || 0) + 1;
        if (decision.action === 'SUPERSEDED') report.retirement.superseded += 1;
        else report.retirement.rejected += 1;
        continue;
      }
      const decision = decideOldFindingOutcome({ finding: plain, candidatesByKey, rejectedByName, ownSourceValidated });
      const result = await store.retireFinding({
        tenantId: TENANT,
        findingId: plain.id,
        state: decision.action,
        metadata: buildRetirementMetadata({
          decision,
          finding: plain,
          reprocessRunId: newRun.id,
          currentVersion,
        }),
      });
      if (result.retired) {
        if (decision.action === 'SUPERSEDED') {
          entry.superseded += 1;
          report.retirement.superseded += 1;
        } else {
          entry.rejected += 1;
          report.retirement.rejected += 1;
        }
      }
      countRetirement(result, decision.reason);
    }

    // Estados de eixo: o eixo pesquisado no run de origem continua pesquisado;
    // WITH/NO_FINDINGS reflete o funil NOVO.
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
          rationale: 'mapeamento declarado no sample do benchmark (reprocessamento semântico governado)',
        },
      });
      entry.analyzed = true;
    } catch (error) {
      entry.analysisRefused = error.code ? `${error.code}: ${error.message}` : error.message;
    }

    return entry;
  }

  // Ordem: todos exceto o holdout primeiro; holdout por último e SÓ sob a
  // mesma política do reprocess (`shouldReprocessHoldout`).
  const ordered = discoverySet.filter((id) => id !== holdoutBenchmarkId);

  for (const benchmarkId of ordered) {
    const entry = await applyBenchmark(benchmarkId);
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
      await service.markApparentSaturation({ tenantId: TENANT, vertical: VERTICAL });
    }
    holdout.entry = await applyBenchmark(holdoutBenchmarkId);
    holdout.reprocessed = true;
    if (holdout.entry?.pipeline) totals.after = mergePipelineMetrics(totals.after, holdout.entry.pipeline);
  }
  report.holdout = holdout;

  // SWEEP: todo achado fitness ATIVO fora do run novo é histórico de outro
  // pipeline — STALE_SEMANTICS com versões registradas. Nada é apagado.
  // O aposento respeita o tenant de CADA linha (há resíduo de testes de
  // persistência de 2026-09-13 sob outro tenant_key nos mesmos runs — o gate
  // audita o conjunto por run, sem filtro de tenant, então a varredura também
  // não pode ter).
  const [staleRows] = await sequelize.query(
    `SELECT f.id, f.tenant_key, f.verification_state, f.metadata
       FROM benchmark_research_findings f
       JOIN benchmark_research_runs r ON r.id = f.run_id
      WHERE r.vertical = :vertical AND f.run_id <> :runId
        AND f.verification_state NOT IN ('SUPERSEDED', 'REJECTED', 'STALE_SEMANTICS')`,
    { replacements: { vertical: VERTICAL, runId: newRun.id } },
  );
  for (const row of staleRows) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const result = await store.retireFinding({
      tenantId: row.tenant_key,
      findingId: row.id,
      state: 'STALE_SEMANTICS',
      metadata: {
        supersededReason: RETIRE_REASONS.STALE_PIPELINE,
        reprocessRunId: newRun.id,
        oldSemanticVersion: isNonEmptyString(metadata.semanticPipelineVersion) ? metadata.semanticPipelineVersion : null,
        newSemanticVersion: currentVersion,
      },
    });
    if (result.retired) {
      report.retirement.staleSemantics += 1;
      report.retirement.byReason[RETIRE_REASONS.STALE_PIPELINE] = (report.retirement.byReason[RETIRE_REASONS.STALE_PIPELINE] || 0) + 1;
    } else if (result.alreadyRetired) {
      report.retirement.alreadyRetired += 1;
    }
  }

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
    recordedValidatedFindings: totals.recorded,
    notValidatedCandidates: totals.notValidated,
    unresolvedSemanticCandidates: totals.unresolved,
    novelty: {
      newCapabilities: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newCapabilities?.length || 0), 0),
      newJourneys: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newJourneys?.length || 0), 0),
      newBusinessRules: patch.benchmarks.reduce((sum, b) => sum + (b.novelty?.newBusinessRules?.length || 0), 0),
    },
    analyzedBenchmarks: patch.benchmarks.filter((b) => b.analyzedAt).map((b) => b.id),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const before = report.engineVerdicts.before;
  const after = report.engineVerdicts.after;
  process.stdout.write(`[apply] vertical=${VERTICAL} to=${TO_VERSION} run=${newRun.id}\n`);
  process.stdout.write(`[apply] BEFORE rawFindings=${report.before.rawFindings} rawNovelty(cap/j/r)=${report.before.rawNovelty.newCapabilities}/${report.before.rawNovelty.newJourneys}/${report.before.rawNovelty.newBusinessRules}\n`);
  process.stdout.write(`[apply] AFTER  recordedValidated=${totals.recorded} notValidated=${totals.notValidated} unresolved=${totals.unresolved} novelty(cap/j/r)=${report.after.novelty.newCapabilities}/${report.after.novelty.newJourneys}/${report.after.novelty.newBusinessRules}\n`);
  process.stdout.write(`[apply] RETIRE superseded=${report.retirement.superseded} rejected=${report.retirement.rejected} stale=${report.retirement.staleSemantics} alreadyRetired=${report.retirement.alreadyRetired} corrected=${report.retirement.corrected} byReason=${JSON.stringify(report.retirement.byReason)}\n`);
  process.stdout.write(`[apply] engine BEFORE: status=${before.status} certifiable=${before.certifiable}\n`);
  process.stdout.write(`[apply] engine AFTER:  status=${after.status} certifiable=${after.certifiable} holdout=${after.gates.holdoutValidation.status}\n`);
  process.stdout.write(`[apply] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}\n`);

  await close();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[apply] FALHOU: ${error.code || ''} ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  RETIRE_REASONS,
  candidateKeyOf,
  decideOldFindingOutcome,
  buildRetirementMetadata,
  rawMetricsOf,
};
