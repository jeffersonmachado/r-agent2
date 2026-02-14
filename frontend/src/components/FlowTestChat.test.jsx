/**
 * Testes para FlowTestChat com suporte a arquivos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlowTestChat } from './FlowTestChat';
import { useFlowRunner } from '../hooks/useFlowRunner';

// Mock do useFlowRunner
vi.mock('../hooks/useFlowRunner');

// Mock do useTheme
vi.mock('../styles/themeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        bg: { primary: '#fff', secondary: '#f0f0f0', tertiary: '#e0e0e0' },
        text: { primary: '#000', secondary: '#666', tertiary: '#999' },
        border: { default: '#ccc', hover: '#999', focus: '#0066cc' },
        status: { success: '#00aa00', error: '#aa0000', warning: '#ffaa00' },
        accent: { primary: '#0066cc', light: '#e6f2ff' },
      },
    },
    themeName: 'light',
  }),
}));

// Mock do useToast
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    ToastContainer: () => null,
  }),
}));

// Mock do useRouter
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

// Mock do useAuth
vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
  }),
}));

// Mock do textToSpeech
vi.mock('../utils/textToSpeech', () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  isAvailable: () => false,
}));

// Mock do fileProcessor
vi.mock('../utils/fileProcessor', () => ({
  processFile: vi.fn(),
  validateFile: vi.fn(),
  formatFileSize: vi.fn((bytes) => `${(bytes / 1024).toFixed(2)} KB`),
  getFileIcon: vi.fn(() => '📎'),
}));

describe('FlowTestChat - Upload de Arquivos', () => {
  const mockFlow = {
    id: 'test-flow',
    name: 'Test Flow',
    version: 1,
    nodes: [
      {
        id: 'start',
        type: 'start',
        next: 'user_input',
      },
      {
        id: 'user_input',
        type: 'user_input',
        config: {
          variable: 'user_message',
        },
        next: 'end',
      },
      {
        id: 'end',
        type: 'end',
      },
    ],
  };

  const mockUseFlowRunner = {
    conversationState: {
      currentNodeId: 'user_input',
      sessionId: 'test-session',
      flowId: 'test-flow',
      variables: {},
    },
    isRunning: true,
    isProcessing: false,
    error: null,
    validationResult: { valid: true },
    pendingOutputs: [],
    executionLog: [],
    startConversation: vi.fn(() => true),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useFlowRunner.mockReturnValue(mockUseFlowRunner);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Seleção de Arquivos', () => {
    it('deve renderizar botão de anexo', () => {
      const { getByTitle } = render(<FlowTestChat flow={mockFlow} />);

      const attachButton = getByTitle(/anexar arquivo/i);
      expect(attachButton).toBeDefined();
    });

    it('deve abrir seletor de arquivo ao clicar no botão de anexo', () => {
      const { container } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');

      expect(fileInput).toBeDefined();
      expect(fileInput).toHaveAttribute('accept', expect.stringContaining('image/*'));
    });

    it('deve validar arquivo ao selecionar', async () => {
      const { validateFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);

      const { container } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(validateFile).toHaveBeenCalledWith(
          file,
          10,
          expect.arrayContaining(['image/*', 'application/pdf', 'text/*'])
        );
      });
    });

    it('deve processar arquivo após validação', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      const { container } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(processFile).toHaveBeenCalled();
      });
    });

    it('deve mostrar preview de arquivo anexado', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      const { container, getByText } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(getByText(/test\.txt/i)).toBeDefined();
      });
    });

    it('deve limitar número de arquivos a 5', async () => {
      const { validateFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);

      const { container } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');
      const files = Array.from({ length: 6 }, (_, i) =>
        new File(['content'], `test${i}.txt`, { type: 'text/plain' })
      );

      // Mock alert
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      fireEvent.change(fileInput, {
        target: { files },
      });

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining('máximo 5 arquivos')
        );
      });

      alertSpy.mockRestore();
    });
  });

  describe('Envio de Mensagens com Arquivos', () => {
    it('deve enviar mensagem com arquivos anexados', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      const { container, getByText } = render(<FlowTestChat flow={mockFlow} />);

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(processFile).toHaveBeenCalled();
      });

      // Aguarda processamento
      await waitFor(() => {
        const sendButton = getByText(/enviar/i);
        expect(sendButton).not.toBeDisabled();
      });

      const sendButton = getByText(/enviar/i);
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockUseFlowRunner.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: '',
            files: expect.arrayContaining([
              expect.objectContaining({
                name: 'test.txt',
              }),
            ]),
          })
        );
      });
    });

    it('deve enviar mensagem com texto e arquivos', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      const { container, getByPlaceholderText, getByText } = render(<FlowTestChat flow={mockFlow} />);

      const textInput = getByPlaceholderText(/digite sua mensagem/i);
      fireEvent.change(textInput, { target: { value: 'Mensagem de teste' } });

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(processFile).toHaveBeenCalled();
      });

      const sendButton = getByText(/enviar/i);
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockUseFlowRunner.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'Mensagem de teste',
            files: expect.any(Array),
          })
        );
      });
    });
  });

  describe('Exibição de Arquivos nas Mensagens', () => {
    it('deve exibir arquivo anexado na mensagem do usuário', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      // Mock de mensagens com arquivo
      const mockWithFiles = {
        ...mockUseFlowRunner,
        pendingOutputs: [],
      };

      useFlowRunner.mockReturnValue(mockWithFiles);

      const { container, getByText } = render(<FlowTestChat flow={mockFlow} />);

      // Simula mensagem com arquivo
      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(getByText(/test\.txt/i)).toBeDefined();
      });
    });
  });

  describe('Drag and Drop', () => {
    it('deve aceitar arquivos arrastados', async () => {
      const { validateFile, processFile } = await import('../utils/fileProcessor');
      validateFile.mockReturnValue(true);
      processFile.mockResolvedValue({
        content: 'Conteúdo extraído',
        preview: null,
        file: new File(['content'], 'test.txt'),
      });

      const { getByPlaceholderText } = render(<FlowTestChat flow={mockFlow} />);

      const inputArea = getByPlaceholderText(/digite sua mensagem/i).closest('form').parentElement;
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.dragOver(inputArea, {
        dataTransfer: {
          files: [file],
        },
      });

      fireEvent.drop(inputArea, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(validateFile).toHaveBeenCalled();
      });
    });
  });
});

