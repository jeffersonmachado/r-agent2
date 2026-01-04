/**
 * Testes para ragDocuments.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadDocument } from './ragDocuments';
import * as clientApi from './client';

// Mock do client
vi.mock('./client', () => ({
  fetchJson: vi.fn(),
}));

// Mock do logger
vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('ragDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadDocument', () => {
    it('deve usar extractedContent quando fornecido nos metadados', async () => {
      const file = new File(['conteúdo original'], 'test.txt', { type: 'text/plain' });
      const extractedContent = 'Conteúdo extraído processado';

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        category: 'promocoes',
        metadata: {
          extractedContent: extractedContent,
        },
        autoIndex: true,
      });

      // Aguarda FileReader processar
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(clientApi.fetchJson).toHaveBeenCalledWith(
        '/rag/documents',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verifica que o body contém o conteúdo extraído
      const callArgs = clientApi.fetchJson.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.content).toBe(extractedContent);
    });

    it('deve processar arquivo de texto sem extractedContent', async () => {
      const content = 'Conteúdo de texto';
      const file = new File([content], 'test.txt', { type: 'text/plain' });

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        category: 'avisos',
        autoIndex: true,
      });

      // Aguarda FileReader processar
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(clientApi.fetchJson).toHaveBeenCalledWith(
        '/rag/documents',
        expect.objectContaining({
          method: 'POST',
        })
      );

      const callArgs = clientApi.fetchJson.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.content).toBe(content);
    });

    it('deve usar placeholder para imagem sem extractedContent', async () => {
      const blob = new Blob(['fake image'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        category: 'imagens',
        autoIndex: true,
      });

      expect(clientApi.fetchJson).toHaveBeenCalledWith(
        '/rag/documents',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('[Imagem: test.png]'),
        })
      );
    });

    it('deve usar placeholder para PDF sem extractedContent', async () => {
      const blob = new Blob(['fake pdf'], { type: 'application/pdf' });
      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        category: 'tabelas_preco',
        autoIndex: true,
      });

      expect(clientApi.fetchJson).toHaveBeenCalledWith(
        '/rag/documents',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('[PDF: test.pdf]'),
        })
      );
    });

    it('deve incluir categoria e tags nos metadados', async () => {
      const file = new File(['conteúdo'], 'test.txt', { type: 'text/plain' });

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        category: 'promocoes',
        tags: ['promocoes', 'generate-system'],
        metadata: {
          extractedContent: 'conteúdo extraído',
        },
        autoIndex: true,
      });

      // Aguarda FileReader processar
      await new Promise(resolve => setTimeout(resolve, 100));

      const callArgs = clientApi.fetchJson.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.metadata.category).toBe('promocoes');
      expect(body.metadata.tags).toEqual(['promocoes', 'generate-system']);
      expect(body.metadata.extractedContent).toBe('conteúdo extraído');
    });

    it('deve indexar automaticamente quando autoIndex é true', async () => {
      const file = new File(['conteúdo'], 'test.txt', { type: 'text/plain' });

      clientApi.fetchJson.mockResolvedValue({
        document: { id: 'doc-123', title: 'test' },
      });

      await uploadDocument(file, {
        autoIndex: true,
      });

      // Aguarda FileReader processar
      await new Promise(resolve => setTimeout(resolve, 100));

      const callArgs = clientApi.fetchJson.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.autoIndex).toBe(true);
    });

    it('deve rejeitar quando arquivo não é fornecido', async () => {
      await expect(uploadDocument(null)).rejects.toThrow('file é obrigatório');
    });
  });
});

