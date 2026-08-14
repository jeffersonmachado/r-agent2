'use strict';

/**
 * computeMisalignment é IA-first: a análise de desalinhamento é semântica,
 * delegada ao provider de IA do tenant. Estes testes fixam o contrato:
 * parsing defensivo da resposta, coerção de severidade e comportamento
 * fail-visible (analysis_unavailable) quando a IA não está disponível —
 * nunca fallback para heurística de strings.
 */

jest.mock('../../api/services/aiProviderService', () => ({
  generateAiResponse: jest.fn(),
}));

const { generateAiResponse } = require('../../api/services/aiProviderService');
const { computeMisalignment } = require('../../api/services/journeyReviewService');

const baseScenario = {
  name: 'Cenário atual',
  steps: [{ type: 'open_page', description: 'Abrir página de tarefas' }],
  seeds: [{ id: 's1' }],
  validators: [{ type: 'v1' }],
  platformScenarioIds: ['tasks-ui'],
};

const inferredScenario = {
  name: 'Proposta',
  steps: [{ type: 'navigate', description: 'Navegar até tarefas' }],
  seeds: [],
  validators: [],
  platformScenarioIds: ['tasks-ui'],
};

describe('journeyReviewService.computeMisalignment (IA-first)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devolve missing_proposal quando a proposta está ausente (sem chamar IA)', async () => {
    const result = await computeMisalignment(baseScenario, null);

    expect(result).toEqual([
      expect.objectContaining({ type: 'missing_proposal', severity: 'critical' }),
    ]);
    expect(generateAiResponse).not.toHaveBeenCalled();
  });

  it('interpreta o array JSON da IA e preserva type/severity/message', async () => {
    generateAiResponse.mockResolvedValue({
      text: '[{"type":"steps_semantic_gap","severity":"warning","message":"Passo de confirmação ausente no cenário atual."}]',
    });

    const result = await computeMisalignment(baseScenario, inferredScenario, 'system');

    expect(result).toEqual([
      { type: 'steps_semantic_gap', severity: 'warning', message: 'Passo de confirmação ausente no cenário atual.' },
    ]);
    expect(generateAiResponse).toHaveBeenCalledWith(
      expect.stringContaining('CENÁRIO ATUAL'),
      'system',
      expect.objectContaining({ source: 'journey-review' }),
    );
  });

  it('tolera markdown ao redor do JSON e coage severidade desconhecida para info', async () => {
    generateAiResponse.mockResolvedValue({
      text: '```json\n[{"type":"aligned","severity":"HIGH","message":"Alinhado."}]\n```',
    });

    const result = await computeMisalignment(baseScenario, inferredScenario);

    expect(result).toEqual([{ type: 'aligned', severity: 'info', message: 'Alinhado.' }]);
  });

  it('fail-visible quando não há provider de IA (sem fallback heurístico)', async () => {
    generateAiResponse.mockRejectedValue(new Error('Nenhum provider de IA configurado para tenant: system'));

    const result = await computeMisalignment(baseScenario, inferredScenario, 'system');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('analysis_unavailable');
    expect(result[0].severity).toBe('warning');
    expect(result[0].message).toContain('Nenhum provider de IA configurado');
  });

  it('fail-visible quando a resposta da IA não é JSON', async () => {
    generateAiResponse.mockResolvedValue({ text: 'não sei analisar isso' });

    const result = await computeMisalignment(baseScenario, inferredScenario);

    expect(result[0].type).toBe('analysis_unavailable');
  });

  it('fail-visible quando o JSON da IA não contém itens utilizáveis', async () => {
    generateAiResponse.mockResolvedValue({ text: '[{"foo":1},{"severity":"critical"}]' });

    const result = await computeMisalignment(baseScenario, inferredScenario);

    expect(result[0].type).toBe('analysis_unavailable');
  });
});
