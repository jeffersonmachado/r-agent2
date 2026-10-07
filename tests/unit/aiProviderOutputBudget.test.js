'use strict';

/**
 * REGRESSÃO DOS DOIS BLOQUEIOS COMPROVADOS DO ENGINEER ROUTER (bootstrap humano/externo, 2026-10-07).
 *
 * Contexto MEDIDO (não hipótese): com o prompt REAL do CODER (~65 KB), toda EngineeringTask
 * terminava RED com `PATCH_INVALID_FORMAT / NO_JSON_FOUND`, `patch_diff` vazio, sempre no MESMO
 * modelo, 4/4 tentativas. Duas causas, ambas exercitadas por este arquivo:
 *
 *   1. `max_tokens: 1000` HARDCODED nos providers DeepSeek e Kimi (só a OpenAI usava a tabela
 *      adaptativa). Modelos que emitem reasoning gastavam o orçamento INTEIRO em
 *      `reasoning_tokens` e devolviam `content` vazio (medido: completion_tokens=1000,
 *      reasoning_tokens=1000, content="").
 *   2. a saída inutilizável era MASCARADA como texto (`content || '[Resposta vazia da X]'`), então
 *      a falha chegava ao CODER como "texto sem JSON" (`NO_JSON_FOUND`) — uma classe que o Router
 *      NÃO reroteia: ele repetia o mesmo modelo até esgotar `max_iterations`.
 *
 * O que este arquivo prova (com o CÓDIGO REAL dos providers, não um caminho paralelo de teste):
 *   - o orçamento de saída é adaptativo por tamanho de prompt e reserva reasoning para os modelos
 *     que o consomem, com teto absoluto;
 *   - DeepSeek/Kimi/compatíveis ENVIAM esse orçamento (regressão direta do 1000 fixo);
 *   - resposta vazia/truncada sobe como falha CLASSIFICADA, nunca como texto;
 *   - a falha atravessa `engineeringAiInvoker` como `PROVIDER_UNAVAILABLE` preservando o código
 *     original — exatamente o branch em que o Router dispara `outcome: 'REROUTE'`
 *     (fallback/escalation), em vez de repetir o modelo quebrado.
 */

jest.mock('../../api/services/tenantAIService', () => ({
  getDecryptedAPIKey: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const {
  resolveMaxOutputTokens,
  usableTextOrThrow,
  OUTPUT_TOKEN_BUDGET,
  REASONING_TOKEN_RESERVE,
  PROVIDER_OUTPUT_FAILURE_CODES,
  createDeepSeekProvider,
  createKimiProvider,
  createOpenAICompatibleProvider,
} = require('../../api/services/aiProviderService');
const tenantAIService = require('../../api/services/tenantAIService');
const logger = require('../../api/utils/logger');
const { invokeModel } = require('../../api/services/engineeringRouter/engineeringAiInvoker');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');

const ROOT = path.resolve(__dirname, '..', '..');
const TENANT_ID = 'jest-unit-output-budget';
const originalFetch = global.fetch;

/** Prompt do porte do REAL (o CODER recebe contrato da task + arquivos de contexto). */
const ENGINEERING_PROMPT = 'FATO DE CONTEXTO: arquivo do repositorio.\n'.repeat(1700);

const QWEN_DEF = Object.freeze({
  id: 'qwen',
  label: 'Qwen (Alibaba Cloud)',
  baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen3-max',
});

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

/** Assinatura REAL medida em 2026-10-07: orçamento inteiro consumido por reasoning. */
function emptyBecauseReasoning(finishReason = 'length') {
  return okJson({
    choices: [{ message: { content: '' }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 19076,
      completion_tokens: 1000,
      completion_tokens_details: { reasoning_tokens: 1000 },
    },
  });
}

function lastRequest() {
  return global.fetch.mock.calls[0];
}

beforeEach(() => {
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  tenantAIService.getDecryptedAPIKey.mockReset();
  tenantAIService.getDecryptedAPIKey.mockResolvedValue('jest-fake-key');
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const id of ['deepseek', 'kimi', 'qwen']) clearAiProviderConfig(id);
  jest.restoreAllMocks();
});

describe('orçamento de saída adaptativo (regressão: max_tokens 1000 fixo)', () => {
  test('tiers crescentes por tamanho de prompt (nunca volta ao 1000 fixo em prompt real)', () => {
    expect(resolveMaxOutputTokens('gpt-4o', 100)).toBe(OUTPUT_TOKEN_BUDGET.BASE);
    expect(resolveMaxOutputTokens('gpt-4o', 3000)).toBe(OUTPUT_TOKEN_BUDGET.MEDIUM_PROMPT);
    expect(resolveMaxOutputTokens('gpt-4o', 6000)).toBe(OUTPUT_TOKEN_BUDGET.LARGE_PROMPT);
    expect(resolveMaxOutputTokens('gpt-4o', 65000)).toBe(OUTPUT_TOKEN_BUDGET.ENGINEERING_PROMPT);
    expect(resolveMaxOutputTokens('gpt-4o', ENGINEERING_PROMPT.length))
      .toBeGreaterThan(OUTPUT_TOKEN_BUDGET.BASE);
  });

  test('reserva de reasoning para modelos que emitem reasoning_tokens antes do conteúdo', () => {
    expect(resolveMaxOutputTokens('deepseek-v4-pro', 100))
      .toBe(OUTPUT_TOKEN_BUDGET.BASE + REASONING_TOKEN_RESERVE);
    expect(resolveMaxOutputTokens('deepseek-flash', 6000))
      .toBe(OUTPUT_TOKEN_BUDGET.LARGE_PROMPT + REASONING_TOKEN_RESERVE);
    expect(resolveMaxOutputTokens('kimi-k2.6', 6000))
      .toBe(OUTPUT_TOKEN_BUDGET.LARGE_PROMPT + REASONING_TOKEN_RESERVE);
  });

  test('modelo fora da lista de reasoning NÃO ganha reserva (nada de adivinhação)', () => {
    expect(resolveMaxOutputTokens('gpt-4o', 6000)).toBe(OUTPUT_TOKEN_BUDGET.LARGE_PROMPT);
    expect(resolveMaxOutputTokens('qwen3-max', 6000)).toBe(OUTPUT_TOKEN_BUDGET.LARGE_PROMPT);
  });

  test('teto absoluto: tier + reserva nunca passam de MAX (custo não cresce sem limite)', () => {
    const budget = resolveMaxOutputTokens('deepseek-v4-pro', 65000);
    expect(budget).toBe(OUTPUT_TOKEN_BUDGET.MAX);
    expect(budget).toBeLessThan(OUTPUT_TOKEN_BUDGET.ENGINEERING_PROMPT + REASONING_TOKEN_RESERVE);
  });
});

describe('DeepSeek/Kimi/compatíveis ENVIAM o orçamento adaptativo', () => {
  test('DeepSeek: corpo da requisição usa o orçamento adaptativo (regressão do 1000 fixo)', async () => {
    global.fetch = jest.fn(async () => okJson({
      choices: [{ message: { content: '{"summary":"ok","diff":"diff --git a/a b/a"}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 42 },
    }));

    const out = await createDeepSeekProvider().generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'deepseek-flash' });
    const body = JSON.parse(lastRequest()[1].body);

    const expected = resolveMaxOutputTokens('deepseek-flash', ENGINEERING_PROMPT.length);
    expect(body.max_tokens).toBe(expected);
    expect(body.max_tokens).toBeGreaterThan(1000); // o defeito era exatamente 1000 fixo
    expect(out.text).toContain('diff --git');
    expect(out.finishReason).toBe('stop');
  });

  test('Kimi: corpo da requisição usa o orçamento adaptativo (regressão do 1000 fixo)', async () => {
    global.fetch = jest.fn(async () => okJson({
      choices: [{ message: { content: '{"summary":"ok","diff":"diff --git a/a b/a"}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 42 },
    }));

    await createKimiProvider().generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'kimi-k2.6' });
    const body = JSON.parse(lastRequest()[1].body);

    expect(body.max_tokens).toBe(resolveMaxOutputTokens('kimi-k2.6', ENGINEERING_PROMPT.length));
    expect(body.max_tokens).toBeGreaterThan(1000);
  });

  test('provider OpenAI-compatible (Qwen/Mistral/Groq): mesmo orçamento, nenhum 1000 fixo', async () => {
    global.fetch = jest.fn(async () => okJson({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 5 },
    }));

    await createOpenAICompatibleProvider(QWEN_DEF).generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'qwen3-max' });
    const body = JSON.parse(lastRequest()[1].body);

    expect(body.max_tokens).toBe(resolveMaxOutputTokens('qwen3-max', ENGINEERING_PROMPT.length));
    expect(body.max_tokens).toBeGreaterThan(1000);
  });
});

describe('saída vazia/truncada vira falha de provider (NUNCA texto inventado)', () => {
  test('DeepSeek: content vazio (reasoning consumiu o orçamento) → PROVIDER_EMPTY_RESPONSE', async () => {
    global.fetch = jest.fn(async () => emptyBecauseReasoning());

    await expect(createDeepSeekProvider().generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'deepseek-v4-pro' }))
      .rejects.toMatchObject({
        code: PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE,
        reasoningTokens: 1000,
      });
  });

  test('Kimi: content vazio com finish_reason=stop → também é falha (não é "resposta curta")', async () => {
    global.fetch = jest.fn(async () => emptyBecauseReasoning('stop'));

    await expect(createKimiProvider().generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'kimi-k2.6' }))
      .rejects.toMatchObject({ code: PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE });
  });

  test('truncamento (finish_reason=length) com texto parcial → PROVIDER_OUTPUT_TRUNCATED', async () => {
    global.fetch = jest.fn(async () => okJson({
      choices: [{ message: { content: '{"summary":"cortei no meio do dif' }, finish_reason: 'length' }],
      usage: { completion_tokens: 1000 },
    }));

    await expect(createDeepSeekProvider().generate(ENGINEERING_PROMPT, { tenantId: TENANT_ID, model: 'deepseek-flash' }))
      .rejects.toMatchObject({ code: PROVIDER_OUTPUT_FAILURE_CODES.OUTPUT_TRUNCATED });
  });

  test('provider compatível sem choices → falha classificada (antes: texto "[Resposta vazia da X]")', async () => {
    global.fetch = jest.fn(async () => okJson({ output: 'shape inesperado' }));

    await expect(createOpenAICompatibleProvider(QWEN_DEF).generate('x', { tenantId: TENANT_ID, model: 'qwen3-max' }))
      .rejects.toMatchObject({ code: PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE });
  });

  test('usableTextOrThrow: texto utilizável passa; vazio e truncado lançam com código próprio', () => {
    expect(usableTextOrThrow({ label: 'X', model: 'm', text: 'conteúdo', finishReason: 'stop' })).toBe('conteúdo');
    expect(() => usableTextOrThrow({ label: 'X', model: 'm', text: '   ', finishReason: 'stop' }))
      .toThrow(expect.objectContaining({ code: PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE }));
    expect(() => usableTextOrThrow({ label: 'X', model: 'm', text: 'parcial', finishReason: 'length' }))
      .toThrow(expect.objectContaining({ code: PROVIDER_OUTPUT_FAILURE_CODES.OUTPUT_TRUNCATED }));
  });
});

describe('rerouteabilidade: a falha atravessa o invoker como PROVIDER_UNAVAILABLE', () => {
  test('resposta vazia do provider REAL vira PROVIDER_UNAVAILABLE com o código de saída preservado', async () => {
    global.fetch = jest.fn(async () => emptyBecauseReasoning());
    const deepseek = createDeepSeekProvider();
    registerAiProvider('deepseek', { generate: deepseek.generate.bind(deepseek) });

    // É ESTE o código que o Router consulta para disparar `outcome: 'REROUTE'`
    // (engineeringRouterService: `if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE)`).
    await expect(invokeModel({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      prompt: ENGINEERING_PROMPT,
      tenantId: TENANT_ID,
    })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      providerErrorCode: PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE,
    });
  });
});

describe('guarda de regressão no código-fonte (o mascaramento não pode voltar)', () => {
  // Comentários são removidos: a documentação do defeito CITA o padrão antigo de propósito.
  const source = fs.readFileSync(path.join(ROOT, 'api/services/aiProviderService.js'), 'utf8');
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  test('nenhum caminho de completion converte saída vazia em texto válido', () => {
    // O padrão defeituoso era `... || '[Resposta vazia da X]'` / `... || \`[Resposta vazia da ${label}]\``.
    expect(codeOnly).not.toMatch(/\|\|\s*'\[Resposta vazia/);
    expect(codeOnly).not.toMatch(/\|\|\s*`\[Resposta vazia/);
    expect(codeOnly).toContain('usableTextOrThrow(');
  });

  test('DeepSeek/Kimi enviam orçamento adaptativo e nenhum max_tokens fixo de 1000', () => {
    const deepseekBlock = source.slice(
      source.indexOf('api.deepseek.com/v1/chat/completions'),
      source.indexOf('DeepSeek: Erro ao gerar resposta'),
    );
    const kimiBlock = source.slice(
      source.indexOf('api.moonshot.ai/v1/chat/completions'),
      source.indexOf('Kimi: Erro ao gerar resposta'),
    );

    for (const block of [deepseekBlock, kimiBlock]) {
      expect(block).toContain('...tokenParams,');
      expect(block).not.toContain('max_tokens: 1000');
    }
    // Factory OpenAI-compatible (Qwen/Mistral/Groq) usa a mesma fonte única.
    expect(source).toContain('...getTokenLimitParam(model, prompt.length),');
  });
});
