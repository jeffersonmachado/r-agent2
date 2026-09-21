'use strict';

/**
 * Testes de contrato do CODER/REVIEWER do Engineering Model Router V1.
 *
 * Usa um fake provider registrado através do MESMO `registerAiProvider` real usado em
 * produção (`api/services/aiProviderManager.js`) — não um mock que baipassa a arquitetura.
 * O fake respeita EXATAMENTE o contrato real: `generate(prompt, context) -> {text, usage}`.
 */

const { registerAiProvider, clearAiProviderConfig, getProviderInstance } = require('../../api/services/aiProviderManager');
const { generatePatch } = require('../../api/services/engineeringRouter/coderService');
const { review } = require('../../api/services/engineeringRouter/reviewerService');

const VALID_DIFF = `diff --git a/src/foo.js b/src/foo.js\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -1,3 +1,3 @@\n function foo() {\n-  return 1;\n+  return 2;\n }\n`;

function registerFakeProvider(id, generateImpl) {
  registerAiProvider(id, { generate: generateImpl });
}

describe('contrato: coderService + reviewerService', () => {
  afterEach(() => {
    clearAiProviderConfig();
  });

  test('coderService.generatePatch extrai summary+diff de uma resposta JSON válida do provider', async () => {
    registerFakeProvider('fake-coder', async (prompt, context) => {
      expect(context.model).toBe('fake-model-1');
      expect(context.tenantId).toBe('system');
      return {
        text: `\`\`\`json\n${JSON.stringify({ summary: 'corrige retorno', diff: VALID_DIFF })}\n\`\`\``,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
    });

    const context = {
      task: { id: 't1', title: 'x', objective: 'y', taskType: 'BUG_FIX', risk: 'LOW', scope: 'SMALL', acceptanceCriteria: [], allowedPaths: ['src/**'], forbiddenPaths: [] },
      files: [{ path: 'src/foo.js', content: 'function foo() { return 1; }' }],
      failureBundle: null,
      previousAttemptSummary: null,
    };

    const result = await generatePatch({ context, providerId: 'fake-coder', modelId: 'fake-model-1', tenantId: 'system' });
    expect(result.summary).toBe('corrige retorno');
    expect(result.diff).toBe(VALID_DIFF);
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  test('coderService.generatePatch falha explicitamente (PATCH_INVALID_FORMAT) se o provider responder texto livre', async () => {
    registerFakeProvider('fake-coder-2', async () => ({ text: 'mude o arquivo assim: troque 1 por 2', usage: null }));
    const context = { task: { id: 't1', allowedPaths: [] }, files: [] };
    await expect(generatePatch({ context, providerId: 'fake-coder-2', modelId: 'm', tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'PATCH_INVALID_FORMAT' });
  });

  test('coderService.generatePatch propaga PROVIDER_UNAVAILABLE quando o provider não está registrado', async () => {
    const context = { task: { id: 't1', allowedPaths: [] }, files: [] };
    await expect(generatePatch({ context, providerId: 'provider-inexistente', modelId: 'm', tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  test('reviewerService.review aceita APPROVE sem findings bloqueantes', async () => {
    registerFakeProvider('fake-reviewer', async () => ({
      text: JSON.stringify({ decision: 'APPROVE', findings: [] }),
      usage: null,
    }));
    const result = await review({
      task: { id: 't1', allowedPaths: ['src/**'] },
      diff: VALID_DIFF,
      testEvidence: { exitCode: 0 },
      contextFiles: [],
      providerId: 'fake-reviewer',
      modelId: 'm',
      tenantId: 'system',
    });
    expect(result.decision).toBe('APPROVE');
  });

  test('reviewerService.review rejeita formato inválido: REJECT sem nenhum finding BLOCKER/REGRESSION', async () => {
    registerFakeProvider('fake-reviewer-2', async () => ({
      text: JSON.stringify({ decision: 'REJECT', findings: [{ severity: 'POST_RELEASE', category: 'style', description: 'x', file: null, line: null, releaseBlocking: false, evidence: 'x' }] }),
      usage: null,
    }));
    await expect(review({
      task: { id: 't1' }, diff: VALID_DIFF, testEvidence: {}, contextFiles: [],
      providerId: 'fake-reviewer-2', modelId: 'm', tenantId: 'system',
    })).rejects.toMatchObject({ code: 'PATCH_INVALID_FORMAT' });
  });

  test('reviewerService.review aceita REJECT com finding BLOCKER', async () => {
    registerFakeProvider('fake-reviewer-3', async () => ({
      text: JSON.stringify({
        decision: 'REJECT',
        findings: [{ severity: 'BLOCKER', category: 'security', description: 'SQL injection', file: 'src/foo.js', line: 2, releaseBlocking: true, evidence: 'string concat' }],
      }),
      usage: null,
    }));
    const result = await review({
      task: { id: 't1' }, diff: VALID_DIFF, testEvidence: {}, contextFiles: [],
      providerId: 'fake-reviewer-3', modelId: 'm', tenantId: 'system',
    });
    expect(result.decision).toBe('REJECT');
    expect(result.findings[0].severity).toBe('BLOCKER');
  });

  test('getProviderInstance nunca finge sucesso: propaga erro real do provider registrado', async () => {
    registerFakeProvider('fake-flaky', async () => { throw new Error('rede indisponível'); });
    const provider = getProviderInstance('fake-flaky');
    await expect(provider.generate('prompt', { tenantId: 'system' })).rejects.toThrow('rede indisponível');
  });
});
