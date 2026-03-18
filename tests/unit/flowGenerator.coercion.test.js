'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('flowGenerator coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('generateFlowFromDescription tolerates hostile fs read error in node types loading', async () => {
    const hostileFsError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('fs', () => {
      const realFs = jest.requireActual('fs');
      return {
        ...realFs,
        readFileSync: jest.fn(() => {
          throw hostileFsError;
        }),
      };
    });

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({
        text: JSON.stringify({
          action: 'create_flow',
          metadata: { name: 'Fluxo Teste', description: 'desc' },
          nodes: [
            { id: 'n1', type: 'start', config: {}, next: 'n2' },
            { id: 'n2', type: 'message', config: { text: 'ok' } },
          ],
          edges: [{ from: 'n1', to: 'n2' }],
        }),
      })),
    }));

    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
    }));

    const { generateFlowFromDescription } = require('../../api/services/flowGenerator');
    const flow = await generateFlowFromDescription('quero um fluxo simples', 'tenant-1');

    expect(flow).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      name: 'Fluxo Teste',
    }));
    expect(Array.isArray(flow.nodes)).toBe(true);
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/flowGenerator.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
