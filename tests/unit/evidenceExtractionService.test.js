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

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      category: 'billing',
      type: 'policy_notice',
      theme: 'price_adjustment',
    }));
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

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      category: 'authorization',
      type: 'consent_given',
      strength: 'formal',
    }));
  });
});
