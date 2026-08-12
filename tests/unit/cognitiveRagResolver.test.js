'use strict';

/**
 * Testes do RAG Resolver — camada de consulta no Context Engine.
 *
 * O resolver é best-effort: nunca lança; retorna null quando indisponível.
 */

const { createRagResolver, buildQuery } = require('../../src/core/cognitive/context-engine/ragResolver');

describe('RAG Resolver — Context Engine (camada de consulta)', () => {
  describe('buildQuery', () => {
    test('prioriza ragQuery explícito sobre message', () => {
      const q = buildQuery({ ragQuery: 'como agendar?', message: 'oi' });
      expect(q).toBe('como agendar?');
    });

    test('usa message quando ragQuery ausente', () => {
      const q = buildQuery({ message: 'quero remarcar minha consulta' });
      expect(q).toBe('quero remarcar minha consulta');
    });

    test('retorna null para input vazio', () => {
      expect(buildQuery(null)).toBeNull();
      expect(buildQuery({})).toBeNull();
      expect(buildQuery({ message: '   ' })).toBeNull();
    });

    test('trunca query em 500 chars', () => {
      const long = 'a'.repeat(600);
      const q = buildQuery({ message: long });
      expect(q.length).toBe(500);
    });
  });

  describe('resolver rag', () => {
    test('retorna null quando ragService indisponível', async () => {
      // Sem deps.ragService e sem api/ no require — resolver fica inativo.
      const { rag } = createRagResolver({});
      const result = await rag({ tenantId: 'system', input: { message: 'oi' } });
      expect(result).toBeNull();
    });

    test('retorna null em falha do serviço (best-effort)', async () => {
      const mockService = {
        queryRag: async () => { throw new Error('boom'); },
      };
      const { rag } = createRagResolver({ ragService: mockService });
      const result = await rag({ tenantId: 'system', input: { message: 'oi' } });
      expect(result).toBeNull();
    });

    test('retorna null quando queryRag retorna skipped', async () => {
      const mockService = {
        queryRag: async () => ({ success: true, skipped: true }),
      };
      const { rag } = createRagResolver({ ragService: mockService });
      const result = await rag({ tenantId: 'system', input: { message: 'oi' } });
      expect(result).toBeNull();
    });

    test('mapeia resposta RAG para contexto estruturado', async () => {
      const mockService = {
        queryRag: async (query, tenantId) => ({
          success: true,
          response: 'Você pode agendar pela agenda.',
          confidence: 0.82,
          sources: [
            { documentId: 'doc-1', score: 0.9, excerpt: 'trecho do doc' },
          ],
          fromCache: false,
        }),
      };
      const { rag } = createRagResolver({ ragService: mockService });
      const result = await rag({ tenantId: 'system', input: { message: 'como agendo?' } });

      expect(result).toMatchObject({
        query: 'como agendo?',
        response: 'Você pode agendar pela agenda.',
        confidence: 0.82,
        fromCache: false,
      });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({ documentId: 'doc-1', score: 0.9 });
    });

    test('não chama serviço quando não há query', async () => {
      let called = false;
      const mockService = {
        queryRag: async () => { called = true; return { success: true, response: 'x' }; },
      };
      const { rag } = createRagResolver({ ragService: mockService });
      const result = await rag({ tenantId: 'system', input: {} });
      expect(result).toBeNull();
      expect(called).toBe(false);
    });
  });
});
