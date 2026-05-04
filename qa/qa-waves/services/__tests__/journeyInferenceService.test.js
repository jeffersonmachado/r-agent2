'use strict';

jest.mock('../../../../api/services/aiProviderService', () => ({
  generateAiResponse: jest.fn(),
}));

const { generateAiResponse } = require('../../../../api/services/aiProviderService');
const {
  inferJourneyWithAI,
  inferJourneyHeuristically,
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

  test('inferJourneyHeuristically respeita journeyId explicito sem quebrar compatibilidade', () => {
    const result = inferJourneyHeuristically({
      vertical: 'beauty',
      journeyId: 'beauty_booking',
      scenarioName: 'Agendamento beauty',
      description: 'Cliente seleciona servico e agenda atendimento',
      journeySource: 'manual',
    });

    expect(result).toEqual(expect.objectContaining({
      journeyId: 'beauty_booking',
      journeySource: 'manual',
    }));
    expect(result.steps).toContain('selecionar_servico');
  });
});