'use strict';

/**
 * Learning Auto-Promotion Service — auto-promoção de sugestões com QA gate.
 *
 * ATENÇÃO — MUDANÇA DE POLÍTICA (decisão explícita do usuário em 2026-07-22):
 * este serviço quebra a invariante histórica "promoção sempre humana" do
 * RAP Learn. Ele SÓ pode ser ativado via flag explícita (LEARN_AUTOPROMOTE=1
 * no scripts/learning-routine.js) e permanece DESLIGADO por padrão.
 *
 * Limites de segurança (não negociáveis neste serviço):
 *   1. Elegibilidade: apenas registros em status 'suggested' com sugestão
 *      gerada por IA e confidence >= minConfidence. Sugestões determinísticas
 *      (confidence null) NUNCA são auto-promovidas — exigem humano.
 *   2. Gate de QA executável: um comando de validação real (default:
 *      scripts/governance/validate-qa-governance.js) deve sair com código 0.
 *      Falha/timeout no gate => NO_GO, sem exceção.
 *   3. Auditoria: toda decisão (GO ou NO_GO) grava validationResult com os
 *      checks executados, promotedBy='learning-routine:auto' e evento no
 *      ledger canônico. Nada é silencioso.
 *   4. NO_GO => validateSuggestion({passed:false}) => status 'rejected'
 *      (o ciclo humano pode reabrir reclassificando, se quiser).
 */

const { execFile } = require('child_process');

const DEFAULT_MIN_CONFIDENCE = 0.8;
const DEFAULT_QA_TIMEOUT_MS = 120000;
const DEFAULT_QA_COMMAND = process.platform === 'win32'
  ? ['node.exe', ['scripts/governance/validate-qa-governance.js']]
  : ['node', ['scripts/governance/validate-qa-governance.js']];

function defaultDeps() {
  return {
    rapLearn: require('../modules/rap-learn/service'),
    logger: require('../utils/logger'),
    appendEvent: (args) => require('./eventLedgerService').appendEventV1(args),
  };
}

/**
 * Executa o gate de QA como processo filho.
 * @param {{command: string, args: string[], cwd: string, timeoutMs: number}} spec
 * @returns {Promise<{passed: boolean, exitCode: number|null, stdoutTail: string, error: string|null}>}
 */
function runQaGateCommand(spec) {
  return new Promise((resolve) => {
    execFile(
      spec.command,
      spec.args,
      { cwd: spec.cwd, timeout: spec.timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const stdoutTail = String(`${stdout || ''}\n${stderr || ''}`).trim().split('\n').slice(-10).join('\n');
        if (error) {
          resolve({
            passed: false,
            exitCode: typeof error.code === 'number' ? error.code : null,
            stdoutTail,
            error: error.killed ? `timeout after ${spec.timeoutMs}ms` : error.message,
          });
          return;
        }
        resolve({ passed: true, exitCode: 0, stdoutTail, error: null });
      },
    );
  });
}

/**
 * Validações determinísticas de elegibilidade/schema da sugestão.
 * @returns {{checks: object[], eligible: boolean}}
 */
function evaluateSuggestion(record = {}, { minConfidence }) {
  const suggestion = record.suggestion || {};
  const checks = [];

  const hasKind = typeof suggestion.kind === 'string' && suggestion.kind.length > 0;
  checks.push({ name: 'suggestion_schema', passed: hasKind, detail: suggestion.kind || 'missing kind' });

  const actions = Array.isArray(suggestion.proposedActions) ? suggestion.proposedActions.filter(Boolean) : [];
  checks.push({ name: 'has_proposed_actions', passed: actions.length > 0, detail: `${actions.length} action(s)` });

  const generatedByAi = suggestion.generatedBy === 'learning-routine:ai';
  checks.push({ name: 'ai_generated', passed: generatedByAi, detail: suggestion.generatedBy || 'unknown' });

  const confidence = typeof suggestion.confidence === 'number' ? suggestion.confidence : null;
  const confidenceOk = confidence !== null && confidence >= minConfidence;
  checks.push({
    name: 'confidence_threshold',
    passed: confidenceOk,
    detail: confidence === null ? 'no confidence (deterministic suggestion)' : `${confidence} >= ${minConfidence}`,
  });

  return { checks, eligible: checks.every((c) => c.passed) };
}

/**
 * Executa a auto-promoção sobre registros 'suggested'.
 *
 * @param {object} options
 * @param {string} [options.tenantId='system']
 * @param {number} [options.minConfidence=0.8]
 * @param {boolean} [options.dryRun=false]
 * @param {number} [options.limit=50]
 * @param {object} [options.rapLearn] - módulo rap-learn (injetável p/ testes)
 * @param {function} [options.runQaGate] - async () => {passed, ...} (injetável p/ testes)
 * @param {function} [options.appendEvent]
 * @param {object} [options.logger]
 * @param {string} [options.qaCommand] - comando do gate (default: validate-qa-governance)
 * @param {string[]} [options.qaArgs]
 * @param {number} [options.qaTimeoutMs]
 * @param {string} [options.cwd]
 * @returns {Promise<object>} relatório
 */
async function runAutoPromotion(options = {}) {
  const deps = defaultDeps();
  const rapLearn = options.rapLearn || deps.rapLearn;
  const log = options.logger || deps.logger;
  const appendEvent = options.appendEvent || deps.appendEvent;
  const tenantId = options.tenantId || 'system';
  const minConfidence = Number(options.minConfidence) > 0 ? Number(options.minConfidence) : DEFAULT_MIN_CONFIDENCE;
  const dryRun = options.dryRun === true;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 50;
  const startedAt = new Date().toISOString();

  const report = {
    tenantId,
    minConfidence,
    dryRun,
    startedAt,
    finishedAt: null,
    candidates: 0,
    promoted: 0,
    rejected: 0,
    skipped: 0,
    decisions: [],
    errors: [],
  };

  const records = await rapLearn.listLearningRecords({
    tenantId,
    filters: { status: 'suggested', limit },
  });
  report.candidates = records.length;

  for (const record of records) {
    const decision = { recordId: record.id, source: record.source, sourceRef: record.sourceRef || null };

    // 1. Elegibilidade + schema
    const { checks, eligible } = evaluateSuggestion(record, { minConfidence });
    decision.checks = checks;

    if (!eligible) {
      decision.outcome = 'skipped_not_eligible';
      report.skipped += 1;
      report.decisions.push(decision);
      continue;
    }

    // 2. Gate de QA executável (uma única corrida por lote seria otimização;
    //    por registro mantém a auditoria individual clara)
    let qaResult;
    if (typeof options.runQaGate === 'function') {
      qaResult = await options.runQaGate(record);
    } else {
      const [command, defaultArgs] = DEFAULT_QA_COMMAND;
      qaResult = await runQaGateCommand({
        command: options.qaCommand || command,
        args: options.qaArgs || defaultArgs,
        cwd: options.cwd || process.cwd(),
        timeoutMs: Number(options.qaTimeoutMs) > 0 ? Number(options.qaTimeoutMs) : DEFAULT_QA_TIMEOUT_MS,
      });
    }
    decision.qaGate = { passed: qaResult.passed, exitCode: qaResult.exitCode ?? null, error: qaResult.error || null };

    // 3. Decisão
    const passed = qaResult.passed === true;
    decision.outcome = passed ? 'promoted' : 'rejected';

    if (!dryRun) {
      try {
        await rapLearn.validateSuggestion(record.id, {
          passed,
          method: 'auto',
          minConfidence,
          checks,
          qaGate: decision.qaGate,
          validatedAt: new Date().toISOString(),
        }, tenantId);

        if (passed) {
          await rapLearn.promoteToProduction(record.id, 'learning-routine:auto', tenantId);
          report.promoted += 1;
        } else {
          report.rejected += 1;
        }
      } catch (error) {
        decision.outcome = 'error';
        report.errors.push({ recordId: record.id, error: error.message });
        log.warn('[LearningAutoPromotion] falha ao persistir decisão', { recordId: record.id, error: error.message });
      }
    } else {
      if (passed) report.promoted += 1; else report.rejected += 1;
    }

    report.decisions.push(decision);

    // 4. Ledger por decisão (best-effort)
    try {
      await appendEvent({
        tenantId,
        type: 'LearningRoutineCompleted',
        source: 'learning-auto-promotion',
        subject: { type: 'learning_record', id: record.id },
        actor: { type: 'system', id: 'learning-routine:auto' },
        payload: {
          action: 'auto_promotion',
          outcome: decision.outcome,
          dryRun,
          confidence: record.suggestion?.confidence ?? null,
          qaGatePassed: qaResult.passed === true,
        },
      });
    } catch (error) {
      log.warn('[LearningAutoPromotion] Event ledger append falhou (best-effort)', { error: error.message });
    }
  }

  report.finishedAt = new Date().toISOString();

  log.info('[LearningAutoPromotion] Rotina concluída', {
    tenantId,
    candidates: report.candidates,
    promoted: report.promoted,
    rejected: report.rejected,
    skipped: report.skipped,
    dryRun,
  });

  return report;
}

module.exports = {
  runAutoPromotion,
  evaluateSuggestion,
  runQaGateCommand,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_QA_TIMEOUT_MS,
};
