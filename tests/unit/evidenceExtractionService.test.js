'use strict';

const { createEvidenceExtractionService } = require('../../api/services/evidenceExtractionService');

describe('evidenceExtractionService', () => {
  const service = createEvidenceExtractionService();

  test('extrai evidência genérica de aviso de preço sem hardcode vertical', () => {
    const result = service.extractEvidenceFromSource({
      id: 'msg-1',
      source: 'channel_message',
      sourceType: 'channel_message',
      direction: 'outbound',
      text: 'Informamos o novo valor do contrato e o reajuste previsto em política vigente.',
      relatedEntities: [{ type: 'ticket', id: 't1' }],
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({
      category: 'billing',
      type: expect.stringMatching(/policy_notice|price_notice/),
      theme: 'price_adjustment',
    })]));
    expect(result[0].confidence).toBeGreaterThan(0.5);
  });

  test('extrai evidência formal de event ledger com autorização', () => {
    const result = service.extractEvidenceFromSource({
      id: 'evt-1',
      source: 'event_ledger',
      sourceType: 'event_ledger',
      eventType: 'ConsentRegistered',
      text: 'Cliente autorizado e consentiu com os termos do procedimento.',
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({
      category: 'authorization',
      type: 'consent_given',
      strength: 'formal',
    })]));
  });

  test('evita falso positivo de consentimento quando houver negação explícita', () => {
    const result = service.extractEvidenceFromSource({
      id: 'msg-2',
      source: 'ticket_message',
      sourceType: 'ticket_message',
      direction: 'inbound',
      text: 'Cliente informou que não aceitou e não autorizou a alteração.',
    });

    expect(result.some((item) => item.type === 'consent_given')).toBe(false);
    expect(result.some((item) => item.type === 'consent_denied')).toBe(true);
  });

  test('permite múltiplas evidências úteis na mesma fonte quando houver comunicação e reenvio', () => {
    const result = service.extractEvidenceFromSource({
      id: 'msg-3',
      source: 'channel_message',
      sourceType: 'channel_message',
      direction: 'outbound',
      text: 'Informamos o reajuste previsto em política vigente e reenviamos os termos do contrato em anexo.',
      metadata: { attachments: [{ url: 'https://example.test/contrato.pdf' }] },
    });

    expect(result.length).toBeGreaterThan(1);
    expect(result.some((item) => item.type === 'price_notice' || item.type === 'policy_notice')).toBe(true);
    expect(result.some((item) => item.type === 'terms_shared')).toBe(true);
  });
});
