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
  { key: 'terms_shared', terms: ['enviamos os termos', 'termos enviados', 'compartilhamos o contrato', 'reenviamos o contrato'] },
  { key: 'consent_given', terms: ['autorizado', 'consentiu', 'de acordo', 'aceito', 'confirmo'] },
  { key: 'consent_denied', terms: ['nao autorizo', 'nao aceito', 'recusado', 'negado'] },
  { key: 'policy_notice', terms: ['politica', 'regulamento', 'conforme contrato', 'conforme politica'] },
  { key: 'price_notice', terms: ['reajuste', 'novo valor', 'nova mensalidade', 'preco'] },
  { key: 'terms_shared', terms: ['termos', 'contrato', 'clausula', 'regulamento'] },
  { key: 'confirmation', terms: ['confirmado', 'confirmamos', 'registrado', 'ciente'] },
  { key: 'confirmation', terms: ['confirmou', 'confirmacao', 'confirmada'] },
  { key: 'warning', terms: ['alerta', 'atenção', 'warning', 'bloqueio', 'prazo final'] },
  { key: 'promise_made', terms: ['iremos', 'vamos enviar', 'retornaremos', 'prometemos'] },
  { key: 'instruction_given', terms: ['orientamos', 'instruimos', 'seguir', 'procedimento', 'passo a passo'] },
  { key: 'instruction_acknowledged', terms: ['entendido', 'ok farei', 'recebido', 'vou seguir'] },
  { key: 'instruction_acknowledged', terms: ['cliente confirmou o procedimento', 'cliente entendeu a orientacao'] },
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

  function findPatternMatches(text, patterns) {
    return patterns.filter((pattern) => pattern.terms.some((term) => text.includes(term)));
  }

  function hasNegation(text, terms = []) {
    return terms.some((term) => text.includes(`nao ${term}`) || text.includes(`não ${term}`));
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
    if (sourceType === 'ticket_note') return confidence >= 0.8 ? 'formal' : 'strong';
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
    const matchedTypePatterns = findPatternMatches(combinedText, TYPE_PATTERNS);
    const baseType = scorePattern(combinedText, TYPE_PATTERNS, eventType.includes('consent') ? 'consent_given' : 'confirmation');
    const theme = scorePattern(combinedText, THEME_PATTERNS, null);

    let confidence = 0.35;
    if (category !== 'support') confidence += 0.12;
    if (baseType !== 'confirmation') confidence += 0.18;
    if (theme) confidence += 0.12;
    if (attachments.length > 0) confidence += 0.08;
    if (sourceType === 'event_ledger') confidence += 0.16;
    if (sourceType === 'document') confidence += 0.18;
    if (sourceType === 'ticket_note') confidence += 0.12;
    if (safeString(item.direction).toLowerCase() === 'outbound') confidence += 0.08;
    if (safeString(item.direction).toLowerCase() === 'inbound' && baseType === 'instruction_acknowledged') confidence += 0.1;

    const actorType = inferActorType(item);
    const strength = inferStrength({ sourceType, actorType, attachments, confidence });
    const excerpt = compactText(rawText, 420);
    const types = new Set([baseType]);

    for (const pattern of matchedTypePatterns) {
      types.add(pattern.key);
    }

    if (combinedText.includes('reenviado') || combinedText.includes('reenviamos')) {
      types.add('terms_shared');
    }
    if (combinedText.includes('informamos') || combinedText.includes('comunicamos')) {
      types.add(theme === 'price_adjustment' ? 'price_notice' : 'policy_notice');
    }
    if (combinedText.includes('autoriz') && !hasNegation(combinedText, ['autorizo', 'autorizado'])) {
      types.add('consent_given');
    }
    if (hasNegation(combinedText, ['aceito', 'autorizo', 'autorizado'])) {
      types.add('consent_denied');
      confidence = Math.max(confidence, 0.72);
    }
    if (combinedText.includes('nao foi informado') || combinedText.includes('não foi informado')) {
      types.delete('policy_notice');
      types.delete('price_notice');
      confidence = Math.min(confidence, 0.45);
    }
    if (combinedText.includes('nao aceitou') || combinedText.includes('não aceitou')) {
      types.delete('consent_given');
      types.add('consent_denied');
    }
    if (combinedText.includes('nao autorizou') || combinedText.includes('não autorizou')) {
      types.delete('consent_given');
      types.add('consent_denied');
    }

    const hasSignal = confidence >= 0.5
      || baseType !== 'confirmation'
      || sourceType === 'event_ledger'
      || sourceType === 'document'
      || attachments.length > 0
      || options.includeWeak === true;

    if (!hasSignal) {
      return [];
    }

    const evidenceList = [];
    for (const type of types) {
      if (!type) continue;
      if (type === 'consent_given' && hasNegation(combinedText, ['aceito', 'autorizo', 'autorizado'])) continue;
      if ((type === 'policy_notice' || type === 'price_notice') && (combinedText.includes('nao foi informado') || combinedText.includes('não foi informado'))) continue;
      const summaryBase = theme ? `${type.replace(/_/g, ' ')} sobre ${theme.replace(/_/g, ' ')}` : type.replace(/_/g, ' ');
      const summary = compactText(`${summaryBase} identificado em ${sourceType}`, 180);
      evidenceList.push({
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
          extractionVersion: 'v2',
          timelineType: safeString(item.type),
          eventType: safeString(item.eventType || item.type),
          sourceType,
        },
      });
    }

    return evidenceList;
  }

  return {
    extractEvidenceFromSource,
  };
}

module.exports = createEvidenceExtractionService();
module.exports.createEvidenceExtractionService = createEvidenceExtractionService;
