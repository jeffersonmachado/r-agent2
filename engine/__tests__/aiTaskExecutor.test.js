/**
 * Testes para aiTaskExecutor.js
 */

const {
  executeAiTask,
  executeIntentClassification,
  executeEntityExtraction,
  executeTextNormalization,
  executeAssistedResponse,
} = require('../utils/aiTaskExecutor');

describe('aiTaskExecutor', () => {
  describe('executeIntentClassification', () => {
    test('deve classificar intenção baseada em palavras-chave', async () => {
      const config = {
        keywords: {
          comprar: ['comprar', 'quero comprar'],
          suporte: ['ajuda', 'problema'],
        },
      };

      const result = await executeIntentClassification('quero comprar', config);

      expect(result.value).toBe('comprar');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test('deve retornar fallback quando não há match', async () => {
      const config = {
        fallback: 'desconhecido',
        keywords: {
          comprar: ['comprar'],
        },
      };

      const result = await executeIntentClassification('texto sem match', config);

      expect(result.value).toBeNull();
      expect(result._noMatch).toBe(true);
    });

    test('deve usar palavras-chave padrão quando não configuradas', async () => {
      const result = await executeIntentClassification('preciso de ajuda', {});

      expect(result.value).toBe('suporte');
    });

    test('deve respeitar allowedOutputs', async () => {
      const config = {
        allowedOutputs: ['comprar'],
        keywords: {
          comprar: ['comprar'],
          suporte: ['ajuda'],
        },
      };

      const result = await executeIntentClassification('preciso de ajuda', config);

      // Não deve retornar 'suporte' porque não está em allowedOutputs
      expect(result.value).not.toBe('suporte');
    });

    test('deve calcular confiança corretamente', async () => {
      const config = {
        keywords: {
          comprar: ['comprar'],
        },
      };

      const result = await executeIntentClassification('comprar', config);

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });

    test('deve usar confidenceThreshold', async () => {
      const config = {
        confidenceThreshold: 0.9,
        keywords: {
          comprar: ['comprar'],
        },
      };

      const result = await executeIntentClassification('comprar', config);

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('executeEntityExtraction', () => {
    test('deve extrair emails', async () => {
      const result = await executeEntityExtraction('Meu email é teste@example.com', {});

      expect(result.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'email',
            value: 'teste@example.com',
          }),
        ])
      );
    });

    test('deve extrair telefones', async () => {
      const result = await executeEntityExtraction('Meu telefone é 11987654321', {});

      expect(result.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'phone',
          }),
        ])
      );
    });

    test('deve extrair números', async () => {
      const result = await executeEntityExtraction('O valor é 123.45', {});

      expect(result.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'number',
          }),
        ])
      );
    });

    test('deve retornar array vazio quando não há entidades', async () => {
      const result = await executeEntityExtraction('Texto sem entidades', {});

      expect(result.entities).toEqual([]);
    });

    test('deve extrair múltiplas entidades', async () => {
      const result = await executeEntityExtraction(
        'Email: teste@example.com, Telefone: 11987654321',
        {}
      );

      expect(result.entities.length).toBeGreaterThan(1);
    });
  });

  describe('executeTextNormalization', () => {
    test('deve normalizar texto para minúsculas', async () => {
      const result = await executeTextNormalization('TEXTO EM MAIÚSCULAS', {});

      expect(result.normalized).toBe('texto em maiusculas');
    });

    test('deve remover acentos', async () => {
      const result = await executeTextNormalization('café', {});

      expect(result.normalized).toBe('cafe');
    });

    test('deve remover espaços extras', async () => {
      const result = await executeTextNormalization('texto   com    espaços', {});

      expect(result.normalized).toBe('texto com espacos');
    });

    test('deve retornar confiança', async () => {
      const result = await executeTextNormalization('texto', {});

      expect(result.confidence).toBe(0.9);
    });

    test('deve lidar com string vazia', async () => {
      const result = await executeTextNormalization('', {});

      expect(result.normalized).toBe('');
    });
  });

  describe('executeAssistedResponse', () => {
    test('deve gerar resposta padrão', async () => {
      const result = await executeAssistedResponse('texto', {}, {});

      expect(result.response).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('deve gerar resposta diferente para perguntas', async () => {
      const result = await executeAssistedResponse('Como funciona?', {}, {});

      expect(result.response).toContain('verificar');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('deve gerar resposta para textos longos', async () => {
      const longText = 'a'.repeat(100);
      const result = await executeAssistedResponse(longText, {}, {});

      expect(result.response).toContain('processar');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('deve usar contexto quando fornecido', async () => {
      const context = { variables: { nome: 'João' } };
      const result = await executeAssistedResponse('texto', {}, context);

      expect(result.response).toBeDefined();
    });
  });

  describe('executeAiTask', () => {
    test('deve executar intent_classification', async () => {
      const result = await executeAiTask('intent_classification', 'comprar', {
        keywords: { comprar: ['comprar'] },
      });

      expect(result.value).toBe('comprar');
    });

    test('deve executar entity_extraction', async () => {
      const result = await executeAiTask('entity_extraction', 'teste@example.com', {});

      expect(result.entities).toBeDefined();
    });

    test('deve executar text_normalization', async () => {
      const result = await executeAiTask('text_normalization', 'TEXTO', {});

      expect(result.normalized).toBe('texto');
    });

    test('deve executar assisted_response', async () => {
      const result = await executeAiTask('assisted_response', 'texto', {}, {});

      expect(result.response).toBeDefined();
    });

    test('deve lançar erro para tarefa inválida', async () => {
      await expect(executeAiTask(null, 'input', {})).rejects.toThrow();
      await expect(executeAiTask('', 'input', {})).rejects.toThrow();
    });

    test('deve lançar erro para tarefa não suportada', async () => {
      await expect(executeAiTask('invalid_task', 'input', {})).rejects.toThrow(
        'tarefa não suportada'
      );
    });
  });
});

