/**
 * Testes de integração end-to-end para upload de arquivos no chat
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { executeStep } = require('../../engine/executeStep');
const { NodeRegistry } = require('../../engine/nodeRegistry');
const {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  endNodeHandler,
} = require('../../engine/nodes/basicNodes');
const fileRagService = require('../../engine/services/fileRagService');
const ragDocumentsService = require('../../api/services/ragDocumentsService');

// Mock do serviço RAG
jest.mock('../../api/services/ragDocumentsService');
jest.mock('../../engine/services/fileRagService');

describe('Integração - Upload de Arquivos no Chat', () => {
  let registry;
  let flow;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register('start', startNodeHandler);
    registry.register('message', messageNodeHandler);
    registry.register('user_input', userInputNodeHandler);
    registry.register('end', endNodeHandler);

    flow = {
      id: 'test-flow-files',
      name: 'Test Flow com Arquivos',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          next: 'welcome',
        },
        {
          id: 'welcome',
          type: 'message',
          config: {
            text: 'Olá! Envie um arquivo para processarmos.',
          },
          next: 'user_input',
        },
        {
          id: 'user_input',
          type: 'user_input',
          config: {
            variable: 'user_message',
            autoIndexFiles: true,
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
        },
      ],
    };

    jest.clearAllMocks();
    
    // Mock do serviço de indexação
    fileRagService.indexFilesInRag.mockResolvedValue([
      { file: 'test.txt', success: true, documentId: 'doc-123' },
    ]);
    
    ragDocumentsService.createDocument.mockResolvedValue({
      success: true,
      document: {
        id: 'doc-123',
        title: 'test.txt',
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Fluxo Completo com Arquivo', () => {
    it('deve processar fluxo completo com arquivo de texto', async () => {
      const initialState = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'start',
        variables: {},
        metadata: {},
      };

      // Passo 1: Start
      let result = await executeStep(initialState, flow, { registry });
      expect(result.state.currentNodeId).toBe('welcome');

      // Passo 2: Message
      result = await executeStep(result.state, flow, { registry });
      expect(result.output.type).toBe('message');
      expect(result.output.text).toContain('Envie um arquivo');

      // Passo 3: User Input com arquivo
      const inputWithFile = {
        text: 'Aqui está o arquivo',
        files: [
          {
            name: 'test.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo do arquivo de teste',
          },
        ],
      };

      result = await executeStep(result.state, flow, {
        registry,
        input: inputWithFile,
      });

      // Verifica que o arquivo foi processado
      expect(result.state.variables.user_message).toContain('Aqui está o arquivo');
      expect(result.state.variables.user_message).toContain('Arquivos anexados');
      expect(result.state.variables.user_message).toContain('Conteúdo do arquivo de teste');
      expect(result.state.variables.lastFiles).toEqual(inputWithFile.files);
      expect(result.output.files).toBeDefined();

      // Verifica que a indexação foi chamada
      expect(fileRagService.indexFilesInRag).toHaveBeenCalledWith(
        inputWithFile.files,
        'test-tenant',
        expect.objectContaining({
          category: 'chat_upload',
        })
      );
    });

    it('deve processar fluxo com múltiplos arquivos', async () => {
      const initialState = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'start',
        variables: {},
        metadata: {},
      };

      // Avança até user_input
      let result = await executeStep(initialState, flow, { registry });
      result = await executeStep(result.state, flow, { registry });

      const inputWithFiles = {
        text: 'Aqui estão os arquivos',
        files: [
          {
            name: 'file1.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo 1',
          },
          {
            name: 'file2.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo 2',
          },
        ],
      };

      result = await executeStep(result.state, flow, {
        registry,
        input: inputWithFiles,
      });

      expect(result.state.variables.user_message).toContain('file1.txt');
      expect(result.state.variables.user_message).toContain('file2.txt');
      expect(result.state.variables.user_message).toContain('Conteúdo 1');
      expect(result.state.variables.user_message).toContain('Conteúdo 2');
      expect(result.output.files).toHaveLength(2);
    });

    it('deve processar apenas arquivos sem texto', async () => {
      const initialState = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'start',
        variables: {},
        metadata: {},
      };

      let result = await executeStep(initialState, flow, { registry });
      result = await executeStep(result.state, flow, { registry });

      const inputOnlyFiles = {
        text: '',
        files: [
          {
            name: 'documento.pdf',
            type: 'application/pdf',
            size: 5000,
            content: '[PDF: documento.pdf]',
          },
        ],
      };

      result = await executeStep(result.state, flow, {
        registry,
        input: inputOnlyFiles,
      });

      expect(result.state.variables.user_message).toContain('Arquivos anexados');
      expect(result.state.variables.user_message).toContain('documento.pdf');
      expect(result.output.files).toBeDefined();
    });

    it('deve continuar fluxo mesmo se indexação RAG falhar', async () => {
      fileRagService.indexFilesInRag.mockRejectedValue(
        new Error('Erro na indexação')
      );

      const initialState = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'start',
        variables: {},
        metadata: {},
      };

      let result = await executeStep(initialState, flow, { registry });
      result = await executeStep(result.state, flow, { registry });

      const inputWithFile = {
        text: 'Mensagem',
        files: [
          {
            name: 'test.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo válido',
          },
        ],
      };

      // Não deve lançar erro
      result = await executeStep(result.state, flow, {
        registry,
        input: inputWithFile,
      });

      expect(result.state.variables.user_message).toBeDefined();
      expect(result.output).toBeDefined();
    });
  });

  describe('Indexação RAG', () => {
    it('deve indexar arquivo automaticamente quando autoIndexFiles é true', async () => {
      const inputWithFile = {
        text: 'Mensagem',
        files: [
          {
            name: 'test.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo válido para indexação',
          },
        ],
      };

      const state = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'user_input',
        variables: {},
        metadata: {},
      };

      const node = flow.nodes.find(n => n.id === 'user_input');
      const { userInputNodeHandler } = require('../../engine/nodes/basicNodes');

      await userInputNodeHandler(node, state, inputWithFile);

      expect(fileRagService.indexFilesInRag).toHaveBeenCalled();
    });

    it('não deve indexar quando autoIndexFiles é false', async () => {
      flow.nodes.find(n => n.id === 'user_input').config.autoIndexFiles = false;

      const inputWithFile = {
        text: 'Mensagem',
        files: [
          {
            name: 'test.txt',
            type: 'text/plain',
            size: 100,
            content: 'Conteúdo válido',
          },
        ],
      };

      const state = {
        sessionId: 'test-session',
        flowId: flow.id,
        tenantId: 'test-tenant',
        currentNodeId: 'user_input',
        variables: {},
        metadata: {},
      };

      const node = flow.nodes.find(n => n.id === 'user_input');
      const { userInputNodeHandler } = require('../../engine/nodes/basicNodes');

      await userInputNodeHandler(node, state, inputWithFile);

      expect(fileRagService.indexFilesInRag).not.toHaveBeenCalled();
    });
  });
});

