/**
 * Validador de Evidência - Governança Epistemológica
 * 
 * Responsabilidades:
 * - Validar se há evidência suficiente para permitir resposta da IA
 * - Determinar se sistema deve abster
 * - Detectar inconsistências entre fontes
 * - Aplicar critérios do contrato de evidência
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Nenhuma resposta sem evidência verificável
 * - Abstenção é estado legítimo
 * - Sistema decide evidência, não a IA
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Carrega o contrato de evidência.
 * 
 * @returns {Object|null} Contrato de evidência ou null
 */
function loadEvidenceContract() {
  try {
    const contractPath = path.join(__dirname, '..', '..', 'contracts', 'evidence.contract.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('[evidenceValidator] Contrato de evidência não encontrado');
      return null;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error('[evidenceValidator] Erro ao carregar contrato de evidência', err);
    return null;
  }
}

/**
 * Valida se há evidência suficiente para RAG.
 * 
 * @param {Object} ragContext - Contexto RAG construído
 * @param {Object} contract - Contrato de evidência
 * @returns {Object} {sufficient: boolean, reason?: string, code?: string}
 */
function validateRagEvidence(ragContext, contract) {
  if (!ragContext || !ragContext.success) {
    return {
      sufficient: false,
      reason: 'Contexto RAG não está disponível ou falhou',
      code: 'RAG_REQUIRED_BUT_MISSING',
    };
  }

  const sufficiency = contract.evidence?.sufficiency?.rag || {};
  const minChunks = sufficiency.minChunks || 3;
  const minSources = sufficiency.minSources || 1;
  const minConfidence = sufficiency.minConfidence || 0.45;

  const chunksCount = ragContext.chunks?.length || 0;
  const sourcesCount = ragContext.sources?.length || 0;

  // Valida quantidade mínima de chunks
  if (chunksCount < minChunks) {
    return {
      sufficient: false,
      reason: `RAG retornou apenas ${chunksCount} chunks, mínimo requerido: ${minChunks}`,
      code: 'INSUFFICIENT_EVIDENCE',
      details: {
        chunksCount,
        minChunks,
        sourcesCount,
      },
    };
  }

  // Valida quantidade mínima de fontes
  if (sourcesCount < minSources) {
    return {
      sufficient: false,
      reason: `RAG retornou apenas ${sourcesCount} fonte(s), mínimo requerido: ${minSources}`,
      code: 'INSUFFICIENT_EVIDENCE',
      details: {
        chunksCount,
        sourcesCount,
        minSources,
      },
    };
  }

  // Valida confidence mínimo (se disponível)
  if (ragContext.chunks && ragContext.chunks.length > 0) {
    const avgConfidence = ragContext.chunks.reduce((sum, chunk) => {
      return sum + (chunk.score || chunk.confidence || 0);
    }, 0) / chunksCount;

    if (avgConfidence < minConfidence) {
      return {
        sufficient: false,
        reason: `Confiança média dos chunks (${avgConfidence.toFixed(3)}) está abaixo do mínimo (${minConfidence})`,
        code: 'LOW_CONFIDENCE',
        details: {
          avgConfidence,
          minConfidence,
          chunksCount,
        },
      };
    }
  }

  return {
    sufficient: true,
    details: {
      chunksCount,
      sourcesCount,
      minChunks,
      minSources,
    },
  };
}

/**
 * Detecta inconsistências entre fontes.
 * 
 * @param {Object} ragContext - Contexto RAG construído
 * @param {Object} contract - Contrato de evidência
 * @returns {Object} {inconsistent: boolean, reason?: string, code?: string}
 */
function detectInconsistency(ragContext, contract) {
  if (!ragContext || !ragContext.chunks || ragContext.chunks.length < 2) {
    return { inconsistent: false };
  }

  const inconsistency = contract.evidence?.inconsistency || {};
  if (!inconsistency.detection?.enabled) {
    return { inconsistent: false };
  }

  const maxVariance = inconsistency.detection.maxConfidenceVariance || 0.3;
  const chunks = ragContext.chunks;

  // Calcula variância de confidence
  const confidences = chunks.map(c => c.score || c.confidence || 0);
  const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const variance = confidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / confidences.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev > maxVariance) {
    return {
      inconsistent: true,
      reason: `Grande variação de confidence entre chunks (desvio padrão: ${stdDev.toFixed(3)})`,
      code: 'INCONSISTENT_SOURCES',
      details: {
        stdDev,
        maxVariance,
        avgConfidence,
      },
    };
  }

  return { inconsistent: false };
}

/**
 * Valida evidência suficiente para permitir resposta da IA.
 * 
 * @param {Object} execution - Contexto da execução
 * @returns {Object} {sufficient: boolean, shouldAbstain: boolean, reason?: string, code?: string}
 */
function validateEvidence(execution) {
  const useRag = execution.payload?.useRag !== false;
  const contract = loadEvidenceContract();

  if (!contract) {
    logger.error('[evidenceValidator] Contrato de evidência não encontrado');
    return {
      sufficient: false,
      shouldAbstain: true,
      reason: 'Contrato de evidência não encontrado',
      code: 'MISSING_CONTRACT',
    };
  }

  // Se RAG não está habilitado, não há evidência (mas pode ser permitido se não for obrigatório)
  if (!useRag) {
    // Por padrão, sem RAG = sem evidência = abstenção
    // Mas isso pode ser configurável no contrato
    return {
      sufficient: false,
      shouldAbstain: true,
      reason: 'RAG não está habilitado. Sem evidência, sistema deve abster.',
      code: 'INSUFFICIENT_EVIDENCE',
    };
  }

  // Valida evidência RAG
  const ragValidation = validateRagEvidence(execution.ragContext, contract);
  if (!ragValidation.sufficient) {
    return {
      sufficient: false,
      shouldAbstain: true,
      reason: ragValidation.reason,
      code: ragValidation.code,
      details: ragValidation.details,
    };
  }

  // Detecta inconsistências
  const inconsistency = detectInconsistency(execution.ragContext, contract);
  if (inconsistency.inconsistent) {
    return {
      sufficient: false,
      shouldAbstain: true,
      reason: inconsistency.reason,
      code: inconsistency.code,
      details: inconsistency.details,
    };
  }

  return {
    sufficient: true,
    shouldAbstain: false,
    details: ragValidation.details,
  };
}

module.exports = {
  validateEvidence,
  validateRagEvidence,
  detectInconsistency,
  loadEvidenceContract,
};

