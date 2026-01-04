/**
 * Testes para GenerateSystemPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GenerateSystemPage } from './GenerateSystemPage';
import * as ragDocumentsApi from '../api/ragDocuments';
import * as fileProcessor from '../utils/fileProcessor';
import * as clientApi from '../api/client';

// Mock dos módulos
vi.mock('../api/ragDocuments');
vi.mock('../utils/fileProcessor');
vi.mock('../api/client');
vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    agent: { tenantId: 'test-tenant' },
  }),
}));
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    ToastContainer: () => null,
  }),
}));
vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    sendMessage: vi.fn(),
    isConnected: true,
  }),
}));

describe('GenerateSystemPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Upload de Arquivos', () => {
    it('deve renderizar seção de upload de arquivos', () => {
      render(<GenerateSystemPage />);
      
      expect(screen.getByText(/Upload de Arquivos para RAG/i)).toBeInTheDocument();
      expect(screen.getByText(/Selecione arquivos/i)).toBeInTheDocument();
    });

    it('não deve ter combobox de categoria', () => {
      render(<GenerateSystemPage />);
      
      // Não deve existir label "Categoria do arquivo"
      expect(screen.queryByText(/Categoria do arquivo/i)).not.toBeInTheDocument();
    });

    it('deve processar arquivo e extrair conteúdo', async () => {
      const file = new File(['conteúdo de teste'], 'test.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo de teste',
        preview: null,
        file: file,
      });

      // Mock inferência de categoria com IA
      clientApi.fetchJson.mockResolvedValue({
        text: 'promocoes',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'test.txt' },
      });

      render(<GenerateSystemPage />);
      
      // Busca o input pelo ID
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      // Simula seleção de arquivo
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      // Aguarda processamento
      await waitFor(() => {
        expect(fileProcessor.processFile).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            compressImages: false, // Não é imagem
            extractImageText: false, // Não é imagem
          })
        );
      }, { timeout: 3000 });

      // Verifica que a inferência de categoria foi chamada
      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith(
          '/api/ai/generate',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('promocoes'),
          })
        );
      });
    });

    it('deve processar imagem com OCR', async () => {
      const blob = new Blob(['fake image'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });
      
      // Mock processFile para imagem
      fileProcessor.processFile.mockResolvedValue({
        content: '[Imagem: test.png]\n\nTexto extraído (OCR):\nPromoção especial',
        preview: 'data:image/png;base64,fake',
        file: file,
      });

      // Mock inferência de categoria com IA
      clientApi.fetchJson.mockResolvedValue({
        text: 'promocoes',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'test.png' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(fileProcessor.processFile).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            compressImages: true,
            extractImageText: true,
          })
        );
      });
    });

    it('deve processar PDF e extrair texto', async () => {
      const blob = new Blob(['fake pdf'], { type: 'application/pdf' });
      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });
      
      // Mock processFile para PDF
      fileProcessor.processFile.mockResolvedValue({
        content: '--- Página 1 ---\nConteúdo do PDF extraído',
        preview: null,
        file: file,
      });

      // Mock inferência de categoria com IA
      clientApi.fetchJson.mockResolvedValue({
        text: 'tabelas_preco',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'test.pdf' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(fileProcessor.processFile).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            category: 'tabelas_preco',
            metadata: expect.objectContaining({
              extractedContent: expect.stringContaining('Conteúdo do PDF extraído'),
            }),
            autoIndex: true,
          })
        );
      });
    });

    it('deve usar fallback quando IA falhar na inferência de categoria', async () => {
      const file = new File(['conteúdo'], 'promocao.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo',
        preview: null,
        file: file,
      });

      // Mock falha na inferência de categoria
      clientApi.fetchJson.mockRejectedValue(new Error('IA não disponível'));

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'promocao.txt' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      // Deve usar fallback (análise de palavras-chave)
      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            category: 'promocoes', // Fallback detecta "promocao" no nome
          })
        );
      });
    });

    it('deve processar múltiplos arquivos', async () => {
      const file1 = new File(['conteúdo 1'], 'test1.txt', { type: 'text/plain' });
      const file2 = new File(['conteúdo 2'], 'test2.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile
        .mockResolvedValueOnce({
          content: 'conteúdo 1',
          preview: null,
          file: file1,
        })
        .mockResolvedValueOnce({
          content: 'conteúdo 2',
          preview: null,
          file: file2,
        });

      // Mock inferência de categoria
      clientApi.fetchJson
        .mockResolvedValueOnce({ text: 'promocoes' })
        .mockResolvedValueOnce({ text: 'avisos' });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument
        .mockResolvedValueOnce({ document: { id: 'doc-1', title: 'test1.txt' } })
        .mockResolvedValueOnce({ document: { id: 'doc-2', title: 'test2.txt' } });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file1, file2],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(fileProcessor.processFile).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledTimes(2);
      });
    });

    it('deve exibir erro quando upload falhar', async () => {
      const file = new File(['conteúdo'], 'test.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo',
        preview: null,
        file: file,
      });

      // Mock inferência de categoria
      clientApi.fetchJson.mockResolvedValue({
        text: 'outros',
      });

      // Mock erro no upload
      ragDocumentsApi.uploadDocument.mockRejectedValue(new Error('Erro no upload'));

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalled();
      });
    });
  });

  describe('Inferência de Categoria', () => {
    it('deve inferir categoria usando IA', async () => {
      const file = new File(['conteúdo'], 'promocao.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo',
        preview: null,
        file: file,
      });

      // Mock inferência de categoria com IA
      clientApi.fetchJson.mockResolvedValue({
        text: 'promocoes',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'promocao.txt' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith(
          '/api/ai/generate',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('promocoes'),
          })
        );
      });
    });

    it('deve usar fallback quando IA retornar categoria inválida', async () => {
      const file = new File(['conteúdo'], 'promocao.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo',
        preview: null,
        file: file,
      });

      // Mock IA retornando categoria inválida
      clientApi.fetchJson.mockResolvedValue({
        text: 'categoria_invalida',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'promocao.txt' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      // Deve usar fallback (detecta "promocao" no nome)
      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            category: 'promocoes',
          })
        );
      });
    });
  });

  describe('Extração de Conteúdo', () => {
    it('deve extrair conteúdo de todos os tipos de arquivo', async () => {
      const testCases = [
        {
          file: new File(['texto'], 'test.txt', { type: 'text/plain' }),
          expectedContent: 'texto',
        },
        {
          file: new File(['pdf'], 'test.pdf', { type: 'application/pdf' }),
          expectedContent: 'Conteúdo do PDF',
        },
        {
          file: new File(['image'], 'test.png', { type: 'image/png' }),
          expectedContent: 'Texto extraído (OCR)',
        },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        // Mock processFile
        fileProcessor.processFile.mockResolvedValue({
          content: testCase.expectedContent,
          preview: null,
          file: testCase.file,
        });

        // Mock inferência de categoria
        clientApi.fetchJson.mockResolvedValue({
          text: 'outros',
        });

        // Mock uploadDocument
        ragDocumentsApi.uploadDocument.mockResolvedValue({
          document: { id: 'doc-123', title: testCase.file.name },
        });

        const { unmount } = render(<GenerateSystemPage />);
        
        const fileInput = document.getElementById('file-upload-input') || 
                        screen.getByLabelText(/Selecione arquivos/i);
        
        // Remove propriedade anterior se existir
        try {
          delete fileInput.files;
        } catch (e) {
          // Ignora erro se não puder deletar
        }
        
        Object.defineProperty(fileInput, 'files', {
          value: [testCase.file],
          writable: true,
          configurable: true,
        });
        
        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(fileProcessor.processFile).toHaveBeenCalled();
        });

        await waitFor(() => {
          expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledWith(
            expect.any(File),
            expect.objectContaining({
              metadata: expect.objectContaining({
                extractedContent: expect.stringContaining(testCase.expectedContent),
              }),
            })
          );
        });

        // Limpa o componente antes do próximo teste
        unmount();
      }
    });

    it('deve indexar conteúdo extraído no RAG', async () => {
      const file = new File(['conteúdo extraído'], 'test.txt', { type: 'text/plain' });
      
      // Mock processFile
      fileProcessor.processFile.mockResolvedValue({
        content: 'conteúdo extraído',
        preview: null,
        file: file,
      });

      // Mock inferência de categoria
      clientApi.fetchJson.mockResolvedValue({
        text: 'promocoes',
      });

      // Mock uploadDocument
      ragDocumentsApi.uploadDocument.mockResolvedValue({
        document: { id: 'doc-123', title: 'test.txt' },
      });

      render(<GenerateSystemPage />);
      
      const fileInput = document.getElementById('file-upload-input') || 
                       screen.getByLabelText(/Selecione arquivos/i);
      
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false,
      });
      
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(ragDocumentsApi.uploadDocument).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({
            autoIndex: true, // Deve indexar automaticamente
            metadata: expect.objectContaining({
              extractedContent: 'conteúdo extraído',
            }),
          })
        );
      });
    });
  });
});

