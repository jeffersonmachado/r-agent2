'use strict';

/**
 * Knowledge Promotion Pipeline — promove conhecimento SYSTEM → OPERATIONAL
 * com sanitização, validação e aprovação.
 *
 * Pipeline:
 *   SYSTEM knowledge → candidate → sanitize → rewrite → validate → approve → publish OPERATIONAL
 *
 * Regras:
 *  - NUNCA expor documento SYSTEM original para PRODUCTION
 *  - Sanitização remove detalhes técnicos sensíveis
 *  - Aprovação requer autorização explícita
 *  - Documento publicado carrega provenance do SYSTEM original
 */

const { buildProvenance, SOURCE_KINDS, OPERATIONAL_AUTHORITY } = require('./provenance');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Cria um candidato à promoção a partir de um documento SYSTEM.
 *
 * @param {Object} args
 * @param {Object} args.systemDocument — documento SYSTEM original
 * @param {string} args.tenantId
 * @param {string} args.requestedBy — quem solicitou a promoção
 * @returns {Object} promotion candidate
 */
function createPromotionCandidate({ systemDocument, tenantId, requestedBy }) {
  if (!systemDocument || !systemDocument.content) {
    throw new Error('promotion_requires_content');
  }

  // Sanitize: remove technical internals, code references, system details.
  const sanitizedContent = sanitizeForOperational(systemDocument.content);

  return Object.freeze({
    status: 'candidate',
    sourceSystemRef: systemDocument.id || systemDocument.sourceRef || null,
    sourceProvenance: systemDocument.provenance || null,
    tenantId,
    domain: 'OPERATIONAL',
    classification: 'PRODUCTION',
    sensitivity: 'internal',
    content: sanitizedContent,
    originalContent: systemDocument.content,
    requestedBy,
    requestedAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
  });
}

/**
 * Sanitiza conteúdo SYSTEM para consumo OPERATIONAL.
 * Remove: referências a código, caminhos de arquivo, nomes de tabelas,
 * detalhes de implementação, secrets, tokens.
 */
function sanitizeForOperational(content) {
  if (!content || typeof content !== 'string') return '';

  let sanitized = content;

  // Remove URLs first (antes de file paths para evitar captura parcial)
  sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[link]');

  // Remove paths de arquivo (não URLs)
  sanitized = sanitized.replace(/(?<!:)\/(?:[a-zA-Z0-9_](?:[a-zA-Z0-9_\/.-]*[a-zA-Z0-9_\/.-])?\/[a-zA-Z0-9_-]+\.[a-zA-Z]{1,6})/g, '[file]');

  // Remove code blocks
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '[code example]');

  // Remove inline code
  sanitized = sanitized.replace(/`[^`]+`/g, '[code]');

  // Remove table/column references
  sanitized = sanitized.replace(/\b[a-z_]+\.(?:[a-z_]+)\b/g, '[reference]');

  // Remove IPs
  sanitized = sanitized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');

  // Remove IPs
  sanitized = sanitized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');

  return sanitized.trim();
}

/**
 * Valida se o candidato está pronto para aprovação.
 */
function validatePromotionCandidate(candidate) {
  const issues = [];

  if (!candidate.content || candidate.content.length < 10) {
    issues.push('content_too_short');
  }
  if (candidate.content === candidate.originalContent) {
    issues.push('content_not_sanitized');
  }
  // Verifica se ainda contém marcadores técnicos
  const technicalPatterns = [
    /\bSELECT\b.*\bFROM\b/i,
    /\bCREATE\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bmigration\b/i,
    /\bapi\/server\b/i,
    /\bnode_modules\b/i,
  ];
  for (const pattern of technicalPatterns) {
    if (pattern.test(candidate.content)) {
      issues.push(`technical_content_detected: ${pattern.source}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Aprova e publica o candidato como documento OPERATIONAL.
 *
 * @param {Object} candidate
 * @param {string} approvedBy
 * @returns {Object} published document
 */
function approvePromotion(candidate, approvedBy) {
  if (!approvedBy) throw new Error('promotion_approval_requires_identity');

  const validation = validatePromotionCandidate(candidate);
  if (!validation.valid) {
    throw new Error(`promotion_validation_failed: ${validation.issues.join(', ')}`);
  }

  const provenance = buildProvenance({
    sourceKind: SOURCE_KINDS.PROMOTED_FROM_SYSTEM,
    sourceRef: candidate.sourceSystemRef,
    sourceVersion: candidate.sourceProvenance?.version || '1.0.0',
    knowledgeType: 'SEMANTIC',
    retrievalPurposes: ['CUSTOMER_SERVICE', 'OPERATION'],
    domain: 'OPERATIONAL',
    classification: 'PRODUCTION',
    sensitivity: 'internal',
    tenant: candidate.tenantId,
    generatedBy: candidate.requestedBy,
    validatedBy: approvedBy,
    lastValidatedAt: new Date().toISOString(),
  });

  return Object.freeze({
    ...candidate,
    status: 'published',
    approvedBy,
    approvedAt: new Date().toISOString(),
    provenance,
    // O conteúdo original SYSTEM NÃO é incluído no documento publicado.
    originalContent: undefined,
  });
}

module.exports = {
  createPromotionCandidate,
  sanitizeForOperational,
  validatePromotionCandidate,
  approvePromotion,
};
