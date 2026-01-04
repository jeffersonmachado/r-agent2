/**
 * Testes para userInputNodeHandler com suporte a arquivos
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { userInputNodeHandler } = require('../nodes/basicNodes');
const fileRagService = require('../services/fileRagService');

// Mock do serviço de indexação RAG
jest.mock('../services/fileRagService', () => ({
  indexFilesInRag: jest.fn().mockResolvedValue([
    { file: 'test.txt', success: true, documentId: 'doc-123' },
  ]),
}));

describe('userInputNodeHandler - Arquivos', () => {
  let node;
  let state;

  beforeEach(() => {
    node = {
      id: 'user_input_1',
      type: 'user_input',
      config: {
        variable: 'user_message',
      },
    };

    state = {
      sessionId: 'test-session',
      flowId: 'test-flow',
      tenantId: 'test-tenant',
      currentNodeId: 'user_input_1',
      variables: {},
      metadata: {},
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deve processar input com arquivos', async () => {
    const input = {
      text: 'Mensagem de teste',
      files: [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo do arquivo',
        },
      ],
    };

    const result = await userInputNodeHandler(node, state, input);

    expect(result.nextState.variables.user_message).toContain('Mensagem de teste');
    expect(result.nextState.variables.user_message).toContain('Arquivos anexados');
    expect(result.nextState.variables.lastFiles).toEqual(input.files);
    expect(result.output.files).toBeDefined();
  });

  it('deve indexar arquivos no RAG por padrão', async () => {
    const input = {
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

    await userInputNodeHandler(node, state, input);

    expect(fileRagService.indexFilesInRag).toHaveBeenCalledWith(
      input.files,
      'test-tenant',
      expect.objectContaining({
        category: 'chat_upload',
        metadata: expect.objectContaining({
          sessionId: 'test-session',
          flowId: 'test-flow',
          nodeId: 'user_input_1',
        }),
      })
    );
  });

  it('não deve indexar arquivos se autoIndexFiles for false', async () => {
    node.config.autoIndexFiles = false;

    const input = {
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

    await userInputNodeHandler(node, state, input);

    expect(fileRagService.indexFilesInRag).not.toHaveBeenCalled();
  });

  it('deve processar apenas arquivos sem texto', async () => {
    const input = {
      text: '',
      files: [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo do arquivo',
        },
      ],
    };

    const result = await userInputNodeHandler(node, state, input);

    expect(result.nextState.variables.user_message).toContain('Arquivos anexados');
    expect(result.nextState.variables.user_message).toContain('Conteúdo do arquivo');
  });

  it('deve ignorar arquivos com conteúdo placeholder na indexação', async () => {
    const input = {
      text: 'Mensagem',
      files: [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: '[Arquivo: test.txt]', // Placeholder
        },
      ],
    };

    await userInputNodeHandler(node, state, input);

    // O serviço deve ser chamado, mas vai ignorar arquivos com placeholder
    expect(fileRagService.indexFilesInRag).toHaveBeenCalled();
  });

  it('deve continuar processamento mesmo se indexação falhar', async () => {
    fileRagService.indexFilesInRag.mockRejectedValue(new Error('Erro na indexação'));

    const input = {
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
    const result = await userInputNodeHandler(node, state, input);

    expect(result.nextState.variables.user_message).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('deve processar múltiplos arquivos', async () => {
    const input = {
      text: 'Mensagem',
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

    const result = await userInputNodeHandler(node, state, input);

    expect(result.nextState.variables.user_message).toContain('file1.txt');
    expect(result.nextState.variables.user_message).toContain('file2.txt');
    expect(result.nextState.variables.user_message).toContain('Conteúdo 1');
    expect(result.nextState.variables.user_message).toContain('Conteúdo 2');
    expect(result.output.files).toHaveLength(2);
  });

  it('deve manter comportamento original sem arquivos', async () => {
    const input = {
      text: 'Mensagem de teste',
    };

    const result = await userInputNodeHandler(node, state, input);

    expect(result.nextState.variables.user_message).toBe('Mensagem de teste');
    expect(result.nextState.variables.lastFiles).toBeUndefined();
    expect(result.output.files).toBeUndefined();
    expect(fileRagService.indexFilesInRag).not.toHaveBeenCalled();
  });

  it('deve incluir arquivos no log de eventos', async () => {
    const input = {
      text: 'Mensagem',
      files: [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo',
        },
      ],
    };

    const result = await userInputNodeHandler(node, state, input);

    const messageEvent = result.events.find(e => e.type === 'MESSAGE_IN');
    expect(messageEvent).toBeDefined();
    expect(messageEvent.payload.filesCount).toBe(1);
  });
});

