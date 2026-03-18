'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('departmentsService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ Department: jest.fn() }));
  });

  test('createDepartment com name hostil nao estoura e retorna erro de validacao', () => {
    const { createDepartment } = require('../../api/services/departmentsService');
    const hostile = { toString() { throw new Error('boom-name'); } };

    const out = createDepartment({
      tenantId: 'tenant-1',
      name: hostile,
      description: 'desc',
      createdBy: 'agent-1',
    });

    expect(out).toEqual({ success: false, error: 'Nome do departamento é obrigatório' });
  });

  test('createDepartment com description/color hostis aplica fallback sem excecao', () => {
    const { createDepartment } = require('../../api/services/departmentsService');
    const hostile = { toString() { throw new Error('boom-field'); } };

    const out = createDepartment({
      tenantId: 'tenant-1',
      name: 'Financeiro',
      description: hostile,
      color: hostile,
      createdBy: 'agent-1',
    });

    expect(out.success).toBe(true);
    expect(out.department).toEqual(expect.objectContaining({
      name: 'Financeiro',
      description: '',
      color: '#3B82F6',
    }));
  });

  test('updateDepartment com name hostil nao estoura', () => {
    const { createDepartment, updateDepartment } = require('../../api/services/departmentsService');
    const hostile = { toString() { throw new Error('boom-update'); } };

    const created = createDepartment({
      tenantId: 'tenant-1',
      name: 'Comercial',
      description: 'x',
      createdBy: 'agent-1',
    });

    expect(created.success).toBe(true);

    const out = updateDepartment(created.department.id, {
      name: hostile,
      description: hostile,
      color: hostile,
    });

    expect(out.success).toBe(true);
    expect(out.department).toEqual(expect.objectContaining({
      name: '',
      description: '',
      color: '',
    }));
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
      Department: jest.fn(() => ({
        findAll: jest.fn(async () => {
          throw hostileError;
        }),
      })),
    }));

    const logger = require('../../api/utils/logger');
    const { initialize } = require('../../api/services/departmentsService');

    await expect(initialize()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[DepartmentsService] Falha ao inicializar cache do PostgreSQL',
      expect.objectContaining({ error: '' })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/departmentsService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
