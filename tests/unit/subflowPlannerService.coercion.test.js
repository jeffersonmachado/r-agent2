'use strict';

/**
 * Coercion-guard tests for subflowPlannerService.js
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../api/services/aiProviderService', () => ({
  generateAiResponse: jest.fn(),
}));

const { generateAiResponse } = require('../../api/services/aiProviderService');
const { planSubflows } = require('../../api/services/subflowPlannerService');
const fs = require('fs');
const path = require('path');

function hostileToString() {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', {
    get() {
      throw new Error('hostile toString');
    },
  });
  Object.defineProperty(o, 'valueOf', {
    get() {
      throw new Error('hostile valueOf');
    },
  });
  return o;
}

function hostileErr() {
  const e = new Error('real');
  Object.defineProperty(e, 'message', {
    get() {
      throw new Error('hostile message getter');
    },
  });
  return e;
}

describe('subflowPlannerService coercion guards', () => {
  beforeEach(() => {
    generateAiResponse.mockReset();
  });

  test('planSubflows: hostile description does not throw', async () => {
    const out = await planSubflows({ tenantId: 't1', description: hostileToString() });
    expect(Array.isArray(out)).toBe(true);
  });

  test('planSubflows: hostile err.message from AI provider does not throw', async () => {
    generateAiResponse.mockRejectedValue(hostileErr());
    const out = await planSubflows({ tenantId: 't1', description: 'fluxo completo de atendimento' });
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });

  test('planSubflows: hostile AI fields in JSON do not throw', async () => {
    generateAiResponse.mockResolvedValue({
      text: JSON.stringify({
        subflows: [
          { name: hostileToString(), description: hostileToString(), role: hostileToString() },
          { name: 'Apoio', description: 'Descricao suficientemente longa para passar no filtro minimo', role: 'helper' },
        ],
      }),
    });
    const out = await planSubflows({ tenantId: 't1', description: 'fluxo com multiplas etapas' });
    expect(Array.isArray(out)).toBe(true);
  });

  test('static guard: service nao deve usar err.message || String(err)', () => {
    const servicePath = path.join(__dirname, '../../api/services/subflowPlannerService.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)/);
    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)\s*\|\|\s*fallback/);
  });
});
