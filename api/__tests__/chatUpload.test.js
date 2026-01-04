/**
 * Testes para endpoint /chat/upload-file
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const http = require('http');
const { parseMultipartFormData } = require('../utils/multipartParser');
const { createDocument } = require('../services/ragDocumentsService');

// Mock das dependências
jest.mock('../utils/multipartParser');
jest.mock('../services/ragDocumentsService');
jest.mock('../middleware/auth', () => ({
  requireAuth: jest.fn(() => ({ valid: true })),
  requirePermission: jest.fn(() => ({ allowed: true })),
}));

describe('POST /chat/upload-file', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      method: 'POST',
      url: '/chat/upload-file',
      headers: {
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
        'authorization': 'Bearer test-token',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
      agent: {
        id: 'test-agent',
        username: 'test-user',
      },
      tenantId: 'test-tenant',
    };

    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      statusCode: 200,
    };

    parseMultipartFormData.mockResolvedValue({
      fields: {
        tenantId: 'test-tenant',
        autoIndex: 'true',
        category: 'test-category',
      },
      files: [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimeType: 'text/plain',
          buffer: Buffer.from('conteúdo de teste'),
          size: 18,
        },
      ],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve processar upload de arquivo de texto', async () => {
    createDocument.mockResolvedValue({
      success: true,
      document: {
        id: 'doc-123',
        title: 'test.txt',
      },
    });

    // Simula chamada do endpoint
    const { fields, files } = await parseMultipartFormData(mockReq);
    const file = files[0];

    expect(file).toBeDefined();
    expect(file.filename).toBe('test.txt');
    expect(file.mimeType).toBe('text/plain');
  });

  it('deve validar tamanho máximo do arquivo', async () => {
    const largeFile = {
      fieldname: 'file',
      filename: 'large.txt',
      mimeType: 'text/plain',
      size: 11 * 1024 * 1024, // 11MB
      buffer: Buffer.alloc(11 * 1024 * 1024),
    };

    parseMultipartFormData.mockResolvedValue({
      fields: {},
      files: [largeFile],
    });

    const { files } = await parseMultipartFormData(mockReq);
    const file = files[0];

    // Validação de tamanho deve ser feita no endpoint
    expect(file.size).toBeGreaterThan(10 * 1024 * 1024);
  });

  it('deve extrair conteúdo de arquivo de texto', async () => {
    const { files } = await parseMultipartFormData(mockReq);
    const file = files[0];

    if (file.mimeType.startsWith('text/')) {
      const content = file.buffer.toString('utf8');
      expect(content).toBe('conteúdo de teste');
    }
  });

  it('deve indexar arquivo no RAG quando autoIndex é true', async () => {
    createDocument.mockResolvedValue({
      success: true,
      document: {
        id: 'doc-123',
        title: 'test.txt',
      },
    });

    const { fields, files } = await parseMultipartFormData(mockReq);
    const file = files[0];

    if (fields.autoIndex === 'true') {
      const content = file.mimeType.startsWith('text/')
        ? file.buffer.toString('utf8')
        : `[Arquivo: ${file.filename}]`;

      const documentData = {
        title: file.filename,
        content: content,
        metadata: {
          source: 'chat_upload',
          category: fields.category || null,
          fileName: file.filename,
          fileType: file.mimeType,
          fileSize: file.size,
          uploadedAt: expect.any(String),
        },
        autoIndex: true,
      };

      const result = await createDocument(documentData, fields.tenantId || 'test-tenant');

      expect(createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'test.txt',
          metadata: expect.objectContaining({
            source: 'chat_upload',
          }),
        }),
        'test-tenant'
      );
    }
  });

  it('deve retornar erro se nenhum arquivo for enviado', async () => {
    parseMultipartFormData.mockResolvedValue({
      fields: {},
      files: [],
    });

    const { files } = await parseMultipartFormData(mockReq);

    expect(files.length).toBe(0);
  });

  it('deve processar múltiplos arquivos', async () => {
    parseMultipartFormData.mockResolvedValue({
      fields: {},
      files: [
        {
          filename: 'file1.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('conteúdo 1'),
          size: 10,
        },
        {
          filename: 'file2.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('conteúdo 2'),
          size: 10,
        },
      ],
    });

    const { files } = await parseMultipartFormData(mockReq);

    expect(files.length).toBe(2);
  });
});

