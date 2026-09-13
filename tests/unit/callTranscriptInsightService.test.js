'use strict';

/**
 * Testes unitários do callTranscriptInsightService (P5.15).
 * Provider de IA mockado via engine/aiProviderManager.
 */

const { getAiProviderForTenant } = require('../../api/services/aiProviderManager.js');
const logger = require('../../api/utils/logger');

jest.mock('../../api/services/aiProviderManager.js', () => ({
  getAiProviderForTenant: jest.fn(),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const service = require('../../api/services/voice/callTranscriptInsightService');

const VALID_JSON = JSON.stringify({
  intent: 'reagendar',
  summary: 'Cliente quer remarcar a consulta de sexta-feira.',
  urgency: 'alta',
  suggestedAction: 'Oferecer novos horários ainda hoje',
});

describe('services/voice/callTranscriptInsightService', () => {
  beforeEach(() => {
    getAiProviderForTenant.mockReset();
  });

  it('retorna insight sanitizado quando o provider responde JSON válido', async () => {
    getAiProviderForTenant.mockReturnValue({ id: 'openai', generate: jest.fn().mockResolvedValue({ text: VALID_JSON, provider: 'openai' }) });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'quero remarcar' });

    expect(insight).toMatchObject({
      intent: 'reagendar',
      summary: 'Cliente quer remarcar a consulta de sexta-feira.',
      urgency: 'alta',
      suggestedAction: 'Oferecer novos horários ainda hoje',
      provider: 'openai',
    });
    expect(insight.analyzedAt).toBeTruthy();
  });

  it('aceita JSON dentro de bloco markdown', async () => {
    getAiProviderForTenant.mockReturnValue({ generate: jest.fn().mockResolvedValue(`\`\`\`json\n${VALID_JSON}\n\`\`\``) });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'x'.repeat(20) });

    expect(insight.intent).toBe('reagendar');
  });

  it('intent fora da allowlist → null (fail-soft, nunca inventa)', async () => {
    getAiProviderForTenant.mockReturnValue({
      generate: jest.fn().mockResolvedValue(JSON.stringify({ intent: 'hackear_sistema', summary: 'x', urgency: 'alta' })),
    });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'texto suficiente' });

    expect(insight).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('JSON inválido → null', async () => {
    getAiProviderForTenant.mockReturnValue({ generate: jest.fn().mockResolvedValue('não sei analisar isso') });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'texto suficiente' });

    expect(insight).toBeNull();
  });

  it('sem provider para o tenant → null sem lançar', async () => {
    getAiProviderForTenant.mockImplementation(() => { throw new Error('Nenhum provider de IA disponível'); });

    const insight = await service.analyzeCallTranscript({ tenantId: 't-sem-ia', transcript: 'texto' });

    expect(insight).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('provider que falha → null (fail-soft)', async () => {
    getAiProviderForTenant.mockReturnValue({ generate: jest.fn().mockRejectedValue(new Error('openai down')) });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'texto' });

    expect(insight).toBeNull();
  });

  it('transcrição vazia/ausente → null sem chamar IA', async () => {
    const generate = jest.fn();
    getAiProviderForTenant.mockReturnValue({ generate });

    expect(await service.analyzeCallTranscript({ tenantId: 't1', transcript: '' })).toBeNull();
    expect(await service.analyzeCallTranscript({ tenantId: 't1' })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('urgency fora da allowlist cai para media', async () => {
    getAiProviderForTenant.mockReturnValue({
      generate: jest.fn().mockResolvedValue(JSON.stringify({ intent: 'duvida', summary: 'Cliente perguntou sobre horário.', urgency: 'urgentissima' })),
    });

    const insight = await service.analyzeCallTranscript({ tenantId: 't1', transcript: 'texto' });

    expect(insight.urgency).toBe('media');
  });
});
