'use strict';

/**
 * Learning Engine do Cognitive Core.
 *
 * Registra cada execução cognitiva (intenção, contexto usado, plano, ações,
 * sucesso/falha, latência, fallback, intervenção humana e resultado de negócio)
 * em armazenamentos já existentes:
 *
 *  - event ledger canônico (eventLedgerService.appendEventV1, eventos cognitive.execution.*)
 *  - pipeline RAP Learn em falhas (rap-learn recordFailure → learning_records)
 *
 * Política: o Learning Engine SOMENTE registra. Não altera regras críticas
 * automaticamente. A promoção de correção passa pelo pipeline RAP Learn com
 * validação humana/QA — ou, desde 2026-07-22 (decisão explícita do usuário),
 * pela auto-promoção com QA gate de `learningAutoPromotionService.js`,
 * DESLIGADA por padrão e ativada apenas via LEARN_AUTOPROMOTE=1.
 *
 * Registro é best-effort: falha de persistência de aprendizado nunca derruba
 * o fluxo de negócio, mas é sempre logada.
 */

const { sanitize } = require('../sanitize');

function defaultDeps() {
  return {
    appendEventV1: (args) => require('../../../../api/services/eventLedgerService').appendEventV1(args),
    recordFailure: (args) => require('../../../../api/modules/rap-learn/service').recordFailure(args),
  };
}

function createLearningEngine({ appendEventV1, recordFailure, logger } = {}) {
  const log = logger || require('../../../../api/utils/logger');
  const deps = defaultDeps();
  const appendEvent = appendEventV1 || deps.appendEventV1;
  const recordFail = recordFailure || deps.recordFailure;

  /**
   * @param {object} executionRecord registro estruturado montado pelo orchestrator
   */
  async function record(executionRecord) {
    if (!executionRecord || !executionRecord.tenantId) {
      throw new Error('cognitive_learning_record_invalid');
    }
    const sanitized = sanitize(executionRecord);
    const resultStatus = executionRecord.result?.status;
    // Handoff humano é desfecho próprio (neutro) — nunca classificado como falha.
    const handedOff = resultStatus === 'human_handoff_requested';
    const succeeded = resultStatus === 'completed';
    const eventType = handedOff
      ? 'cognitive.execution.handed_off'
      : (succeeded ? 'cognitive.execution.completed' : 'cognitive.execution.failed');

    try {
      await appendEvent({
        tenantId: executionRecord.tenantId,
        type: eventType,
        source: 'cognitive-core',
        correlationId: executionRecord.executionId,
        subject: { type: 'cognitive_execution', id: executionRecord.executionId },
        actor: { type: 'user', id: String(executionRecord.userId || 'system') },
        payload: sanitized,
      });
    } catch (error) {
      log.warn('[CognitiveLearningEngine] Event ledger append failed (best-effort)', {
        tenantId: executionRecord.tenantId,
        executionId: executionRecord.executionId,
        error: error.message,
      });
    }

    if (!succeeded && executionRecord.result?.status === 'failed') {
      try {
        await recordFail({
          tenantId: executionRecord.tenantId,
          source: 'cognitive-core',
          sourceRef: executionRecord.executionId,
          classification: executionRecord.intent || null,
          metrics: {
            intent: executionRecord.intent,
            confidence: executionRecord.confidence,
            latencyMs: executionRecord.latencyMs,
            fallback: executionRecord.fallback,
            humanHandoff: executionRecord.humanHandoff,
            failure: sanitize(executionRecord.result?.failure || null),
          },
        });
      } catch (error) {
        log.warn('[CognitiveLearningEngine] RAP Learn record failed (best-effort)', {
          tenantId: executionRecord.tenantId,
          executionId: executionRecord.executionId,
          error: error.message,
        });
      }
    }

    return { recorded: true, executionId: executionRecord.executionId };
  }

  return { record };
}

module.exports = { createLearningEngine };
