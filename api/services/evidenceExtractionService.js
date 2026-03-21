'use strict';

const {
  compactText,
  normalizeText,
  extractBodyText,
  safeString,
  toArray,
  uniqEntities,
} = require('./evidenceUtils');

const CATEGORY_PATTERNS = [
  { key: 'authorization', terms: ['autoriz', 'consent', 'aceite', 'confirmado'] },
  { key: 'billing', terms: ['boleto', 'fatura', 'mensalidade', 'cobranca', 'reajuste', 'valor', 'pagamento', 'inadimpl'] },
  { key: 'contract', terms: ['contrato', 'termos', 'clausula', 'vigencia', 'renovacao'] },
  { key: 'communication', terms: ['informamos', 'comunicamos', 'reenviado', 'encaminhado', 'aviso', 'notific'] },
  { key: 'compliance', terms: ['politica', 'regulamento', 'compliance', 'lgpd', 'privacidade'] },
  { key: 'operational', terms: ['procedimento', 'acesso', 'liberado', 'bloqueado', 'orientamos'] },
  { key: 'sales', terms: ['proposta', 'oferta', 'condicao comercial', 'upgrade'] },
];

const TYPE_PATTERNS = [
  { key: 'consent_given', terms: ['autorizado', 'consentiu', 'de acordo', 'aceito', 'confirmo'] },
  { key: 'consent_denied', terms: ['nao autorizo', 'nao aceito', 'recusado', 'negado'] },
  { key: 'policy_notice', terms: ['politica', 'regulamento', 'conforme contrato', 'conforme politica'] },
  { key: 'price_notice', terms: ['reajuste', 'novo valor', 'nova mensalidade', 'preco'] },
  { key: 'terms_shared', terms: ['termos', 'contrato', 'clausula', 'regulamento'] },
  { key: 'confirmation', terms: ['confirmado', 'confirmamos', 'registrado', 'ciente'] },
  { key: 'warning', terms: ['alerta', 'atenção', 'warning', 'bloqueio', 'prazo final'] },
  { key: 'promise_made', terms: ['iremos', 'vamos enviar', 'retornaremos', 'prometemos'] },
  { key: 'instruction_given', terms: ['orientamos', 'instruimos', 'seguir', 'procedimento', 'passo a passo'] },
  { key: 'instruction_acknowledged', terms: ['entendido', 'ok farei', 'recebido', 'vou seguir'] },
];

const THEME_PATTERNS = [
  { key: 'price_adjustment', terms: ['reajuste', 'aumento', 'novo valor', 'preco'] },
  { key: 'cancellation', terms: ['cancelamento', 'cancelar', 'encerramento'] },
  { key: 'renewal', terms: ['renovacao', 'renovar', 'vigencia'] },
  { key: 'payment', terms: ['pagamento', 'boleto', 'fatura', 'pix', 'mensalidade'] },
  { key: 'access', terms: ['acesso', 'liberado', 'bloqueado', 'credencial'] },
  { key: 'delivery', terms: ['entrega', 'reenviado', 'enviado', 'anexo'] },
  { key: 'usage_limit', terms: ['limite', 'franquia', 'uso permitido'] },
  { key: 'authorization', terms: ['autorizacao', 'consentimento', 'aceite'] },
  { key: 'compliance', terms: ['politica', 'regulamento', 'privacidade', 'lgpd'] },
];

function createEvidenceExtractionService() {
  function scorePattern(text, patterns, defaultKey) {
    for (const pattern of patterns) {
      if (pattern.terms.some((term) => text.includes(term))) {
        return pattern.key;
      }
    }
    return defaultKey;
  }

  function inferActorType(item) {
    const actorType = safeString(item.actorType || item.actor_type).trim();
    if (actorType) return actorType;
    const source = safeString(item.sourceType || item.source || '').toLowerCase();
    if (source.includes('event_ledger')) return 'system';
    const direction = safeString(item.direction).toLowerCase();
    if (direction === 'outbound') return 'agent';
    if (direction === 'inbound') return 'customer';
    return null;
  }

  function inferStrength({ sourceType, actorType, attachments, confidence }) {
    if (sourceType === 'event_ledger' || sourceType === 'document') return 'formal';
    if (toArray(attachments).length > 0) return 'strong';
    if (actorType === 'agent' || actorType === 'system') return confidence >= 0.8 ? 'strong' : 'moderate';
    return confidence >= 0.75 ? 'moderate' : 'weak';
  }

  function extractEvidenceFromSource(item = {}, options = {}) {
    const sourceType = safeString(item.sourceType || item.source || 'system');
    const rawText = safeString(item.text || item.summary || extractBodyText(item.body) || item.title);
    const normalized = normalizeText(rawText);
    const eventType = normalizeText(item.eventType || item.type);
    const combinedText = `${normalized} ${eventType}`.trim();
    const attachments = toArray(item.attachments || item.metadata?.attachments);

    if (!combinedText) {
      return [];
    }

    const category = scorePattern(combinedText, CATEGORY_PATTERNS, sourceType === 'event_ledger' ? 'operational' : 'support');
    const type = scorePattern(combinedText, TYPE_PATTERNS, eventType.includes('consent') ? 'consent_given' : 'confirmation');
    const theme = scorePattern(combinedText, THEME_PATTERNS, null);

    let confidence = 0.35;
    if (category !== 'support') confidence += 0.12;
    if (type !== 'confirmation') confidence += 0.18;
    if (theme) confidence += 0.12;
    if (attachments.length > 0) confidence += 0.08;
    if (sourceType === 'event_ledger') confidence += 0.16;
    if (sourceType === 'ticket_note') confidence += 0.12;
    if (safeString(item.direction).toLowerCase() === 'outbound') confidence += 0.08;
    if (safeString(item.direction).toLowerCase() === 'inbound' && type === 'instruction_acknowledged') confidence += 0.1;

    const actorType = inferActorType(item);
    const strength = inferStrength({ sourceType, actorType, attachments, confidence });
    const excerpt = compactText(rawText, 420);
    const summaryBase = theme ? `${type.replace(/_/g, ' ')} sobre ${theme.replace(/_/g, ' ')}` : type.replace(/_/g, ' ');
    const summary = compactText(`${summaryBase} identificado em ${sourceType}`, 180);

    const hasSignal = confidence >= 0.5
      || type !== 'confirmation'
      || sourceType === 'event_ledger'
      || attachments.length > 0
      || options.includeWeak === true;

    if (!hasSignal) {
      return [];
    }

    return [{
      category,
      type,
      theme,
      summary,
      excerpt,
      normalizedText: normalized,
      confidence: Math.min(0.99, Number(confidence.toFixed(2))),
      strength,
      actorType,
      actorId: safeString(item.actorId || item.actor_id) || null,
      attachments,
      relatedEntities: uniqEntities(item.relatedEntities || []),
      metadata: {
        extractionVersion: 'v1',
        timelineType: safeString(item.type),
        eventType: safeString(item.eventType || item.type),
      },
    }];
  }

  return {
    extractEvidenceFromSource,
  };
}

module.exports = createEvidenceExtractionService();
module.exports.createEvidenceExtractionService = createEvidenceExtractionService;
