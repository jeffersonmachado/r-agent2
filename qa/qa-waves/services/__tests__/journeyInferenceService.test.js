'use strict';

jest.mock('../../../../api/services/aiProviderService', () => ({
  generateAiResponse: jest.fn(),
}));

const { generateAiResponse } = require('../../../../api/services/aiProviderService');
const {
  inferJourney,
  inferJourneyWithAI,
  resolveJourneyFromRegistry,
} = require('../journeyInferenceService');

describe('journeyInferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('inferJourneyWithAI lanca erro quando provider falha (sem fallback)', async () => {
    generateAiResponse.mockRejectedValue(new Error('provider unavailable'));

    const error = await inferJourneyWithAI({
      tenantId: 'system',
      vertical: 'fitness',
      scenarioName: 'Aula experimental para cliente novo',
      description: 'Fluxo de aula experimental com ativacao e retencao',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('provider unavailable');
    expect(error.code).toBe('AI_UNAVAILABLE');
  });

  test('resolveJourneyFromRegistry resolve journeyId explicito presente no registry', () => {
    const result = resolveJourneyFromRegistry({
      vertical: 'beauty',
      journeyId: 'beauty_booking',
      journeySource: 'manual',
    });

    expect(result).toEqual(expect.objectContaining({
      journeyId: 'beauty_booking',
      journeySource: 'manual',
    }));
    expect(result.steps).toContain('selecionar_servico');
  });

  test('resolveJourneyFromRegistry retorna null para journeyId ausente ou desconhecido', () => {
    expect(resolveJourneyFromRegistry({ vertical: 'beauty' })).toBeNull();
    expect(resolveJourneyFromRegistry({ vertical: 'beauty', journeyId: 'jornada_inexistente' })).toBeNull();
  });

  test('inferJourney com journeyId desconhecido falha com JOURNEY_NOT_FOUND (sem fallback heuristico)', async () => {
    const error = await inferJourney({
      vertical: 'beauty',
      journeyId: 'jornada_inexistente',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('JOURNEY_NOT_FOUND');
    expect(generateAiResponse).not.toHaveBeenCalled();
  });

  test('inferJourney sem journeyId delega para a IA (sem fallback heuristico)', async () => {
    generateAiResponse.mockResolvedValue({
      text: JSON.stringify({ journeyId: 'beauty_booking', steps: ['selecionar_servico'] }),
    });

    const result = await inferJourney({
      tenantId: 'system',
      vertical: 'beauty',
      scenarioName: 'Agendamento beauty',
      description: 'Cliente seleciona servico e agenda atendimento',
    });

    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      journeyId: 'beauty_booking',
      journeySource: 'ai',
    }));
  });
});
