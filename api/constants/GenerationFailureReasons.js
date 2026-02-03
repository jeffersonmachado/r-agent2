/**
 * Enum centralizado para motivos de falha terminal no pipeline de geração.
 * Mantém strings estáveis para analytics, auditoria e UI.
 */

const GenerationFailureReasons = Object.freeze({
  SUGGEST_DESCRIPTION_FAILED: 'SUGGEST_DESCRIPTION_FAILED',
  INVALID_PROVIDER: 'INVALID_PROVIDER',
  RAG_UNAVAILABLE: 'RAG_UNAVAILABLE',
  SCRAPING_EMPTY: 'SCRAPING_EMPTY',
  QUESTIONS_GENERATION_FAILED: 'QUESTIONS_GENERATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  PIPELINE_STAGE_FAILED: 'PIPELINE_STAGE_FAILED',
  UNKNOWN: 'UNKNOWN',
});

module.exports = { GenerationFailureReasons };

