'use strict';

/**
 * Batching dos cenários business do QA Mesh.
 *
 * Motivação: historicamente cada cenário business (screens/flows/journeys de
 * `tests/rpa/business/catalog.js`) virava UM processo separado
 * (`node core/rpa/cli.js business --mode=<modo> --code=<CODE>`), repetindo
 * bootstrap, seed baseline e sessão de browser por cenário. O runner business
 * (`tests/rpa/business/run.js`) já aceita `--code=A,B,C` e executa N cenários
 * num único processo com relatório JSON único (array `scenarios`).
 *
 * Este módulo é a fase de PRÉ-EXECUÇÃO do mesh: agrupa os cenários business
 * selecionados por modo, executa UM processo por modo e devolve um contexto
 * (`take/peek`) cujos adapterResults são injetados no fluxo normal por cenário
 * do meshRunner — a normalização operacional (blocking journeys, fallback,
 * strict mode, evidência) permanece intacta.
 *
 * Semântica à prova de falso-verde (mesh é release blocker):
 * - Entrada do cenário ausente no relatório do batch => `failed` com
 *   `business_batch_missing_scenario` (nunca skipped/passed).
 * - Processo do batch crashou ou relatório ilegível => TODOS os cenários do
 *   batch `failed` com o erro do processo (`business_batch_crashed` /
 *   `business_batch_report_missing`).
 * - Falha de um cenário não contamina status nem diagnostics dos demais:
 *   a atribuição é por `code` e os hints são filtrados pelo `scenarioCode`
 *   (ver extractBusinessQaHints no meshRunner e extractBusinessQaReportHints
 *   em transientEnvRetry).
 *
 * Retry: o meshRunner consome o resultado do batch via `take()` (uma vez).
 * Se a falha for transitória de ambiente, o retry cai no caminho original do
 * adapter (spawn isolado do cenário, `--code=<CODE>` único) — re-executa
 * apenas o cenário falho, no modo single, preservando a semântica do retry.
 *
 * Feature flag: `QA_MESH_BUSINESS_BATCH=0` desativa (1 processo por cenário).
 * Default: ligado. `options.businessBatch === false` também desativa.
 */

const fs = require('fs');
const path = require('path');
const apiAdapter = require('./adapters/apiAdapter');

const ROOT_DIR = path.join(__dirname, '..');
const BUSINESS_MODE_ORDER = ['screens', 'flows', 'journeys'];

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function compactText(value) {
  return String(value || '')
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai o path do relatório business-qa-*.json dos logs do processo.
 * Fonte única do regex — o meshRunner delega para cá (o relatório do batch
 * é compartilhado por N cenários; quem consome filtra por `scenarioCode`).
 */
function parseBusinessQaReportPathFromLogs(logs = []) {
  for (const entry of logs) {
    const line = compactText(entry?.message || entry);
    if (!line) continue;
    const match = line.match(/- json:\s*(\/\S+business-qa-[^\s]+\.json)/i);
    if (match && match[1]) return match[1];
  }
  return null;
}

function isBusinessBatchEnabled(options = {}) {
  if (options.businessBatch === false) return false;
  return process.env.QA_MESH_BUSINESS_BATCH !== '0';
}

/**
 * Identifica cenário business elegível a batch: adapter api executando
 * `node core/rpa/cli.js business --mode=<screens|flows|journeys> --code=<CODE>`.
 * Retorna { mode, code } ou null.
 */
function getBusinessBatchInfo(scenario = {}) {
  if (scenario.adapter !== 'api' || scenario.command !== 'node') return null;
  const args = Array.isArray(scenario.commandArgs) ? scenario.commandArgs : [];
  if (args[0] !== 'core/rpa/cli.js' || args[1] !== 'business') return null;
  const modeArg = args.find((arg) => /^--mode=/.test(arg));
  const mode = modeArg ? modeArg.slice('--mode='.length) : null;
  if (!BUSINESS_MODE_ORDER.includes(mode)) return null;
  const codeArg = args.find((arg) => /^--code=/.test(arg));
  const code = scenario.scenarioCode || (codeArg ? codeArg.slice('--code='.length) : null);
  if (!code) return null;
  return { mode, code };
}

/**
 * Agrupa os cenários business SELECIONADOS por modo e monta um plano por
 * modo com o comando batch (`--code=A,B,C`). Cenários não business são
 * ignorados (seguem o fluxo normal por cenário). Ordem determinística:
 * screens → flows → journeys. O env dos cenários (PIPELINE_BYPASS=1) é
 * preservado no processo do batch.
 */
function planBusinessBatches(scenarios = []) {
  const groups = new Map();
  for (const scenario of scenarios) {
    const info = getBusinessBatchInfo(scenario);
    if (!info) continue;
    if (!groups.has(info.mode)) groups.set(info.mode, []);
    groups.get(info.mode).push({ scenario, code: info.code });
  }

  return BUSINESS_MODE_ORDER
    .filter((mode) => groups.has(mode))
    .map((mode) => {
      const items = groups.get(mode);
      const codes = items.map((item) => item.code);
      const env = items.reduce((acc, item) => ({ ...acc, ...(item.scenario.env || {}) }), {});
      return {
        mode,
        codes,
        items,
        batchScenario: {
          id: `business-batch-${mode}`,
          domain: 'business',
          type: 'business_batch',
          source: 'qa',
          flow: `business_batch_${mode}`,
          criticality: 'high',
          adapter: 'api',
          command: 'node',
          commandArgs: ['core/rpa/cli.js', 'business', `--mode=${mode}`, `--code=${codes.join(',')}`],
          env,
        },
      };
    });
}

/**
 * Extrai os erros da entrada do PRÓPRIO cenário no relatório do batch
 * (causa raiz + primeiro detalhe de etapa FAIL). Nunca olha outras entradas.
 */
function entryFailureErrors(entry, code) {
  const errors = [];
  const rootCause = compactText(entry?.resumo?.causaRaiz);
  if (rootCause) errors.push(rootCause);
  const failedStep = Array.isArray(entry?.etapas)
    ? entry.etapas.find((step) => step && step.status === 'FAIL' && step.detalhe)
    : null;
  const stepDetail = compactText(failedStep?.detalhe);
  if (stepDetail && stepDetail !== rootCause) errors.push(stepDetail);
  if (errors.length === 0) {
    errors.push(`Cenário ${code} com status FAIL no relatório do batch sem causa detalhada.`);
  }
  return errors;
}

/**
 * Monta o adapterResult de um cenário a partir do outcome do batch.
 * O log sintético inclui a linha `- json: <reportPath>` para preservar o
 * contrato de parse do meshRunner/transientEnvRetry; o stdout completo do
 * processo é persistido UMA vez em evidência (batchLogPath), evitando
 * duplicar o log inteiro do batch em cada cenário do histórico.
 */
function buildScenarioAdapterResult({
  plan,
  code,
  status,
  errors,
  reportPath,
  batchLogPath,
  processResult,
  startedAt,
  finishedAt,
}) {
  const logs = [
    { level: 'stdout', message: `[business-batch] mode=${plan.mode} codes=${plan.codes.join(',')} scenario=${code}`, timestamp: nowIso() },
  ];
  if (reportPath) {
    logs.push({ level: 'stdout', message: `- json: ${reportPath}`, timestamp: nowIso() });
  }
  const artifacts = [];
  if (reportPath && fs.existsSync(reportPath)) {
    artifacts.push({ type: 'json', path: reportPath });
  }
  if (batchLogPath) {
    artifacts.push({ type: 'log', path: batchLogPath });
  }
  return {
    status,
    success: status === 'passed',
    logs,
    errors,
    artifacts,
    metrics: {
      command: [plan.batchScenario.command, ...plan.batchScenario.commandArgs].join(' '),
      businessBatch: true,
      batchMode: plan.mode,
      batchSize: plan.codes.length,
      exitCode: typeof processResult?.code === 'number' ? processResult.code : null,
    },
    businessBatch: {
      mode: plan.mode,
      code,
      codes: plan.codes,
      reportPath: reportPath || null,
    },
    startedAt,
    finishedAt,
  };
}

function processFailureDetails(processResult, processError) {
  const details = [];
  if (processError) details.push(compactText(processError.message || processError));
  if (typeof processResult?.code === 'number') details.push(`exit code ${processResult.code}`);
  const stderr = (processResult?.errors || []).map((item) => compactText(item)).filter(Boolean);
  return details.concat(stderr.slice(0, 3)).filter(Boolean);
}

/**
 * Persiste o stdout/stderr completo do processo do batch uma única vez por
 * modo, em `<evidenceDir>/logs/business-batch-<mode>.log` (best-effort).
 */
function persistBatchLog(evidenceDir, plan, logs) {
  if (!evidenceDir) return null;
  try {
    const target = path.join(evidenceDir, 'logs', `business-batch-${plan.mode}.log`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const body = logs
      .map((entry) => `${entry.timestamp || ''} [${entry.level || 'stdout'}] ${entry.message || ''}`.trim())
      .join('\n');
    fs.writeFileSync(target, `${body}\n`, 'utf8');
    return target;
  } catch (_) {
    return null;
  }
}

/**
 * Executa os planos de batch (1 processo por modo, sequencial) e atribui o
 * resultado a cada cenário pelo `code` no relatório JSON do batch.
 * Retorna o contexto de injeção (ver createBusinessBatchContext).
 */
async function executeBusinessBatches(plans, context = {}) {
  const entries = new Map();

  for (const plan of plans) {
    const startedAt = nowIso();
    context.appendLog?.('BUSINESS_BATCH_EXECUTE', 'info', { mode: plan.mode, codes: plan.codes });

    let processResult = null;
    let processError = null;
    try {
      processResult = await apiAdapter.executeScenario(plan.batchScenario, {
        repoRoot: context.repoRoot || ROOT_DIR,
      });
    } catch (error) {
      processError = error;
    }
    const finishedAt = nowIso();

    const logs = Array.isArray(processResult?.logs) ? processResult.logs : [];
    const batchLogPath = persistBatchLog(context.evidenceDir, plan, logs);
    const reportPath = parseBusinessQaReportPathFromLogs(logs);
    const report = reportPath ? safeReadJson(reportPath, null) : null;
    const reportEntries = report && Array.isArray(report.scenarios) ? report.scenarios : null;

    for (const { scenario, code } of plan.items) {
      let status;
      let errors;

      if (processError || !processResult) {
        // Processo nem executou (spawn falhou): todos os cenários do batch falham.
        status = 'failed';
        errors = [
          `business_batch_crashed: processo do batch (mode=${plan.mode}) não executou.`,
          ...processFailureDetails(processResult, processError),
        ];
      } else if (!reportEntries) {
        // Exit code 1 com relatório íntegro é sinalização normal de FAIL; aqui o
        // relatório está ausente/ilegível — não há como atribuir resultado
        // confiável, então TODOS os cenários do batch falham com o erro do processo.
        status = 'failed';
        errors = [
          `business_batch_report_missing: relatório business-qa ausente ou ilegível (mode=${plan.mode}).`,
          ...processFailureDetails(processResult, processError),
        ];
      } else {
        const entry = reportEntries.find((item) => item && String(item.code) === String(code));
        if (!entry) {
          // Relatório íntegro mas SEM a entrada do cenário: nunca skipped/passed.
          status = 'failed';
          errors = [
            `business_batch_missing_scenario: relatório do batch (mode=${plan.mode}) não contém entrada para o cenário ${code}.`,
          ];
        } else if (entry.status === 'PASS') {
          status = 'passed';
          errors = [];
        } else {
          status = 'failed';
          errors = entryFailureErrors(entry, code);
        }
      }

      entries.set(scenario.id, buildScenarioAdapterResult({
        plan,
        code,
        status,
        errors,
        reportPath,
        batchLogPath,
        processResult,
        startedAt,
        finishedAt,
      }));
    }

    context.appendLog?.('BUSINESS_BATCH_DONE', 'info', {
      mode: plan.mode,
      reportPath: reportPath || null,
      passed: plan.items.filter(({ scenario }) => entries.get(scenario.id)?.status === 'passed').length,
      total: plan.items.length,
    });
  }

  return createBusinessBatchContext(entries);
}

/**
 * Contexto de injeção consumido pelo executeScenarioWithFallback.
 * `take()` CONSOME o resultado (uma única vez): o retry transitório do
 * meshRunner não encontra mais o resultado do batch e re-executa o cenário
 * isolado no modo single — política de retry documentada no cabeçalho.
 */
function createBusinessBatchContext(entries) {
  const pending = new Map(entries);
  return {
    size: pending.size,
    has: (scenarioId) => pending.has(scenarioId),
    peek: (scenarioId) => pending.get(scenarioId) || null,
    take: (scenarioId) => {
      if (!pending.has(scenarioId)) return null;
      const value = pending.get(scenarioId);
      pending.delete(scenarioId);
      return value;
    },
  };
}

module.exports = {
  BUSINESS_MODE_ORDER,
  isBusinessBatchEnabled,
  getBusinessBatchInfo,
  planBusinessBatches,
  executeBusinessBatches,
  createBusinessBatchContext,
  parseBusinessQaReportPathFromLogs,
};
