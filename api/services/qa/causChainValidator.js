'use strict';

/**
 * causChainValidator.js — Validador da cadeia causal RAP
 *
 * Verifica que executionId → replayId → evidenceId formam uma cadeia
 * verificável e não informal. Cada elo deve ser rastreável ao anterior.
 *
 * Cadeia esperada:
 *   Cognitive Execution (executionId)
 *     → RPA Replay (replayId = replay.id vinculado ao executionId)
 *       → Evidence (smokeFlowId, correlationId)
 *         → Replay Integrity (replayHash, governanceSignature)
 */

const crypto = require('crypto');

/**
 * Verifica cadeia causal entre execução cognitiva, replay RPA e evidência.
 *
 * @param {object} params
 * @param {string} params.executionId     — ID da execução cognitiva
 * @param {string} params.replayId        — ID do replay RPA gerado
 * @param {object} params.replayData      — objeto do replay (lib/replaySystem.replayData)
 * @param {string} params.correlationId   — correlationId usado nos eventos
 * @param {object} params.smokeFlow       — flow do smoke correspondente (se disponível)
 * @returns {{ valid: boolean, chain: string[], gaps: string[], evidence: object }}
 */
function validateCausalChain({ executionId, replayId, replayData, correlationId, smokeFlow } = {}) {
  const chain = [];
  const gaps = [];
  const evidence = {};

  // Elo 1: executionId (ou smokeExecutionId como proxy para smoke evidence)
  const effectiveExecutionId = executionId
    || smokeFlow?.replay?.smokeExecutionId
    || smokeFlow?.smokeExecutionId
    || null;

  if (!effectiveExecutionId) {
    gaps.push('CHAIN_BREAK: executionId ausente — não é possível rastrear origem da execução');
  } else {
    chain.push(`EXECUTION:${String(effectiveExecutionId).slice(0, 16)}`);
    evidence.executionId = effectiveExecutionId;
    if (!executionId) evidence.executionIdSource = 'smokeExecutionId_proxy';
  }

  // Elo 2: replayId existe e é derivável do executionId (ou do recordingId passado na invocação)
  if (!replayId) {
    gaps.push('CHAIN_BREAK: replayId ausente — replay não foi vinculado à execução');
  } else {
    chain.push(`REPLAY:${String(replayId).slice(0, 16)}`);
    evidence.replayId = replayId;

    // Verificar linkage: replayData.id deve corresponder ao replayId
    if (replayData && replayData.id && replayData.id !== replayId) {
      gaps.push(`CHAIN_INCONSISTENCY: replayData.id=${replayData.id} ≠ replayId=${replayId}`);
    }

    // Verificar que o replay tem executionId registrado nos metadata (ou smokeExecutionId como proxy)
    const replayExecutionId = replayData?.metadata?.executionId
      || replayData?.context?.executionId
      || replayData?.smokeExecutionId
      || null;
    if (effectiveExecutionId && replayData && !replayExecutionId) {
      gaps.push('CHAIN_WEAK: replay não registra executionId nos metadata — elo é inferido, não explícito');
    } else if (effectiveExecutionId && replayExecutionId && replayExecutionId !== effectiveExecutionId) {
      gaps.push(`CHAIN_BREAK: replay.executionId=${replayExecutionId} ≠ effectiveExecutionId=${effectiveExecutionId}`);
    }
  }

  // Elo 3: correlationId (ou correlação derivada de smokeExecutionId + journeyId)
  const effectiveCorrelationId = correlationId
    || smokeFlow?.replay?.correlationId
    || (smokeFlow?.replay?.smokeExecutionId && smokeFlow?.journeyId
      ? `${smokeFlow.journeyId}:${smokeFlow.replay.smokeExecutionId}`
      : null);

  if (!effectiveCorrelationId) {
    gaps.push('CHAIN_WEAK: correlationId ausente — rastreabilidade de eventos limitada');
  } else {
    chain.push(`CORRELATION:${String(effectiveCorrelationId).slice(0, 16)}`);
    evidence.correlationId = effectiveCorrelationId;
  }

  // Elo 4: evidência de replay (replayHash, governanceSignature)
  const replayHash = replayData?.replayHash || smokeFlow?.replay?.replayHash;
  const governanceSignature = replayData?.governanceSignature || smokeFlow?.replay?.governanceSignature;

  if (!replayHash) {
    gaps.push('CHAIN_BREAK: replayHash ausente — evidência criptográfica não gerada');
  } else {
    chain.push(`REPLAY_HASH:${String(replayHash).slice(0, 12)}`);
    evidence.replayHash = replayHash;
  }

  if (!governanceSignature) {
    gaps.push('CHAIN_WEAK: governanceSignature ausente — replay não foi assinado pelo governance');
  } else {
    chain.push('GOVERNANCE_SIGNED');
    evidence.governanceSignature = governanceSignature;
  }

  // Elo 5: smoke flow vincula ao mesmo journey (se disponível)
  if (smokeFlow) {
    if (!smokeFlow.journeyId) {
      gaps.push('CHAIN_WEAK: smokeFlow não tem journeyId — evidence não é rastreável a journey');
    } else {
      chain.push(`EVIDENCE:${String(smokeFlow.journeyId).slice(0, 20)}`);
      evidence.smokeFlowJourneyId = smokeFlow.journeyId;
    }
  }

  const valid = gaps.filter((g) => g.startsWith('CHAIN_BREAK')).length === 0;
  const strong = gaps.length === 0;

  return {
    valid,
    strong,
    chain,
    gaps,
    evidence,
    chainLength: chain.length,
    chainRepr: chain.join(' → '),
  };
}

/**
 * Valida múltiplas cadeias causais (uma por flow de smoke).
 * Útil para validar a coverage de cadeia causal sobre todos os flows.
 *
 * @param {Array<object>} flows — array de smoke flows com replay e governance
 * @returns {{ allValid: boolean, results: Array, summary: object }}
 */
function validateSmokeFlowCausalChains(flows = []) {
  const results = flows.map((flow) => {
    const replay = flow.replay || {};
    const gov = replay.governance || flow.governance || {};
    return {
      journeyId: flow.journeyId,
      ...validateCausalChain({
        executionId: flow.executionId || gov.executionId || null,
        replayId: replay.id || replay.replayId || null,
        replayData: replay,
        correlationId: flow.correlationId || gov.correlationId || null,
        smokeFlow: flow,
      }),
    };
  });

  const allValid = results.every((r) => r.valid);
  const strongChains = results.filter((r) => r.strong).length;
  const validChains = results.filter((r) => r.valid).length;
  const allGaps = results.flatMap((r) => r.gaps.map((g) => ({ journeyId: r.journeyId, gap: g })));

  return {
    allValid,
    strongChains,
    validChains,
    totalFlows: results.length,
    allGaps,
    results,
    summary: {
      valid: `${validChains}/${results.length}`,
      strong: `${strongChains}/${results.length}`,
      gapCount: allGaps.length,
    },
  };
}

module.exports = {
  validateCausalChain,
  validateSmokeFlowCausalChains,
};
