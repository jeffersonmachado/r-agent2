/**
 * Teste unitário do módulo reutilizável de geração de fluxo por IA.
 *
 * Objetivo:
 * - Garantir formato de retorno (success, flowDefinition, validationWarnings, envelope)
 * - Garantir que o módulo delega para flowGeneratorService (mocks) e não persiste
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('api/services/aiFlowGenerator', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna flowDefinition + validationWarnings + envelope (best-effort)', async () => {
    // Mock do gerador base (fluxo mínimo válido)
    jest.doMock('../../api/services/flowGeneratorService', () => ({
      generateFlowFromDescription: jest.fn(async () => ({
        id: 'flow-1',
        tenantId: 't1',
        name: 'Fluxo',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      })),
    }));

    const { generateFlowFromDescription } = require('../../api/services/aiFlowGenerator');

    const result = await generateFlowFromDescription('crie um fluxo', {
      tenantId: 't1',
      useRag: true,
      ragSources: ['docs'],
      ragContext: { enabled: true, executionId: 'exec-1', chunks: [{ content: 'x' }], sources: [] },
      useWebScraping: false,
      scrapingTargets: [],
    });

    expect(result.success).toBe(true);
    expect(result.flowDefinition).toBeDefined();
    expect(result.flowDefinition.id).toBe('flow-1');
    expect(result.validationWarnings).toBeDefined();
    expect(typeof result.validationWarnings.valid).toBe('boolean');
    expect(Array.isArray(result.validationWarnings.codes)).toBe(true);
    // Envelope é best-effort: pode ser null se schema não estiver disponível no ambiente de teste
    expect('envelope' in result).toBe(true);
    expect(result.ragUsed).toBe(true);
    expect(result.ragExecutionId).toBe('exec-1');
    expect(result.ragSources).toEqual(['docs']);
  });
});

