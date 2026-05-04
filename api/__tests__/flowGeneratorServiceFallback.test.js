describe('flowGeneratorService fallback hardening', () => {
  test('generateFlowFromKeywords sempre inclui pelo menos 1 nó fallback', () => {
    // eslint-disable-next-line global-require
    const { generateFlowFromKeywords } = require('../services/flowGeneratorService');

    const flow = generateFlowFromKeywords('Qualquer descrição simples', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-keywords',
      flowName: 'Flow Test Keywords',
    });

    expect(flow).toHaveProperty('nodes');
    expect(Array.isArray(flow.nodes)).toBe(true);
    expect(flow.nodes.some((n) => n && n.type === 'fallback')).toBe(true);

    // ✅ Fallback deve usar next como mapa e apontar para o end
    const endNodeId = flow.nodes.find((n) => n && n.type === 'end')?.id;
    const fallbackNode = flow.nodes.find((n) => n && n.type === 'fallback');
    expect(endNodeId).toBeTruthy();
    expect(fallbackNode).toBeTruthy();
    expect(fallbackNode.next).toBeTruthy();
    expect(typeof fallbackNode.next).toBe('object');
    expect(fallbackNode.next.end).toBe(endNodeId);
  });

  test('generateFlowFromDescription injeta nó fallback quando wrapper não retornar fallback', async () => {
    jest.resetModules();

    const runtimePathsPath = require.resolve('../utils/runtimePaths');
    jest.doMock(runtimePathsPath, () => ({
      resolveRuntimePath: (...parts) => require('path').join('/tmp/jest-runtime-mock', ...parts),
      resolveRuntimeRoot: () => '/tmp/jest-runtime-mock',
      runtimePathExists: () => false,
    }));

    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async () => ({
        success: true,
        flowDefinition: {
          id: 'flow-test-desc',
          tenantId: 'tenant-demo',
          name: 'Mock Flow',
          version: 1,
          // Sem fallback propositalmente
          nodes: [
            { id: 'start', type: 'start', next: 'msg' },
            { id: 'msg', type: 'message', config: { text: 'Olá' }, next: 'end' },
            { id: 'end', type: 'end' },
          ],
          metadata: { generated: true },
        },
        validation: { valid: true, errors: [], warnings: [], domain: 'chatbot' },
        envelope: { output: { metadata: { name: 'Mock Flow' }, nodes: [] } },
        promptVersion: 'test',
      }),
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flow = await generateFlowFromDescription('Descrição qualquer', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-desc',
      flowName: 'Flow Test Desc',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    expect(flow).toHaveProperty('nodes');
    expect(Array.isArray(flow.nodes)).toBe(true);
    expect(flow.nodes.some((n) => n && n.type === 'fallback')).toBe(true);

    // ✅ Fallback injetado deve usar next como mapa e apontar para o end
    const endNodeId = flow.nodes.find((n) => n && n.type === 'end')?.id;
    const fallbackNode = flow.nodes.find((n) => n && n.type === 'fallback');
    expect(endNodeId).toBeTruthy();
    expect(fallbackNode).toBeTruthy();
    expect(fallbackNode.next).toBeTruthy();
    expect(typeof fallbackNode.next).toBe('object');
    expect(fallbackNode.next.end).toBe(endNodeId);
  });

  test('generateFlowFromDescription preserva next como objeto ao corrigir destinos inexistentes', async () => {
    jest.resetModules();

    const runtimePathsPath = require.resolve('../utils/runtimePaths');
    jest.doMock(runtimePathsPath, () => ({
      resolveRuntimePath: (...parts) => require('path').join('/tmp/jest-runtime-mock', ...parts),
      resolveRuntimeRoot: () => '/tmp/jest-runtime-mock',
      runtimePathExists: () => false,
    }));

    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async () => ({
        success: true,
        flowDefinition: {
          id: 'flow-test-next-object',
          tenantId: 'tenant-demo',
          name: 'Mock Flow (next object)',
          version: 1,
          nodes: [
            { id: 'start', type: 'start', next: 'msg' },
            // next como objeto apontando para nó inexistente ("missing") — deve ser corrigido para end, sem colapsar para string
            { id: 'msg', type: 'message', config: { text: 'Olá' }, next: { out: 'missing' } },
            { id: 'end', type: 'end' },
          ],
          metadata: { generated: true },
        },
        validation: { valid: true, errors: [], warnings: [], domain: 'chatbot' },
        envelope: { output: { metadata: { name: 'Mock Flow (next object)' }, nodes: [] } },
        promptVersion: 'test',
      }),
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flow = await generateFlowFromDescription('Descrição qualquer', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-next-object',
      flowName: 'Flow Test Next Object',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    const endNodeId = flow.nodes.find((n) => n && n.type === 'end')?.id;
    const msgNode = flow.nodes.find((n) => n && n.id === 'msg');
    expect(endNodeId).toBeTruthy();
    expect(msgNode).toBeTruthy();
    expect(typeof msgNode.next).toBe('object');
    expect(msgNode.next.out).toBe(endNodeId);
  });

  test('generateFlowFromDescription tenta corrigir 3x e consegue na 3ª', async () => {
    jest.resetModules();

    const runtimePathsPath = require.resolve('../utils/runtimePaths');
    jest.doMock(runtimePathsPath, () => ({
      resolveRuntimePath: (...parts) => require('path').join('/tmp/jest-runtime-mock', ...parts),
      resolveRuntimeRoot: () => '/tmp/jest-runtime-mock',
      runtimePathExists: () => false,
    }));

    let calls = 0;
    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async () => {
        calls += 1;
        if (calls < 3) {
          return {
            success: false,
            flowDefinition: {
              id: 'flow-test-retry-ok',
              tenantId: 'tenant-demo',
              name: 'Mock Invalid Flow',
              version: 1,
              nodes: [
                { id: 'start', type: 'start', next: 'end' },
                { id: 'end', type: 'end' },
              ],
              metadata: { generated: true },
            },
            // Importante: nosso serviço pode usar envelope.output como candidato (safe-mode)
            envelope: {
              output: {
                metadata: { name: 'Mock Invalid Flow' },
                nodes: [
                  { id: 'start', type: 'start', next: 'end' },
                  { id: 'end', type: 'end' },
                ],
              },
            },
            validation: {
              valid: false,
              errors: [{ type: 'GATE', message: 'Falhou no gate' }],
              warnings: [],
              domain: 'chatbot',
            },
            promptVersion: 'test',
            error: { type: 'VALIDATION_FAILED', message: 'Gate rejeitou' },
          };
        }
        return {
          success: true,
          flowDefinition: {
            id: 'flow-test-retry-ok',
            tenantId: 'tenant-demo',
            name: 'Mock Flow OK',
            version: 1,
            nodes: [
              { id: 'start', type: 'start', next: 'msg' },
              { id: 'msg', type: 'message', config: { text: 'Olá' }, next: 'end' },
              { id: 'end', type: 'end' },
            ],
            metadata: { generated: true },
          },
          validation: { valid: true, errors: [], warnings: [], domain: 'chatbot' },
          envelope: { output: { metadata: { name: 'Mock Flow OK' }, nodes: [] } },
          promptVersion: 'test',
        };
      },
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flow = await generateFlowFromDescription('Descrição qualquer', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-retry-ok',
      flowName: 'Flow Test Retry OK',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    expect(calls).toBe(3);
    expect(flow).toHaveProperty('nodes');
    expect(Array.isArray(flow.nodes)).toBe(true);
    expect(flow.nodes.some((n) => n && n.type === 'fallback')).toBe(true);
    expect(flow).toHaveProperty('metadata');
    expect(flow.metadata).toHaveProperty('aiGeneration');
    expect(flow.metadata.aiGeneration.usedFallback).toBe(false);
    expect(Array.isArray(flow.metadata.aiGeneration.attempts)).toBe(true);
    expect(flow.metadata.aiGeneration.attempts.length).toBe(3);
  });

  test('generateFlowFromDescription tenta corrigir 3x e cai no fallback', async () => {
    jest.resetModules();

    const runtimePathsPath = require.resolve('../utils/runtimePaths');
    jest.doMock(runtimePathsPath, () => ({
      resolveRuntimePath: (...parts) => require('path').join('/tmp/jest-runtime-mock', ...parts),
      resolveRuntimeRoot: () => '/tmp/jest-runtime-mock',
      runtimePathExists: () => false,
    }));

    let calls = 0;
    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async () => {
        calls += 1;
        return {
          success: false,
          flowDefinition: {
            id: 'flow-test-retry-fallback',
            tenantId: 'tenant-demo',
            name: 'Mock Invalid Flow',
            version: 1,
            nodes: [
              { id: 'start', type: 'start', next: 'end' },
              { id: 'end', type: 'end' },
            ],
            metadata: { generated: true },
          },
          validation: {
            valid: false,
            errors: [{ type: 'GATE', message: 'Falhou no gate' }],
            warnings: [],
            domain: 'chatbot',
          },
          promptVersion: 'test',
          error: { type: 'VALIDATION_FAILED', message: 'Gate rejeitou' },
        };
      },
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flow = await generateFlowFromDescription('Descrição qualquer', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-retry-fallback',
      flowName: 'Flow Test Retry Fallback',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    expect(calls).toBe(3);
    expect(flow).toHaveProperty('nodes');
    expect(Array.isArray(flow.nodes)).toBe(true);
    // Fallback por palavras-chave deve sempre incluir fallback
    expect(flow.nodes.some((n) => n && n.type === 'fallback')).toBe(true);
    expect(flow).toHaveProperty('metadata');
    expect(flow.metadata).toHaveProperty('aiGeneration');
    expect(flow.metadata.aiGeneration.usedFallback).toBe(true);
    expect(Array.isArray(flow.metadata.aiGeneration.attempts)).toBe(true);
    expect(flow.metadata.aiGeneration.attempts.length).toBe(3);
  });
});

