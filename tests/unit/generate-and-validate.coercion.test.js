'use strict';

/**
 * Coercion-guard tests for generate-and-validate.js
 * Verifies hostile err.message getters do not crash catch blocks.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../api/utils/contractValidator', () => ({
  validateGenerationContract: jest.fn(() => ({ valid: true, errors: [] })),
}));

jest.mock('../../api/services/generationOrchestrator', () => ({
  orchestrateGeneration: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../engine/validator', () => ({
  validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
}));

jest.mock('../../infra/rate-limit', () => ({
  enforceRateLimit: jest.fn(),
}));

jest.mock('../../api/services/pipelineExecutionContext', () => ({
  ensureExecutionContext: jest.fn((payload, options) => ({
    executionId: payload?.executionId || 'exec-coercion',
    payload: payload || {},
    options: options || {},
    status: 'running',
    currentStage: null,
    stages: {},
  })),
  requireStages: jest.fn(),
  updateStage: jest.fn(),
  updateStatus: jest.fn(),
  tryApprove: jest.fn(),
  toProgressFormat: jest.fn(() => ({})),
}));

jest.mock('../../api/services/pipelineOrchestrator', () => ({
  advancePipeline: jest.fn(async () => ({ shouldContinue: false })),
}));

jest.mock('../../api/services/superAdminService', () => ({
  isSuperAdmin: jest.fn(() => false),
}));

jest.mock('../../core/rpa/rpaTestRunner', () => ({
  RpaTestRunner: jest.fn(),
}));

const { enforceRateLimit } = require('../../infra/rate-limit');
const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const pipelineContext = require('../../api/services/pipelineExecutionContext');
const { generateAndValidate, executeRpaTest } = require('../../api/services/generate-and-validate');
const fs = require('fs');
const path = require('path');

function hostileErr() {
  const e = new Error('real');
  Object.defineProperty(e, 'message', {
    get() {
      throw new Error('hostile message getter');
    },
  });
  Object.defineProperty(e, 'toString', {
    get() {
      throw new Error('hostile toString getter');
    },
  });
  return e;
}

describe('generate-and-validate coercion guards', () => {
  beforeEach(() => {
    enforceRateLimit.mockReset();
    RpaTestRunner.mockReset();
    pipelineContext.ensureExecutionContext.mockImplementation((payload, options) => ({
      executionId: payload?.executionId || 'exec-coercion',
      payload: payload || {},
      options: options || {},
      status: 'running',
      currentStage: null,
      stages: {},
    }));
    pipelineContext.requireStages.mockImplementation(() => {});
    pipelineContext.updateStage.mockImplementation(() => {});
    pipelineContext.updateStatus.mockImplementation(() => {});
    pipelineContext.tryApprove.mockImplementation(() => {});
    pipelineContext.toProgressFormat.mockImplementation(() => ({}));
  });

  test('generateAndValidate: hostile err.message during rate-limit failure does not throw', async () => {
    enforceRateLimit.mockImplementation(async () => {
      throw hostileErr();
    });

    const out = await generateAndValidate(
      { name: 'coercion-test', executionId: 'exec-coercion-1', executionMode: 'real' },
      { tenantId: 'tenant-1' }
    );

    expect(out.success).toBe(false);
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(typeof out.motivo).toBe('string');
  });

  test('executeRpaTest: hostile err.message in catch returns safe fallback', async () => {
    const close = jest.fn(async () => true);
    RpaTestRunner.mockImplementation(() => ({
      init: jest.fn(async () => {
        throw hostileErr();
      }),
      playback: jest.fn(),
      generateReport: jest.fn(() => ({})),
      close,
    }));

    const out = await executeRpaTest('/tmp/non-existent-rpa-test.json');

    expect(out.success).toBe(false);
    expect(typeof out.error).toBe('string');
  });

  test('static guard: service nao deve usar return err.message || String(err)', () => {
    const servicePath = path.join(__dirname, '../../api/services/generate-and-validate.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)/);
    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)\s*\|\|\s*fallback/);
  });
});
