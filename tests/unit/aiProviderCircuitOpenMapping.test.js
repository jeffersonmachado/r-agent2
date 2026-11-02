'use strict';

/**
 * Regressão do defeito medido no QA Mesh `mesh-2026-10-19T18-38-34-650Z`,
 * cenário `business-core-biz-flows-editor` (domínio crítico `core`):
 *
 *   "500 Internal Server Error: Provider de IA 'qwen' indisponível
 *    (circuit breaker aberto)."
 *
 * Os handlers de geração já classificavam `AI_PROVIDER_NOT_CONFIGURED` e
 * `AI_GENERATION_FAILED` como 400 estruturado ("nunca 500"), mas a lista era
 * duplicada em quatro pontos e omitia `provider_circuit_open`, o código que
 * `api/services/aiControlPlaneStatus.js` emite quando o breaker abre. A
 * indisponibilidade do provider caía no `else` → 500 → o cenário de contrato
 * reprovava e o selo abortava no `prepare`.
 *
 * Este teste trava os dois sentidos:
 *  1. `provider_circuit_open` responde 400 estruturado (é indisponibilidade de
 *     dependência, não erro interno);
 *  2. erro realmente interno CONTINUA 500 — nada foi engolido.
 */

const { handleFlowGenerationRoutes } = require('../../api/modules/domain-flow/flow-execution/flowGenerationRoutes');
jest.mock('../../api/services/generationOrchestrator', () => ({ orchestrateGeneration: jest.fn() }));

const { handleAiChatbotOrchestratorRoutes } = require('../../api/modules/platform-content/handleAiChatbotOrchestratorRoutes');
const { orchestrateGeneration: realOrchestrator } = require('../../api/services/generationOrchestrator');
const {
  isStructuredAiClientError,
  AI_STRUCTURED_ERROR_CODES,
} = require('../../api/utils/aiStructuredError');

function makeDeps(overrides = {}) {
  return {
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ name: 'QA Gen', description: 'fluxo' })),
    logger: { error: jest.fn() },
    orchestrateGeneration: jest.fn(async () => ({ success: true })),
    registerGeneration: jest.fn(async () => 'audit-1'),
    generateAuditReport: jest.fn(async () => ({ reportId: 'rep-1' })),
    STRICT_TENANT_MODE: false,
    requireAuth: jest.fn(() => ({ valid: true })),
    requireTenant: jest.fn(() => 'system'),
    ...overrides,
  };
}

function ctx(deps, pathname) {
  return {
    req: { tenantId: 'system', headers: {}, url: pathname },
    res: {},
    method: 'POST',
    pathname,
    deps,
  };
}

function erroComCodigo(code, message = 'falha do provider') {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('classificação de erro de IA — provider indisponível não é 500', () => {
  test('helper reconhece provider_circuit_open e mantém a lista canônica', () => {
    expect(isStructuredAiClientError(erroComCodigo('provider_circuit_open'))).toBe(true);
    expect(isStructuredAiClientError(erroComCodigo('AI_GENERATION_FAILED'))).toBe(true);
    expect(isStructuredAiClientError(erroComCodigo('FLOW_DISCONNECTED'))).toBe(true);
    expect(isStructuredAiClientError(erroComCodigo('NOT_FOUND'))).toBe(false);
    expect(isStructuredAiClientError(null)).toBe(false);
    expect(AI_STRUCTURED_ERROR_CODES.has('provider_circuit_open')).toBe(true);
  });

  test.each(['/flows/generate', '/flows/generate/dry-run'])(
    '%s responde 400 estruturado quando o breaker do provider está aberto',
    async (pathname) => {
      const deps = makeDeps({
        orchestrateGeneration: jest.fn(async () => {
          throw erroComCodigo(
            'provider_circuit_open',
            "Provider de IA 'qwen' indisponível (circuit breaker aberto).",
          );
        }),
      });

      const handled = await handleFlowGenerationRoutes(ctx(deps, pathname));

      expect(handled).toBe(true);
      expect(deps.sendJson).toHaveBeenCalledWith(
        expect.anything(),
        400,
        expect.objectContaining({ error: 'bad_request' }),
      );
      expect(deps.sendJson).not.toHaveBeenCalledWith(
        expect.anything(),
        500,
        expect.anything(),
      );
      expect(deps.logger.error).not.toHaveBeenCalled();
    },
  );

  test('erro interno de verdade continua 500 (nada foi engolido)', async () => {
    const deps = makeDeps({
      orchestrateGeneration: jest.fn(async () => {
        throw new Error('falha inesperada no orquestrador');
      }),
    });

    await handleFlowGenerationRoutes(ctx(deps, '/flows/generate'));

    expect(deps.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({ error: 'internal_error' }),
    );
    expect(deps.logger.error).toHaveBeenCalled();
  });
});

describe('timeout de provider de IA — falha agregada do contrato, não 500', () => {
  // Defeito medido no QA Mesh `mesh-2026-11-02T11-41-51-497Z`: o cenário
  // `business-core-biz-flows-editor` declara em contrato "ai/rpa/generate
  // responde com contrato estruturado (sucesso ou falha agregada)", mas
  // `ai_timeout` ficava fora da lista canônica e virava 500 → infra_error no
  // domínio crítico `core` → mesh NO_GO → convergência abortada no passo 8/12.
  test('helper reconhece ai_timeout (o código real de aiProviderManager)', () => {
    expect(isStructuredAiClientError(erroComCodigo('ai_timeout'))).toBe(true);
    expect(isStructuredAiClientError(erroComCodigo('AI_TIMEOUT'))).toBe(true);
    expect(AI_STRUCTURED_ERROR_CODES.has('ai_timeout')).toBe(true);
  });

  test('/ai/rpa/generate responde 400 estruturado quando o provider estoura o timeout', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ userInput: 'Plano RPA simples de boas-vindas', options: {} })),
    });
    realOrchestrator.mockImplementation(async () => {
      throw erroComCodigo('ai_timeout', 'ai_timeout: provider de IA excedeu 45000ms');
    });

    const handled = await handleAiChatbotOrchestratorRoutes(
      ctx(deps, '/ai/rpa/generate'),
    );

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ error: 'bad_request' }),
    );
    expect(deps.sendJson).not.toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.anything(),
    );
  });

  test('/ai/rpa/generate mantém 500 para falha interna real', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ userInput: 'Plano RPA simples de boas-vindas', options: {} })),
    });
    realOrchestrator.mockImplementation(async () => {
      throw new Error('falha inesperada no orquestrador');
    });

    await handleAiChatbotOrchestratorRoutes(ctx(deps, '/ai/rpa/generate'));

    expect(deps.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({ error: 'internal_error' }),
    );
  });
});
