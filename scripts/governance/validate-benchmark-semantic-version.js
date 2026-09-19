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
 *   - amostra que DECLARA certificação (`claim: SAMPLE_SUFFICIENT`, o mesmo
 *     claim usado por validate-benchmark-sufficiency) PRECISA registrar a
 *     versão atual do pipeline, mais `semanticReprocessRunId` e
 *     `semanticReprocessedAt`:
 *       versão ausente  -> SEMANTIC_VERSION_MISSING   (FAIL)
 *       versão diferente-> STALE_SEMANTICS            (FAIL)
 *       formato inválido-> SEMANTIC_VERSION_FORMAT_UNKNOWN (FAIL)
 *   - amostra que NÃO declara certificação é reportada como `NOT_CERTIFIED`
 *     (estado honesto, NÃO violação): ausência de prova não é fraude.
 *   - se existir alguma vertical certificada, os achados persistidos dela são
 *     conferidos no banco (`benchmark_research_findings.metadata`). Banco
 *     indisponível nesse cenário é violação (fail-closed) — não dá para
 *     afirmar que a certificação é atual sem olhar o que a sustenta.
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

const ROOT_DIR = path.join(__dirname, '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-semantic-version-report.json');

const CERTIFICATION_CLAIM = 'SAMPLE_SUFFICIENT';

const CODES = Object.freeze({
  VERSION_MISSING: 'SEMANTIC_VERSION_MISSING',
  VERSION_STALE: 'STALE_SEMANTICS',
  VERSION_FORMAT_UNKNOWN: 'SEMANTIC_VERSION_FORMAT_UNKNOWN',
  REPROCESS_RUN_MISSING: 'SEMANTIC_REPROCESS_RUN_MISSING',
  FINDINGS_VERSION_MISSING: 'FINDINGS_SEMANTIC_VERSION_MISSING',
  FINDINGS_VERSION_STALE: 'FINDINGS_STALE_SEMANTICS',
  DB_UNAVAILABLE: 'SEMANTIC_VERSION_DB_UNAVAILABLE',
});

const STATUS = Object.freeze({
  CERTIFIED_CURRENT: 'CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT',
  STALE: 'STALE_SEMANTICS',
  NOT_CERTIFIED: 'NOT_CERTIFIED',
  MALFORMED: 'SAMPLE_MALFORMED',
});

function mapReasonToCode(reason) {
  if (reason === STALE_REASONS.VERSION_MISSING) return CODES.VERSION_MISSING;
  if (reason === STALE_REASONS.VERSION_STALE) return CODES.VERSION_STALE;
  if (reason === STALE_REASONS.VERSION_UNKNOWN_FORMAT) return CODES.VERSION_FORMAT_UNKNOWN;
  return CODES.VERSION_STALE;
}

/**
 * Avaliação PURA de uma amostra (testável sem banco).
 * @returns {{ vertical, status, claimsCertification, recordedVersion, expectedVersion,
 *             semanticReprocessRunId, violations: Array<{code, detail}> }}
 */
function evaluateSample(sample, currentVersion) {
  const vertical = sample && typeof sample.vertical === 'string' ? sample.vertical : null;
  const claimsCertification = sample?.claim === CERTIFICATION_CLAIM;

  if (!vertical) {
    return {
      vertical: null,
      status: STATUS.MALFORMED,
      claimsCertification,
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
  if (claimsCertification) {
    if (!evaluation.current) {
      violations.push({
        code: mapReasonToCode(evaluation.reason),
        detail: evaluation.recorded
          ? `registrada=${evaluation.recorded} atual=${evaluation.expected}`
          : `amostra declara ${CERTIFICATION_CLAIM} sem semanticPipelineVersion`,
      });
    }
    if (!semanticReprocessRunId) {
      violations.push({
        code: CODES.REPROCESS_RUN_MISSING,
        detail: 'amostra certificada sem semanticReprocessRunId',
      });
    }
  }

  const status = claimsCertification
    ? (violations.length === 0 ? STATUS.CERTIFIED_CURRENT : STATUS.STALE)
    : STATUS.NOT_CERTIFIED;

  return {
    vertical,
    status,
    claimsCertification,
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
  const result = { checked: 0, stale: 0, detail: [], dbAvailable: true, runsScanned: 0 };
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
          result.checked += 1;
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

async function main() {
  const { version: currentVersion, components } = getSemanticPipelineVersion();
  const samples = loadSamples();

  const evaluations = samples.map(({ file, doc, parseError }) => {
    if (!doc) {
      return {
        file,
        vertical: null,
        status: STATUS.MALFORMED,
        claimsCertification: false,
        recordedVersion: null,
        expectedVersion: currentVersion,
        semanticReprocessRunId: null,
        violations: [{ code: CODES.VERSION_STALE, detail: `JSON inválido: ${parseError}` }],
      };
    }
    return { file, ...evaluateSample(doc, currentVersion) };
  });

  const violations = evaluations.flatMap((evaluation) => evaluation.violations.map((violation) => ({
    ...violation,
    file: evaluation.file,
    vertical: evaluation.vertical,
  })));

  const certifiedVerticals = evaluations
    .filter((evaluation) => evaluation.status === STATUS.CERTIFIED_CURRENT)
    .map((evaluation) => evaluation.vertical);

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
    detail: `achado com semantica desatualizada (registrada=${item.recorded || 'ausente'} atual=${currentVersion})`,
  })));

  const report = {
    validator: 'validate-benchmark-semantic-version',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    semanticPipelineVersion: currentVersion,
    semanticPipelineComponents: components.map((c) => c.name),
    samplesChecked: evaluations.length,
    certifiedSamples: certifiedVerticals.length,
    persistedFindingsChecked: findingsAudit.checked,
    persistedFindingsStale: findingsAudit.stale,
    verticals: evaluations.map((evaluation) => ({
      file: evaluation.file,
      vertical: evaluation.vertical,
      status: evaluation.status,
      claimsCertification: evaluation.claimsCertification,
      recordedVersion: evaluation.recordedVersion,
      expectedVersion: evaluation.expectedVersion,
      semanticReprocessRunId: evaluation.semanticReprocessRunId,
    })),
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

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

module.exports = { CODES, STATUS, CERTIFICATION_CLAIM, evaluateSample, mapReasonToCode };
