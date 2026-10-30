'use strict';

/**
 * Adaptador do PILOTO QA Waves para LRO.
 *
 * Regra do mandato (§9 "Adapte o motor existente sem reescrevê-lo") e da Fase 3 do plano
 * (`docs/architecture/lro-qa-waves.md` §5): enquanto `LRO_QA_WAVES_MIRROR` não estiver ligada, o
 * motor do QA Waves funciona EXATAMENTE como antes — a fonte autoritativa continua sendo a fila em
 * memória (`qa-mesh/executionQueue.js`). O adaptador apenas ESPELHA a execução real para o estado
 * durável, para que progresso, eventos e reconexão já existam antes de qualquer corte.
 *
 * Falha do espelho NUNCA derruba a execução: o LRO é observador nesta fase. O erro é logado com
 * código, sem payload e sem dado de cliente.
 */

const logger = require('../../utils/logger');

const FLAG = 'LRO_QA_WAVES_MIRROR';

function espelhoAtivo() {
  return String(process.env[FLAG] || '').trim() === '1';
}

function servico() {
  // Resolvido em tempo de chamada (evita abrir conexão/require pesado quando a flag está off).
  return require('./lroService');
}

async function iniciar({ tenantId, executionId, scenarioIds = [] } = {}) {
  if (!espelhoAtivo()) return null;
  if (!tenantId || !executionId) return null;
  try {
    const lro = servico();
    const operacao = await lro.createOperation({
      tenantId,
      operationType: 'qa_waves',
      visibilityClass: 'DEVELOPMENT', // QA Waves é superfície de engenharia
      ownerActorId: 'qa_mesh',
      correlationId: String(executionId),
      idempotencyKey: `qa_waves:${executionId}`,
    });
    // IDEMPOTÊNCIA ponta a ponta (defeito medido 2026-10-30): re-espelhar a MESMA execução devolvia
    // a operação existente e então tentava `QUEUED` outra vez — `TRANSICAO_INVALIDA`, o adaptador
    // engolia e retornava `null`. Agora só transiciona a partir de CREATED.
    if (operacao.status === 'CREATED') {
      await lro.transition(operacao.id, {
        to: 'QUEUED',
        actorId: 'qa_mesh',
        context: {
          phase: 'queued',
          // Total conhecido quando o escopo é explícito; senão fica NULL (indeterminado).
          progress: { current: 0, total: scenarioIds.length > 0 ? scenarioIds.length : null, unit: 'scenario' },
        },
      });
    }
    return operacao.id;
  } catch (error) {
    logger.warn('[lro:qa-waves] falha ao iniciar espelho', { executionId, code: error.code || null });
    return null;
  }
}

async function marcarExecutando(operationId) {
  if (!espelhoAtivo() || !operationId) return;
  try {
    const atual = await servico().getOperation(operationId);
    // Já executando (retry/duplicata de sinal): nada a fazer — não é erro.
    if (atual.status === 'RUNNING') return;
    await servico().transition(operationId, {
      to: 'RUNNING', actorId: 'qa_mesh', context: { phase: 'execution' },
    });
  } catch (error) {
    logger.warn('[lro:qa-waves] falha ao marcar RUNNING', { operationId, code: error.code || null });
  }
}

async function progresso(operationId, { index = null, total = null, phase = 'execution' } = {}) {
  if (!espelhoAtivo() || !operationId) return;
  try {
    await servico().recordProgress(operationId, {
      current: index, total, unit: 'scenario', phase, actorId: 'qa_mesh',
    });
  } catch (error) {
    logger.warn('[lro:qa-waves] falha ao registrar progresso', { operationId, code: error.code || null });
  }
}

/**
 * Conclui a operação espelhada. `goNoGo === 'NO_GO'` vira `COMPLETED` com desfecho `NO_GO` —
 * conclusão NÃO é aprovação (mandato §9).
 */
async function finalizar(operationId, { goNoGo = null, errorCode = null } = {}) {
  if (!espelhoAtivo() || !operationId) return;
  try {
    const lro = servico();
    // Já terminal (duplicata/retry): conclusão não se repete.
    const atual = await lro.getOperation(operationId).catch(() => null);
    if (atual && ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(atual.status)) return;

    if (errorCode) {
      await lro.transition(operationId, {
        to: 'FAILED', actorId: 'qa_mesh', context: { errorCode: String(errorCode) },
      });
      return;
    }
    await lro.transition(operationId, {
      to: 'COMPLETED',
      actorId: 'qa_mesh',
      context: { outcome: goNoGo === 'NO_GO' ? 'NO_GO' : (goNoGo === 'GO' ? 'GO' : 'INCONCLUSIVE') },
    });
  } catch (error) {
    logger.warn('[lro:qa-waves] falha ao finalizar espelho', { operationId, code: error.code || null });
  }
}

module.exports = { FLAG, espelhoAtivo, iniciar, marcarExecutando, progresso, finalizar };
