'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('quickRepliesService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ QuickReply: jest.fn() }));
  });

  test('createQuickReply com title/message hostis nao estoura e retorna validacao', () => {
    const { createQuickReply } = require('../../api/services/quickRepliesService');
    const hostile = { toString() { throw new Error('boom-title'); } };

    const out = createQuickReply({
      tenantId: 'tenant-1',
      title: hostile,
      message: hostile,
      tags: ['A'],
      category: 'geral',
    });

    expect(out).toEqual({ success: false, error: 'Título e mensagem são obrigatórios' });
  });

  test('updateQuickReply com title hostil retorna erro sem throw', () => {
    const { createQuickReply, updateQuickReply } = require('../../api/services/quickRepliesService');
    const hostile = { toString() { throw new Error('boom-update-title'); } };

    const created = createQuickReply({
      tenantId: 'tenant-1',
      title: 'Saudação',
      message: 'Olá!',
      tags: ['Oi'],
      category: 'Geral',
    });

    expect(created.success).toBe(true);

    const out = updateQuickReply(created.quickReply.id, { title: hostile });
    expect(out).toEqual({ success: false, error: 'Título não pode estar vazio' });
  });

  test('listQuickReplies com search hostil nao estoura', () => {
    const { createQuickReply, listQuickReplies } = require('../../api/services/quickRepliesService');
    const hostile = { toString() { throw new Error('boom-search'); } };

    createQuickReply({
      tenantId: 'tenant-1',
      title: 'Boas-vindas',
      message: 'Seja bem-vindo',
      tags: ['inicio'],
      category: 'geral',
    });

    const out = listQuickReplies({
      tenantId: 'tenant-1',
      search: hostile,
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  test('initialize tolera getter hostil em error.message de falha no DB', async () => {
    jest.resetModules();
    jest.clearAllMocks();

    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({ ok: true })) }));
    jest.doMock('../../api/db/models', () => ({
      QuickReply: jest.fn(() => ({
        findAll: jest.fn(async () => {
          throw hostileError;
        }),
      })),
    }));

    const logger = require('../../api/utils/logger');
    const { initialize } = require('../../api/services/quickRepliesService');

    await expect(initialize()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[QuickRepliesService] Falha ao inicializar cache do PostgreSQL',
      expect.objectContaining({ error: '' })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/quickRepliesService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
