#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-semantic-version.js — gate
 * CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT.
 *
 * PERGUNTA: a amostra certificada de uma vertical foi produzida pelo pipeline
 * semântico que existe HOJE?
 *
 * Por que isso é bloqueante: um achado de benchmark ("esta empresa permite
 * pagamento recorrente") é uma CONCLUSÃO de um PROGRAMA. Se a regra muda, a
 * conclusão antiga passa a significar outra coisa — mas continua no arquivo,
 * certificando a vertical, descrevendo um mundo que o código atual não produz
 * mais. Sem versionamento, a mudança de regra reescreve milhares de achados em
 * silêncio e a certificação vira ficção.
 *
 * A versão é DERIVADA do conteúdo dos módulos do pipeline
 * (`api/services/benchmark/semantic/semanticPipelineVersion.js`), nunca de
 * timestamp ou commit: o mesmo código tem de dar a mesma versão, senão todo
 * achado nasce STALE e o gate vira ruído.
 *
 * REGRA
 *   - quem define "vertical certificada" é a AUTORIDADE ÚNICA
 *     (`scripts/governance/lib/benchmarkCertificationAuthority.js`): o
 *     relatório canônico do engine de suficiência, onde a certificação é
 *     DERIVADA. O campo declarado `sample.claim` NÃO é fonte — nenhum
 *     produtor o grava e o design proíbe gravá-lo. Até 2026-09-19 este gate
 *     lia `claim` e PASSava com `certifiedSamples=0`: PASS vacuoso.
 *   - amostra de vertical CERTIFICADA pela autoridade PRECISA registrar a
 *     versão atual do pipeline, mais `semanticReprocessRunId` e
 *     `semanticReprocessedAt`:
 *       versão ausente  -> SEMANTIC_VERSION_MISSING   (FAIL)
 *       versão diferente-> STALE_SEMANTICS            (FAIL)
 *       formato inválido-> SEMANTIC_VERSION_FORMAT_UNKNOWN (FAIL)
 *   - amostra de vertical NÃO certificada é reportada como `NOT_CERTIFIED`
 *     (estado honesto, NÃO violação): ausência de prova não é fraude.
 *   - se existir alguma vertical certificada, os achados persistidos dela são
 *     conferidos no banco (`benchmark_research_findings.metadata`). Banco
 *     indisponível nesse cenário é violação (fail-closed) — não dá para
 *     afirmar que a certificação é atual sem olhar o que a sustenta.
 *   - achados APOSENTADOS (verification_state ∈ SUPERSEDED | REJECTED |
 *     STALE_SEMANTICS) NÃO são auditados por versão: eles foram removidos do
 *     corpus vigente por decisão governada registrada na própria linha
 *     (supersededBy/motivo/runId em metadata — trilha preservada, nada é
 *     apagado). Auditar a versão de um achado que já não certifica nada é
 *     falso positivo por desenho: ele foi aposentado exatamente POR ter sido
 *     produzido por outro pipeline. O aposento é contado e publicado
 *     (`persistedFindingsRetired`) — nunca silencioso. Achado ATIVO sem
 *     versão corrente continua FAIL duro.
 *   - autoridade indisponível (relatório ausente/stale/inconsistente) é
 *     violação fail-closed, nunca conjunto vazio silencioso.
 *
 * Uso: node --env-file-if-exists=.env scripts/governance/validate-benchmark-semantic-version.js
 */

const fs = require('fs');
const path = require('path');

const {
  STALE_REASONS,
  getSemanticPipelineVersion,
  evaluateSemanticVersion,
} = require('../../api/services/benchmark/semantic/semanticPipelineVersion');
const { loadCertificationAuthority } = require('./lib/benchmarkCertificationAuthority');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-semantic-version-report.json');

const CODES = Object.freeze({
  VERSION_MISSING: 'SEMANTIC_VERSION_MISSING',
  VERSION_STALE: 'STALE_SEMANTICS',
  VERSION_FORMAT_UNKNOWN: 'SEMANTIC_VERSION_FORMAT_UNKNOWN',
  REPROCESS_RUN_MISSING: 'SEMANTIC_REPROCESS_RUN_MISSING',
  FINDINGS_VERSION_MISSING: 'FINDINGS_SEMANTIC_VERSION_MISSING',
  FINDINGS_VERSION_STALE: 'FINDINGS_STALE_SEMANTICS',
  DB_UNAVAILABLE: 'SEMANTIC_VERSION_DB_UNAVAILABLE',
  CERTIFIED_SAMPLE_MISSING: 'CERTIFIED_SAMPLE_MISSING',
  AUTHORITY_UNAVAILABLE: 'BENCHMARK_CERTIFICATION_AUTHORITY_UNAVAILABLE',
});

const STATUS = Object.freeze({
  CERTIFIED_CURRENT: 'CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT',
  STALE: 'STALE_SEMANTICS',
  NOT_CERTIFIED: 'NOT_CERTIFIED',
  MALFORMED: 'SAMPLE_MALFORMED',
});

/**
 * Estados de achado APOSENTADO por decisão governada (produtor:
 * `scripts/benchmark/apply-semantic-reprocess.js`). Mesmo vocabulário do gate
 * de corpus (`validate-benchmark-persisted-corpus.js`). Aposentado não é
 * ausente: a linha continua no banco com a trilha completa — só não sustenta
 * mais a certificação, logo não é auditada por versão.
 */
const RETIRED_STATES = Object.freeze(['SUPERSEDED', 'REJECTED', 'STALE_SEMANTICS']);

function mapReasonToCode(reason) {
  if (reason === STALE_REASONS.VERSION_MISSING) return CODES.VERSION_MISSING;
  if (reason === STALE_REASONS.VERSION_STALE) return CODES.VERSION_STALE;
  if (reason === STALE_REASONS.VERSION_UNKNOWN_FORMAT) return CODES.VERSION_FORMAT_UNKNOWN;
  return CODES.VERSION_STALE;
}

/**
 * Avaliação PURA de uma amostra (testável sem banco).
 *
 * @param {object} sample
 * @param {string} currentVersion
 * @param {object} [options]
 * @param {boolean} [options.certified]  decisão da AUTORIDADE ÚNICA para a
 *        vertical desta amostra. Default false (fail-closed): sem autoridade
 *        afirmando, nada aqui é certificado — `sample.claim` é inerte.
 * @returns {{ vertical, status, certifiedByAuthority, recordedVersion, expectedVersion,
 *             semanticReprocessRunId, violations: Array<{code, detail}> }}
 */
function evaluateSample(sample, currentVersion, { certified = false } = {}) {
  const vertical = sample && typeof sample.vertical === 'string' ? sample.vertical : null;
  const certifiedByAuthority = certified === true && vertical !== null;

  if (!vertical) {
    return {
      vertical: null,
      status: STATUS.MALFORMED,
      certifiedByAuthority: false,
      recordedVersion: null,
      expectedVersion: currentVersion,
      semanticReprocessRunId: null,
      violations: [{ code: CODES.VERSION_STALE, detail: 'amostra sem campo vertical' }],
    };
  }

  const evaluation = evaluateSemanticVersion(sample);
  const semanticReprocessRunId = typeof sample?.semanticReprocessRunId === 'string' && sample.semanticReprocessRunId.trim()
    ? sample.semanticReprocessRunId.trim()
    : null;

  const violations = [];
  // A exigência do run de reprocessamento NÃO pode ficar aninhada na checagem
  // de versão: uma amostra que registra a versão atual sem apontar o run que a
  // reprocessou está afirmando "produzida agora" sem dizer por quem. Versão
  // correta e origem ausente ainda é uma certificação sem proveniência.
  if (certifiedByAuthority) {
    if (!evaluation.current) {
      violations.push({
        code: mapReasonToCode(evaluation.reason),
        detail: evaluation.recorded
          ? `registrada=${evaluation.recorded} atual=${evaluation.expected}`
          : 'vertical certificada pelo engine sem semanticPipelineVersion registrado',
      });
    }
    if (!semanticReprocessRunId) {
      violations.push({
        code: CODES.REPROCESS_RUN_MISSING,
        detail: 'vertical certificada sem semanticReprocessRunId',
      });
    }
  }

  const status = certifiedByAuthority
    ? (violations.length === 0 ? STATUS.CERTIFIED_CURRENT : STATUS.STALE)
    : STATUS.NOT_CERTIFIED;

  return {
    vertical,
    status,
    certifiedByAuthority,
    recordedVersion: evaluation.recorded,
    expectedVersion: evaluation.expected,
    semanticReprocessRunId,
    violations,
  };
}

function loadSamples() {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs.readdirSync(SAMPLES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const absPath = path.join(SAMPLES_DIR, name);
      let doc = null;
      let parseError = null;
      try {
        doc = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      } catch (error) {
        parseError = error.message;
      }
      return { file: path.relative(ROOT_DIR, absPath), doc, parseError };
    });
}

/**
 * Confere os achados PERSISTIDOS de uma vertical certificada.
 * Só é chamado quando existe ao menos uma vertical certificada.
 *
 * A vertical NÃO vive no achado: `benchmark_research_findings.benchmark_id`
 * guarda o SUJEITO pesquisado (wellhub, tecnofit, gymdesk...), não a vertical.
 * A vertical está no RUN (`benchmark_research_runs.vertical`). Consultar
 * `benchmark_id = <vertical>` não encontra nada e transforma a auditoria em
 * vacuidade silenciosa — o gate diria "0 achados, tudo certo" sem ter olhado
 * um único achado. Por isso o caminho é achado -> run_id -> run.vertical.
 */
async function evaluatePersistedFindings(certifiedVerticals) {
  const result = { checked: 0, stale: 0, retired: 0, detail: [], dbAvailable: true, runsScanned: 0, checkedByVertical: {}, retiredByVertical: {} };
  for (const vertical of certifiedVerticals) {
    result.checkedByVertical[vertical] = 0;
    result.retiredByVertical[vertical] = 0;
  }
  if (certifiedVerticals.length === 0) return result;

  try {
    const { connect, close } = require('../../api/db/sequelize');
    const getFinding = require('../../api/db/models/BenchmarkResearchFinding');
    const getRun = require('../../api/db/models/BenchmarkResearchRun');
    const { Op } = require('sequelize');
    await connect();
    try {
      for (const vertical of certifiedVerticals) {
        const runs = await getRun().findAll({ where: { vertical } });
        if (runs.length === 0) {
          result.detail.push({
            vertical,
            findingId: null,
            code: CODES.DB_UNAVAILABLE,
            recorded: null,
            note: 'vertical certificada sem run de pesquisa — certificação sem corpus',
          });
          continue;
        }
        const runIds = runs.map((run) => run.id);
        result.runsScanned += runIds.length;

        const rows = await getFinding().findAll({ where: { run_id: { [Op.in]: runIds } } });
        for (const row of rows) {
          // Aposentado (SUPERSEDED/REJECTED/STALE_SEMANTICS): fora do corpus
          // vigente por decisão governada — contado e publicado, não auditado.
          if (RETIRED_STATES.includes(String(row.verification_state))) {
            result.retired += 1;
            result.retiredByVertical[vertical] += 1;
            continue;
          }
          result.checked += 1;
          result.checkedByVertical[vertical] += 1;
          const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
          const evaluation = evaluateSemanticVersion(metadata);
          if (!evaluation.current) {
            result.stale += 1;
            if (result.detail.length < 50) {
              result.detail.push({
                vertical,
                findingId: row.id,
                code: evaluation.reason === STALE_REASONS.VERSION_MISSING
                  ? CODES.FINDINGS_VERSION_MISSING
                  : CODES.FINDINGS_VERSION_STALE,
                recorded: evaluation.recorded,
              });
            }
          }
        }
      }
    } finally {
      await close().catch(() => {});
    }
  } catch (error) {
    result.dbAvailable = false;
    result.error = error.message;
  }

  return result;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function failClosed(error) {
  const report = {
    validator: 'validate-benchmark-semantic-version',
    generatedAt: new Date().toISOString(),
    status: 'FAIL',
    certifiedVerticals: [],
    auditedCertifiedVerticals: [],
    violations: [{
      code: error.code || CODES.AUTHORITY_UNAVAILABLE,
      vertical: null,
      file: null,
      detail: error.message,
    }],
  };
  writeReport(report);
  console.log(`[benchmark-semantic-version] status=FAIL autoridade-indisponivel: ${error.message}`);
  console.log(`[benchmark-semantic-version] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  process.exitCode = 1;
}

async function main() {
  // AUTORIDADE ÚNICA primeiro: sem ela não existe conjunto de certificadas —
  // e continuar com conjunto vazio seria exatamente o PASS vacuoso antigo.
  let authority;
  try {
    authority = loadCertificationAuthority();
  } catch (error) {
    failClosed(error);
    return;
  }
  const certifiedSet = new Set(authority.certifiedVerticals);

  const { version: currentVersion, components } = getSemanticPipelineVersion();
  const samples = loadSamples();

  const evaluations = samples.map(({ file, doc, parseError }) => {
    if (!doc) {
      return {
        file,
        vertical: null,
        status: STATUS.MALFORMED,
        certifiedByAuthority: false,
        recordedVersion: null,
        expectedVersion: currentVersion,
        semanticReprocessRunId: null,
        violations: [{ code: CODES.VERSION_STALE, detail: `JSON inválido: ${parseError}` }],
      };
    }
    const vertical = typeof doc.vertical === 'string' ? doc.vertical : null;
    return { file, ...evaluateSample(doc, currentVersion, { certified: vertical !== null && certifiedSet.has(vertical) }) };
  });

  const violations = evaluations.flatMap((evaluation) => evaluation.violations.map((violation) => ({
    ...violation,
    file: evaluation.file,
    vertical: evaluation.vertical,
  })));

  // Vertical certificada pela autoridade PRECISA ter amostra legível — sem
  // ela não há onde registrar a versão semântica que sustenta a certificação.
  for (const vertical of authority.certifiedVerticals) {
    if (!evaluations.some((evaluation) => evaluation.vertical === vertical)) {
      violations.push({
        code: CODES.CERTIFIED_SAMPLE_MISSING,
        vertical,
        file: null,
        detail: 'vertical certificada pela autoridade sem amostra legível em config/benchmarks',
      });
    }
  }

  const certifiedVerticals = authority.certifiedVerticals;

  const findingsAudit = await evaluatePersistedFindings(certifiedVerticals);
  if (!findingsAudit.dbAvailable) {
    violations.push({
      code: CODES.DB_UNAVAILABLE,
      vertical: null,
      file: null,
      detail: `existem verticais certificadas (${certifiedVerticals.join(', ')}) mas os achados persistidos não puderam ser conferidos: ${findingsAudit.error}`,
    });
  }
  violations.push(...findingsAudit.detail.map((item) => ({
    code: item.code,
    file: `benchmark_research_findings:${item.findingId}`,
    vertical: item.vertical,
    detail: item.note || `achado com semantica desatualizada (registrada=${item.recorded || 'ausente'} atual=${currentVersion})`,
  })));

  const auditedCertifiedVerticals = certifiedVerticals.filter(
    (vertical) => (findingsAudit.checkedByVertical[vertical] || 0) > 0,
  );

  const report = {
    validator: 'validate-benchmark-semantic-version',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    semanticPipelineVersion: currentVersion,
    semanticPipelineComponents: components.map((c) => c.name),
    // A autoridade que definiu o conjunto auditado — reproduzível, não implícita.
    authority: {
      reportPath: path.relative(ROOT_DIR, authority.reportPath),
      generatedAt: authority.generatedAt,
      commit: authority.commit,
    },
    samplesChecked: evaluations.length,
    certifiedVerticals,
    certifiedSamples: certifiedVerticals.length,
    auditedCertifiedVerticals,
    persistedFindingsChecked: findingsAudit.checked,
    persistedFindingsCheckedByVertical: findingsAudit.checkedByVertical,
    persistedFindingsStale: findingsAudit.stale,
    persistedFindingsRetired: findingsAudit.retired,
    persistedFindingsRetiredByVertical: findingsAudit.retiredByVertical,
    verticals: evaluations.map((evaluation) => ({
      file: evaluation.file,
      vertical: evaluation.vertical,
      status: evaluation.status,
      certifiedByAuthority: evaluation.certifiedByAuthority,
      recordedVersion: evaluation.recordedVersion,
      expectedVersion: evaluation.expectedVersion,
      semanticReprocessRunId: evaluation.semanticReprocessRunId,
    })),
    violations,
  };

  writeReport(report);

  console.log(
    `[benchmark-semantic-version] status=${report.status} `
    + `amostras=${evaluations.length} certificadas=${certifiedVerticals.length} `
    + `achados=${findingsAudit.checked} violacoes=${violations.length}`
  );
  for (const violation of violations) {
    console.log(`  - ${violation.code}: ${violation.vertical || violation.file || '-'} — ${violation.detail}`);
  }
  console.log(`[benchmark-semantic-version] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { CODES, STATUS, RETIRED_STATES, evaluateSample, mapReasonToCode };
