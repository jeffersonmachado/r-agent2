/**
 * Testes para multipartParser.js
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { Readable } = require('stream');
const { parseMultipartFormData } = require('../multipartParser');
const Busboy = require('busboy');

// Mock do busboy
jest.mock('busboy');

describe('multipartParser', () => {
  let mockReq;
  let mockBusboy;

  beforeEach(() => {
    mockBusboy = {
      on: jest.fn(),
      pipe: jest.fn(),
    };

    Busboy.mockImplementation(() => mockBusboy);

    mockReq = {
      headers: {
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
      },
      pipe: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseMultipartFormData', () => {
    it('deve processar campos de formulário', async () => {
      const fields = {};
      const files = [];

      mockBusboy.on.mockImplementation((event, handler) => {
        if (event === 'field') {
          // Simula recebimento de campo
          setTimeout(() => {
            handler('tenantId', 'test-tenant');
            handler('category', 'test-category');
          }, 10);
        } else if (event === 'finish') {
          setTimeout(() => handler(), 50);
        }
      });

      const result = await parseMultipartFormData(mockReq);

      expect(mockBusboy.on).toHaveBeenCalledWith('field', expect.any(Function));
      expect(mockBusboy.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('deve processar arquivos', async () => {
      const mockFile = {
        fieldname: 'file',
        filename: 'test.txt',
        encoding: '7bit',
        mimeType: 'text/plain',
        buffer: Buffer.from('conteúdo de teste'),
        size: 18,
      };

      mockBusboy.on.mockImplementation((event, handler) => {
        if (event === 'file') {
          setTimeout(() => {
            const mockFileStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from('conteúdo de teste')), 10);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 20);
                }
              }),
            };
            handler('file', mockFileStream, {
              filename: 'test.txt',
              encoding: '7bit',
              mimeType: 'text/plain',
            });
          }, 10);
        } else if (event === 'finish') {
          setTimeout(() => handler(), 50);
        }
      });

      const result = await parseMultipartFormData(mockReq);

      expect(mockBusboy.on).toHaveBeenCalledWith('file', expect.any(Function));
    });

    it('deve tratar erros durante processamento', async () => {
      const error = new Error('Erro ao processar');

      mockBusboy.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(error), 10);
        }
      });

      await expect(parseMultipartFormData(mockReq)).rejects.toThrow('Erro ao processar');
    });

    it('deve retornar estrutura correta com campos e arquivos', async () => {
      mockBusboy.on.mockImplementation((event, handler) => {
        if (event === 'field') {
          setTimeout(() => {
            handler('tenantId', 'test-tenant');
          }, 10);
        } else if (event === 'file') {
          setTimeout(() => {
            const mockFileStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from('test')), 10);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 20);
                }
              }),
            };
            handler('file', mockFileStream, {
              filename: 'test.txt',
              encoding: '7bit',
              mimeType: 'text/plain',
            });
          }, 10);
        } else if (event === 'finish') {
          setTimeout(() => handler(), 50);
        }
      });

      const result = await parseMultipartFormData(mockReq);

      expect(result).toHaveProperty('fields');
      expect(result).toHaveProperty('files');
      expect(Array.isArray(result.files)).toBe(true);
    });
  });
});

