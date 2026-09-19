#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-persisted-corpus.js — gate
 * BENCHMARK_PERSISTED_CORPUS_CURRENT.
 *
 * PERGUNTA: os achados PERSISTIDOS que sustentam uma amostra certificada são,
 * hoje, o que dizem ser?
 *
 * Um achado é uma linha no banco + uma evidência + um hash de conteúdo + uma
 * identidade normalizada. Se qualquer elo falta, o achado continua contando
 * para a novidade da vertical e para a cobertura de mercado sem sustentar nada.
 * O arquivo `config/benchmarks/<v>.json` não tem os achados — ele tem o
 * INVENTÁRIO. Quem sustenta a certificação está no banco, e é isso que este
 * gate audita.
 *
 * DUAS CAMADAS, DE PROPÓSITO
 *
 *  1. INTEGRIDADE (global) — invariantes que são defeito em QUALQUER cenário,
 *     independentemente de certificação:
 *       - `evidence_id` apontando para evidência inexistente  -> ORPHAN_EVIDENCE
 *       - `run_id` sem run correspondente                     -> ORPHAN_RUN
 *       - `contentHash` presente e malformado                 -> INVALID_CONTENT_HASH
 *     Essas três são falha dura hoje.
 *
 *  2. POLÍTICA (só para verticais CERTIFICADAS) — as dimensões que dependem de
 *     a vertical afirmar suficiência:
 *       - versão semântica atual      -> STALE_SEMANTICS
 *       - evidência existe            -> MISSING_EVIDENCE
 *       - estado VALIDATED            -> NOT_VALIDATED
 *       - normalizedId válido         -> MISSING_NORMALIZED_ID
 *       - não superseded/rejected     -> SUPERSEDED_FINDING
 *
 *     Por que não global: `UNVERIFIED` e `normalizedId` ausente são ESTADOS
 *     legítimos do pipeline (candidato não resolvido não tem identidade
 *     normalizada). Aplicá-los ao corpus inteiro produziria um gate vermelho
 *     por desenho do pipeline, não por defeito — e um gate que sempre falha
 *     deixa de ser lido. Falha dura onde é defeito; política onde é política.
 *
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-benchmark-persisted-corpus.js
 */

const fs = require('fs');
const path = require('path');

const {
  getSemanticPipelineVersion,
  evaluateSemanticVersion,
} = require('../../api/services/benchmark/semantic/semanticPipelineVersion');
const { resolveHoldoutId } = require('../../api/services/benchmark/benchmarkPhaseModel');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-persisted-corpus-report.json');

const CERTIFICATION_CLAIM = 'SAMPLE_SUFFICIENT';

/** Estado do banco que significa "validado com evidência oficial". */
const VALIDATED_STATES = Object.freeze(['VERIFIED_OFFICIAL']);
/** Estados que marcam achado substituído/recusado — a trilha é preservada. */
const RETIRED_STATES = Object.freeze(['SUPERSEDED', 'REJECTED', 'STALE_SEMANTICS']);

const CODES = Object.freeze({
  // integridade (global)
  ORPHAN_EVIDENCE: 'CORPUS_ORPHAN_EVIDENCE',
  ORPHAN_RUN: 'CORPUS_ORPHAN_RUN',
  INVALID_CONTENT_HASH: 'CORPUS_INVALID_CONTENT_HASH',
  // política (certificadas)
  STALE_SEMANTICS: 'STALE_SEMANTICS',
  MISSING_EVIDENCE: 'CORPUS_MISSING_EVIDENCE',
  NOT_VALIDATED: 'CORPUS_NOT_VALIDATED',
  MISSING_NORMALIZED_ID: 'CORPUS_MISSING_NORMALIZED_ID',
  SUPERSEDED_FINDING: 'CORPUS_SUPERSEDED_FINDING',
  CERTIFIED_WITHOUT_RUNS: 'CORPUS_CERTIFIED_WITHOUT_RUNS',
});

const INTEGRITY_CODES = Object.freeze([
  CODES.ORPHAN_EVIDENCE,
  CODES.ORPHAN_RUN,
  CODES.INVALID_CONTENT_HASH,
]);

const HASH_RE = /^(sha256:)?[0-9a-f]{64}$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Avaliação PURA de um achado persistido (testável sem banco).
 *
 * @param {object} row  linha de `benchmark_research_findings` (plain object)
 * @param {object} context
 * @param {Set<string>} context.evidenceIds  ids de evidência existentes
 * @param {Set<string>} context.runIds       ids de run existentes
 * @param {boolean} context.certified        a vertical está certificada?
 * @param {string} context.currentVersion    versão atual do pipeline semântico
 * @returns {{ codes: string[], integrity: string[], policy: string[] }}
 */
function evaluatePersistedFinding(row, context) {
  const integrity = [];
  const policy = [];
  const metadata = row && typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {};

  // --- INTEGRIDADE ---
  if (isNonEmptyString(row?.evidence_id) && context.evidenceIds && !context.evidenceIds.has(row.evidence_id)) {
    integrity.push(CODES.ORPHAN_EVIDENCE);
  }
  if (!isNonEmptyString(row?.run_id) || (context.runIds && !context.runIds.has(row.run_id))) {
    integrity.push(CODES.ORPHAN_RUN);
  }
  if (isNonEmptyString(metadata.contentHash) && !HASH_RE.test(String(metadata.contentHash))) {
    integrity.push(CODES.INVALID_CONTENT_HASH);
  }

  // --- POLÍTICA (só certificadas) ---
  if (context.certified) {
    const version = evaluateSemanticVersion(metadata);
    if (!version.current) policy.push(CODES.STALE_SEMANTICS);
    if (!isNonEmptyString(row?.evidence_id)) policy.push(CODES.MISSING_EVIDENCE);
    if (!VALIDATED_STATES.includes(String(row?.verification_state))) policy.push(CODES.NOT_VALIDATED);
    if (!isNonEmptyString(metadata.normalizedId)) policy.push(CODES.MISSING_NORMALIZED_ID);
    if (RETIRED_STATES.includes(String(row?.verification_state))
      || metadata.superseded === true
      || isNonEmptyString(metadata.supersededBy)) {
      policy.push(CODES.SUPERSEDED_FINDING);
    }
  }

  return { codes: [...integrity, ...policy], integrity, policy };
}

/** Verticais que DECLARAM certificação + benchmarks + holdout declarado. */
function loadCertifiedSamples() {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  const certified = [];
  for (const name of fs.readdirSync(SAMPLES_DIR).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, name), 'utf8'));
      if (doc?.claim !== CERTIFICATION_CLAIM || !isNonEmptyString(doc.vertical)) continue;
      const benchmarkIds = (Array.isArray(doc.benchmarks) ? doc.benchmarks : [])
        .map((b) => (isNonEmptyString(b?.id) ? String(b.id).trim() : null))
        .filter(Boolean);
      const holdoutId = resolveHoldoutId(doc);
      certified.push({ vertical: doc.vertical, file: name, benchmarkIds, holdoutId });
    } catch (_) {
      // amostra malformada é responsabilidade do gate de sufficiency
    }
  }
  return certified;
}

async function loadCorpus() {
  const { connect, close } = require('../../api/db/sequelize');
  const getFinding = require('../../api/db/models/BenchmarkResearchFinding');
  const getEvidence = require('../../api/db/models/BenchmarkResearchEvidence');
  const getRun = require('../../api/db/models/BenchmarkResearchRun');

  await connect();
  try {
    const runs = await getRun().findAll({ order: [['registered_at', 'ASC']] });
    const evidence = await getEvidence().findAll();
    const findings = await getFinding().findAll();
    return {
      runs: runs.map((r) => ({ id: r.id, vertical: r.vertical, registeredAt: r.registered_at })),
      evidenceIds: new Set(evidence.map((e) => e.id)),
      findings: findings.map((f) => (typeof f.toJSON === 'function' ? f.toJSON() : f)),
    };
  } finally {
    await close().catch(() => {});
  }
}

/**
 * Qual run RESPalda um benchmark?
 *
 * O código canônico (`benchmarkResearchStore.listRuns`, ABS-14) já responde:
 * "os findings que respaldam um benchmark são os do último run que o contém,
 * não necessariamente do run mais recente da vertical". Auditar TODOS os runs
 * de uma vertical faria o gate acusar findings HISTÓRICOS como se fossem a
 * afirmação atual — um falso positivo em massa, do mesmo tipo que este gate
 * existe para pegar.
 *
 * @returns {string|null} id do run que respalda o benchmark
 */
function resolveSupportingRunId(benchmarkId, runsAsc, findingsByRun) {
  let supporting = null;
  for (const run of runsAsc) {
    if (findingsByRun.has(run.id)) {
      const hasBenchmark = findingsByRun.get(run.id).some((f) => String(f.benchmark_id) === String(benchmarkId));
      if (hasBenchmark) supporting = run.id;
    }
  }
  return supporting;
}

function buildReport({ corpus, certifiedSamples, currentVersion }) {
  const runIds = new Set(corpus.runs.map((r) => r.id));
  const verticalByRun = new Map(corpus.runs.map((r) => [r.id, r.vertical]));
  const runsByVertical = new Map();
  for (const run of corpus.runs) {
    if (!runsByVertical.has(run.vertical)) runsByVertical.set(run.vertical, []);
    runsByVertical.get(run.vertical).push(run);
  }
  const findingsByRun = new Map();
  for (const finding of corpus.findings) {
    if (!findingsByRun.has(finding.run_id)) findingsByRun.set(finding.run_id, []);
    findingsByRun.get(finding.run_id).push(finding);
  }

  // Conjunto que SUSTENTA a certificação: por benchmark, o último run que o
  // contém. O resto do corpus é histórico e não é julgado por política.
  const certifiedRuns = new Set();
  const supportingDetail = [];
  const violations = [];

  for (const sample of certifiedSamples) {
    const runsAsc = runsByVertical.get(sample.vertical) || [];
    if (runsAsc.length === 0) {
      violations.push({
        code: CODES.CERTIFIED_WITHOUT_RUNS,
        vertical: sample.vertical,
        detail: 'vertical declara certificação mas não possui run de pesquisa — certificação sem corpus',
      });
      continue;
    }
    if (sample.benchmarkIds.length === 0) {
      violations.push({
        code: CODES.CERTIFIED_WITHOUT_RUNS,
        vertical: sample.vertical,
        detail: 'amostra certificada não declara benchmarks — não há corpus a auditar',
      });
      continue;
    }
    for (const benchmarkId of sample.benchmarkIds) {
      const runId = resolveSupportingRunId(benchmarkId, runsAsc, findingsByRun);
      if (!runId) {
        // O HOLDOUT é o INSTRUMENTO de medição de generalização: ele tem de
        // ficar intocado até a saturação aparente (ordem protegida pelo
        // serviço — assertHoldoutNotAnalyzedEarly). "Sem achados" aqui não é
        // lacuna, é o desenho. A isenção é EXPLÍCITA e publicada no relatório,
        // nunca silenciosa: uma isenção muda deixa de ser auditável.
        const isUndeclaredHoldout = sample.holdoutId && String(benchmarkId) === String(sample.holdoutId);
        if (isUndeclaredHoldout) {
          supportingDetail.push({
            vertical: sample.vertical,
            benchmarkId,
            supportingRunId: null,
            exempt: 'holdout_not_analyzed_before_saturation',
          });
          continue;
        }
        violations.push({
          code: CODES.CERTIFIED_WITHOUT_RUNS,
          vertical: sample.vertical,
          detail: `benchmark ${benchmarkId} sem nenhum achado persistido em nenhum run`,
        });
        continue;
      }
      // Holdout ANALISADO entra na política normalmente: se existir corpus do
      // holdout, ele sustenta a afirmação e é auditado como qualquer outro.
      certifiedRuns.add(runId);
      supportingDetail.push({ vertical: sample.vertical, benchmarkId, supportingRunId: runId });
    }
  }

  const perVertical = new Map();
  const supportingRunIds = certifiedRuns;

  for (const finding of corpus.findings) {
    const vertical = verticalByRun.get(finding.run_id) || null;
    const certified = supportingRunIds.has(finding.run_id);

    const evaluation = evaluatePersistedFinding(finding, {
      evidenceIds: corpus.evidenceIds,
      runIds,
      certified,
      currentVersion,
    });

    const entry = perVertical.get(vertical || '(sem run)') || {
      vertical: vertical || '(sem run)',
      findings: 0,
      certified: false,
      supportingFindings: 0,
      withoutEvidence: 0,
      withoutNormalizedId: 0,
      validated: 0,
      withCurrentSemantics: 0,
      retired: 0,
    };
    entry.findings += 1;
    if (certified) { entry.certified = true; entry.supportingFindings += 1; }
    if (!isNonEmptyString(finding.evidence_id)) entry.withoutEvidence += 1;
    const metadata = finding.metadata || {};
    if (!isNonEmptyString(metadata.normalizedId)) entry.withoutNormalizedId += 1;
    if (VALIDATED_STATES.includes(String(finding.verification_state))) entry.validated += 1;
    if (evaluateSemanticVersion(metadata).current) entry.withCurrentSemantics += 1;
    if (RETIRED_STATES.includes(String(finding.verification_state))) entry.retired += 1;
    perVertical.set(entry.vertical, entry);

    for (const code of evaluation.codes) {
      if (violations.length < 200) {
        violations.push({
          code,
          vertical,
          findingId: finding.id,
          runId: finding.run_id,
          scope: INTEGRITY_CODES.includes(code) ? 'integrity' : 'policy',
        });
      }
    }
  }

  return {
    violations,
    supportingDetail,
    perVertical: [...perVertical.values()].sort((a, b) => String(a.vertical).localeCompare(String(b.vertical))),
  };
}

async function main() {
  const { version: currentVersion } = getSemanticPipelineVersion();
  const certifiedSamples = loadCertifiedSamples();

  let corpus;
  try {
    corpus = await loadCorpus();
  } catch (error) {
    console.error(`[benchmark-persisted-corpus] corpus indisponível: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { violations, perVertical, supportingDetail } = buildReport({ corpus, certifiedSamples, currentVersion });
  const integrityViolations = violations.filter((v) => v.scope === 'integrity');
  const policyViolations = violations.filter((v) => v.scope === 'policy');

  const report = {
    validator: 'validate-benchmark-persisted-corpus',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    semanticPipelineVersion: currentVersion,
    certifiedVerticals: certifiedSamples.map((s) => s.vertical),
    // Qual run respalda cada benchmark certificado — a auditoria precisa ser
    // reproduzível, não apenas um veredito.
    supportingDetail,
    totals: {
      runs: corpus.runs.length,
      evidenceRows: corpus.evidenceIds.size,
      findings: corpus.findings.length,
      integrityViolations: integrityViolations.length,
      policyViolations: policyViolations.length,
    },
    verticals: perVertical,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `[benchmark-persisted-corpus] status=${report.status} runs=${report.totals.runs} `
    + `achados=${report.totals.findings} certificadas=${certifiedSamples.length} `
    + `integridade=${integrityViolations.length} politica=${policyViolations.length}`
  );
  for (const violation of violations.slice(0, 15)) {
    console.log(`  - ${violation.code}: ${violation.vertical || '-'} ${violation.findingId || ''}`);
  }
  console.log(`[benchmark-persisted-corpus] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = {
  CODES,
  INTEGRITY_CODES,
  RETIRED_STATES,
  VALIDATED_STATES,
  CERTIFICATION_CLAIM,
  evaluatePersistedFinding,
  loadCertifiedSamples,
  resolveSupportingRunId,
  buildReport,
};
