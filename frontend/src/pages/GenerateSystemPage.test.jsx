/**
 * Testes para GenerateSystemPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { GenerateSystemPage } from './GenerateSystemPage';
import { FileUploadProvider } from '../context/FileUploadContext';
import * as ragDocumentsApi from '../api/ragDocuments';
import * as fileProcessor from '../utils/fileProcessor';
import * as clientApi from '../api/client';

const showToastMock = vi.hoisted(() => vi.fn());

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
    showToast: showToastMock,
    ToastContainer: () => null,
  }),
}));
vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    // Interface do hook real: { connected, authenticated, send, reconnect }
    connected: true,
    authenticated: true,
    send: vi.fn(),
    reconnect: vi.fn(),
  }),
}));
function render(ui) {
  return rtlRender(<FileUploadProvider>{ui}</FileUploadProvider>);
}

describe('GenerateSystemPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Upload de Arquivos', () => {
    it('deve renderizar seção de upload de arquivos', async () => {
      render(<GenerateSystemPage />);
      
      await waitFor(() => {
        expect(screen.getByText(/Upload de Arquivos para RAG/i)).toBeInTheDocument();
        expect(screen.getByText(/Selecione arquivos/i)).toBeInTheDocument();
      });
    });

    it('não deve ter combobox de categoria', async () => {
      render(<GenerateSystemPage />);
      
      // Não deve existir label "Categoria do arquivo"
      await waitFor(() => {
        expect(screen.queryByText(/Categoria do arquivo/i)).not.toBeInTheDocument();
      });
    });

    it('deve adicionar arquivo à fila de upload (sem processar automaticamente)', async () => {
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

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Não processa/inferre/upload automaticamente; ocorre ao clicar em "Executar"
      expect(fileProcessor.processFile).not.toHaveBeenCalled();
      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/api/ai/generate', expect.anything());
      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });

    it('deve adicionar imagem à fila de upload (sem OCR automático)', async () => {
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
        expect(screen.getByText('test.png')).toBeInTheDocument();
      });

      expect(fileProcessor.processFile).not.toHaveBeenCalled();
      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });

    it('deve adicionar PDF à fila de upload (sem extração automática)', async () => {
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
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
      });

      expect(fileProcessor.processFile).not.toHaveBeenCalled();
      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });

    it('não deve inferir categoria automaticamente ao selecionar arquivo', async () => {
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

      await waitFor(() => {
        expect(screen.getByText('promocao.txt')).toBeInTheDocument();
      });

      expect(clientApi.fetchJson).not.toHaveBeenCalled();
      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });

    it('deve adicionar múltiplos arquivos à fila (sem processar automaticamente)', async () => {
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
        expect(screen.getByText('test1.txt')).toBeInTheDocument();
        expect(screen.getByText('test2.txt')).toBeInTheDocument();
      });

      expect(fileProcessor.processFile).not.toHaveBeenCalled();
      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });

    it('não deve tentar upload automaticamente ao selecionar arquivo', async () => {
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
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      });

      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });
  });

  describe('Inferência de Categoria', () => {
    it('não deve inferir categoria automaticamente ao selecionar arquivo', async () => {
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
        expect(screen.getByText('promocao.txt')).toBeInTheDocument();
      });

      expect(clientApi.fetchJson).not.toHaveBeenCalled();
    });

    it('não deve aplicar fallback automaticamente ao selecionar arquivo', async () => {
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

      await waitFor(() => {
        expect(screen.getByText('promocao.txt')).toBeInTheDocument();
      });

      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });
  });

  describe('Extração de Conteúdo', () => {
    it('não deve extrair conteúdo automaticamente ao selecionar arquivo', async () => {
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
          expect(screen.getByText(testCase.file.name)).toBeInTheDocument();
        });
        expect(fileProcessor.processFile).not.toHaveBeenCalled();
        expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();

        // Limpa o componente antes do próximo teste
        unmount();
      }
    });

    it('não deve indexar no RAG automaticamente ao selecionar arquivo', async () => {
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
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      });

      expect(ragDocumentsApi.uploadDocument).not.toHaveBeenCalled();
    });
  });

  describe('Gate de Web Scraping (tenant)', () => {
    it('não deve continuar o pipeline se successCount === 0', async () => {
      // Ativa modo tenant via querystring (o componente lê window.location.search)
      window.history.pushState({}, '', '/generate-system?mode=tenant');

      clientApi.fetchJson.mockImplementation(async (path) => {
        if (path === '/system/pipeline/validate-prereqs') {
          return { ok: true, providerValidated: true, ragValidated: true };
        }
        if (path === '/web-scraping/scrape-batch') {
          return {
            total: 1,
            success: 0,
            failed: 1,
            new: 0,
            duplicates: 0,
            results: [
              {
                url: 'https://studiooly.com.br/',
                success: false,
                status: 'failed',
                error: { name: 'Error', message: 'Falha no scraping', stack: 'stack...' },
                durationMs: 10,
              },
            ],
            errorSummary: [
              { url: 'https://studiooly.com.br/', name: 'Error', message: 'Falha no scraping' },
            ],
          };
        }
        // Se chegar aqui, é um endpoint que NÃO deveria ser chamado após o gate
        if (path === '/system/suggest-description' || path === '/tenants/generate-by-ai' || path === '/system/generate-and-validate') {
          throw new Error(`Endpoint não deveria ser chamado após gate: ${path}`);
        }
        return {};
      });

      render(<GenerateSystemPage />);

      // Preenche nome obrigatório (tenant)
      fireEvent.change(screen.getByPlaceholderText(/Empresa XYZ/i), {
        target: { value: 'Tenant Teste' },
      });

      // Preenche URL válida para scraping
      fireEvent.change(screen.getByPlaceholderText('https://exemplo.com'), {
        target: { value: 'https://studiooly.com.br/' },
      });

      // Executa
      fireEvent.click(screen.getByRole('button', { name: /Executar/i }));

      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith(
          '/web-scraping/scrape-batch',
          expect.any(Object)
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Nenhuma URL foi raspada com sucesso/i)).toBeInTheDocument();
      });

      // Gate: não deve avançar para sugestão/geração
      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/system/suggest-description', expect.anything());
      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/tenants/generate-by-ai', expect.anything());
      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/system/generate-and-validate', expect.anything());
    });

    it('quando receber NO_INDEXED_CONTEXT no suggest-description deve abortar e NÃO chamar generate-by-ai', async () => {
      // Ativa modo tenant via querystring (o componente lê window.location.search)
      window.history.pushState({}, '', '/generate-system?mode=tenant');

      clientApi.fetchJson.mockImplementation(async (path) => {
        if (path === '/system/pipeline/validate-prereqs') {
          return { ok: true, providerValidated: true, ragValidated: true };
        }
        if (path === '/web-scraping/scrape-batch') {
          return {
            total: 1,
            success: 1,
            failed: 0,
            new: 1,
            duplicates: 0,
            results: [
              {
                url: 'https://studiooly.com.br/',
                success: true,
                status: 'indexed',
                durationMs: 10,
              },
            ],
            errorSummary: [],
          };
        }
        if (path === '/system/suggest-description') {
          const err = new Error('Nenhum contexto indexado disponível');
          // contrato do fetchJson (Error Envelope normalizado)
          // @ts-ignore
          err.code = 'NO_INDEXED_CONTEXT';
          // @ts-ignore
          err.details = { tenantId: 't1', indexedChunks: 0 };
          // @ts-ignore
          err.status = 422;
          throw err;
        }
        // Endpoints que NÃO devem ser chamados após NO_INDEXED_CONTEXT
        if (path === '/tenants/generate-by-ai' || path === '/system/generate-and-validate') {
          throw new Error(`Endpoint não deveria ser chamado após NO_INDEXED_CONTEXT: ${path}`);
        }
        return {};
      });

      render(<GenerateSystemPage />);

      // Desativa bootstrap para permitir seguir para sugestão de descrição (RAG habilitado pelo fluxo)
      fireEvent.click(screen.getByLabelText(/Gerar tudo do zero \(Bootstrap\)/i));
      await waitFor(() => {
        expect(screen.queryByText(/Modo Bootstrap ativo/i)).not.toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/Empresa XYZ/i), {
        target: { value: 'Tenant Teste' },
      });
      fireEvent.change(screen.getByPlaceholderText('https://exemplo.com'), {
        target: { value: 'https://studiooly.com.br/' },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Executar/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /Executar/i }));

      // Confirma que o fluxo de execução realmente iniciou
      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith(
          '/system/pipeline/validate-prereqs',
          expect.any(Object)
        );
      });

      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith('/web-scraping/scrape-batch', expect.any(Object));
      });

      await waitFor(() => {
        expect(clientApi.fetchJson).toHaveBeenCalledWith(
          '/system/suggest-description',
          expect.any(Object)
        );
      }, { timeout: 8000 });

      await waitFor(() => {
        expect(screen.getByText(/Nenhum contexto indexado/i)).toBeInTheDocument();
      }, { timeout: 8000 });

      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/tenants/generate-by-ai', expect.anything());
      expect(clientApi.fetchJson).not.toHaveBeenCalledWith('/system/generate-and-validate', expect.anything());
    }, 20000);
  });
});
