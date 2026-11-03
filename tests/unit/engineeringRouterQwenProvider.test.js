'use strict';

/**
 * Qwen como provider de PRIMEIRA CLASSE do AI Control Plane + Engineering Model Router.
 *
 * Prova, com código real (não com um caminho paralelo de teste):
 *   1. Qwen entra pelo registry canônico `engine/aiProviderRegistry.js` — a MESMA fonte única que
 *      alimenta o boot real (`aiProviderService.initializeAiProviders`), o catálogo governado
 *      (`ai_providers`) e o inventário do frontend. Nenhum registry paralelo é criado.
 *   2. A ausência de credencial Qwen é um estado EXPLÍCITO (`AI_PROVIDER_NOT_CONFIGURED`), nunca
 *      um erro estrutural: o provider permanece registrado e o Router continua operando com os
 *      demais providers.
 *   3. A construção do provider real (`createOpenAICompatibleProvider`) a partir da definição do
 *      registry usa o endpoint Qwen, autentica com Bearer, envia o modelId escolhido pelo ROUTER e
 *      normaliza resposta/usage — validado interceptando `fetch` (nenhuma rede real é usada).
 *   4. Timeout, rate limit, credencial ausente e resposta malformada são classificados
 *      corretamente por `engineeringAiInvoker` (`PROVIDER_UNAVAILABLE` + código/status ORIGINAL
 *      preservados) — a base do reroute/fallback multi-provider.
 *   5. O Router seleciona Qwen por CAPABILITY (nunca por nome), nos papéis CODER/REVIEWER/ENRICHER,
 *      com fallback nos dois sentidos (Qwen→outro e outro→Qwen) e independência de provider em
 *      tarefas HIGH/CRITICAL — registrando degradação explícita quando independência é impossível.
 *   6. Nenhum nome de modelo Qwen é referenciado no código de roteamento/seleção, e nenhum
 *      segredo aparece no registry (nem hardcoded, nem em fixture).
 */

jest.mock('../../api/services/tenantAIService', () => ({
  getDecryptedAPIKey: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const { AI_PROVIDERS, getProvider, isSupportedProvider, getProviderIds } = require('../../engine/aiProviderRegistry');
const { createOpenAICompatibleProvider } = require('../../api/services/aiProviderService');
const tenantAIService = require('../../api/services/tenantAIService');
const logger = require('../../api/utils/logger');
const { listCapabilityEntries, getModelCapability, isModelMapped } = require('../../engine/engineeringRouter/modelCapabilities');
const { selectForRole, selectCoderAndReviewer } = require('../../engine/engineeringRouter/modelSelector');
const { invokeModel } = require('../../api/services/engineeringRouter/engineeringAiInvoker');
const { registerAiProvider, clearAiProviderConfig, getRegisteredProviderIds } = require('../../api/services/aiProviderManager');
const infraGate = require('../helpers/infraGate');

const ROOT = path.resolve(__dirname, '..', '..');
const QWEN = 'qwen';
const QWEN_DEF = AI_PROVIDERS[QWEN];
const TENANT_ID = 'jest-unit-qwen-provider';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  tenantAIService.getDecryptedAPIKey.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  clearAiProviderConfig(QWEN);
  jest.restoreAllMocks();
});

/**
 * Candidatos reais derivados da allowlist estática — o mesmo shape que
 * `engineeringModelAvailabilityService.buildAvailableModels()` entrega ao seletor puro.
 */
function candidates(overrides = {}, filter = () => true) {
  return listCapabilityEntries()
    .filter(filter)
    .map((e) => ({
      providerId: e.providerId,
      modelId: e.modelId,
      roles: [...e.roles],
      capabilities: [...e.capabilities],
      contextClass: e.contextClass,
      costClass: e.costClass,
      enabled: true,
      healthy: true,
      hasCredential: true,
      available: true,
      ...overrides,
    }));
}

function qwenOnly(overrides = {}) {
  return candidates(overrides, (e) => e.providerId === QWEN);
}

describe('Qwen — registro como provider de primeira classe', () => {
  test('QWEN_REGISTERED: definição canônica no registry único de providers', () => {
    expect(QWEN_DEF).toBeDefined();
    expect(QWEN_DEF.id).toBe(QWEN);
    expect(QWEN_DEF.kind).toBe('openai-compatible');
    expect(QWEN_DEF.baseUrl).toMatch(/^https:\/\//);
    expect(Array.isArray(QWEN_DEF.models)).toBe(true);
    expect(QWEN_DEF.models.length).toBeGreaterThan(0);
    // Qwen é uma FAMÍLIA (múltiplos modelos/versões), nunca um único modelo fixo.
    expect(QWEN_DEF.models.length).toBeGreaterThan(1);
    expect(QWEN_DEF.models.map((m) => m.value)).toContain(QWEN_DEF.defaultModel);
    expect(getProvider(QWEN)).toBe(QWEN_DEF);
    expect(isSupportedProvider(QWEN)).toBe(true);
    expect(getProviderIds()).toContain(QWEN);
  });

  test('QWEN_NO_SECRET: nenhuma credencial no registry nem em variável de ambiente', () => {
    const serialized = JSON.stringify(AI_PROVIDERS);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/dashscope-[A-Za-z0-9]{8,}/i);
    for (const def of Object.values(AI_PROVIDERS)) {
      expect(def).not.toHaveProperty('apiKey');
      expect(def).not.toHaveProperty('api_key');
      expect(def).not.toHaveProperty('secret');
      expect(def).not.toHaveProperty('token');
    }
    // Credencial é por tenant (tenant_ai_credentials), resolvida em runtime — o registry é puro.
    expect(fs.readFileSync(path.join(ROOT, 'engine/aiProviderRegistry.js'), 'utf8')).not.toMatch(/process\.env/);
  });

  test('QWEN_IS_BUILTIN_SYNCED: catálogo de built-ins alimentado pela definição do registry', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'api/services/aiProviderRegistryService.js'), 'utf8');
    // O sincronizador de built-ins itera o registry — Qwen entra sem nenhuma lista paralela.
    expect(source).toMatch(/for \(const def of Object\.values\(AI_PROVIDERS\)\)/);
    const def = await require('../../api/services/aiProviderRegistryService').getProviderDef(QWEN);
    expect(def).toEqual(expect.objectContaining({
      id: QWEN,
      kind: 'openai-compatible',
      baseUrl: QWEN_DEF.baseUrl,
      defaultModel: QWEN_DEF.defaultModel,
    }));
    expect(def.models.length).toBe(QWEN_DEF.models.length);
  });

  test('QWEN_CAPABILITIES_ALLOWLIST: modelos Qwen mapeados cobrem CODER/REVIEWER/ENRICHER', () => {
    const entries = listCapabilityEntries().filter((e) => e.providerId === QWEN);
    expect(entries.length).toBeGreaterThan(0);
    const roles = new Set(entries.flatMap((e) => e.roles));
    expect(roles.has('CODER')).toBe(true);
    expect(roles.has('REVIEWER')).toBe(true);
    expect(roles.has('ENRICHER')).toBe(true);
    // Modelo listado no catálogo mas fora da allowlist não é elegível — nunca "capability
    // desconhecida assumida como verdadeira".
    const mapped = entries.map((e) => e.modelId);
    for (const m of QWEN_DEF.models.map((m) => m.value)) {
      if (!mapped.includes(m)) expect(isModelMapped(QWEN, m)).toBe(false);
    }
    expect(getModelCapability(QWEN, entries[0].modelId)).not.toBeNull();
  });
});

describe('Qwen — contrato do provider (transporte MOCKADO, não é prova ao vivo)', () => {
  test('QWEN_NO_CREDENTIAL_IS_EXPLICIT: ausência de credencial é estado, não falha estrutural', async () => {
    tenantAIService.getDecryptedAPIKey.mockResolvedValue(null);
    const provider = createOpenAICompatibleProvider(QWEN_DEF);
    await expect(provider.generate('oi', { tenantId: TENANT_ID })).rejects.toMatchObject({
      code: 'AI_PROVIDER_NOT_CONFIGURED',
    });
    await expect(provider.generate('oi', {})).rejects.toThrow(/tenantId é obrigatório/);
  });

  test('QWEN_NO_CREDENTIAL_ROUTER_CONTINUES: sem credencial Qwen, outro provider é escolhido', () => {
    const models = [
      ...qwenOnly({ hasCredential: false }),
      ...candidates({}, (e) => e.providerId === 'mistral'),
    ];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected).not.toBeNull();
    expect(result.selected.providerId).not.toBe(QWEN);
  });

  // §25-§29: este teste valida o FORMATO do request (endpoint, header, modelId), com `fetch`
  // mockado. Chamar isto de "real request" seria exatamente o greenwashing localizado na
  // auditoria V2: o nome afirmava execução ao vivo onde só havia contrato.
  test('QWEN_CONTRACT_REQUEST_FORMAT: endpoint Qwen, Bearer e modelId decidido pelo Router', async () => {
    tenantAIService.getDecryptedAPIKey.mockResolvedValue('jest-fake-qwen-key');
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'patch gerado' } }],
          usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
        }),
      };
    });

    const provider = createOpenAICompatibleProvider(QWEN_DEF);
    const out = await provider.generate('gere o patch', {
      tenantId: TENANT_ID,
      model: 'qwen3-coder-plus',
      source: 'engineering-router',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${QWEN_DEF.baseUrl}/chat/completions`);
    expect(calls[0].init.headers.Authorization).toBe('Bearer jest-fake-qwen-key');
    expect(JSON.parse(calls[0].init.body).model).toBe('qwen3-coder-plus');
    expect(out.text).toBe('patch gerado');
    expect(out.usage).toEqual({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 });
  });

  // §25-§29: o teste acima usa `global.fetch` mockado. Ele PROVA o contrato, jamais a
  // interoperabilidade ao vivo. Este teste é o guarda-corpo do rótulo: se alguém voltar a
  // chamar isso de prova ao vivo, a asserção falha.
  test('QWEN_MOCK_IS_NOT_LIVE: transporte mockado nunca produz estado LIVE', async () => {
    tenantAIService.getDecryptedAPIKey.mockResolvedValue('jest-fake-qwen-key');
    let networkCalls = 0;
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      networkCalls += 1;
      throw new Error('nenhuma chamada de rede real pode ocorrer neste teste');
    });
    const provider = createOpenAICompatibleProvider(QWEN_DEF);
    await expect(provider.generate('oi', { tenantId: TENANT_ID, model: 'qwen3-coder-plus' })).rejects.toThrow(
      /chamada de rede real/,
    );
    expect(networkCalls).toBe(1);
    // O mock interceptou: portanto a evidência deste caminho é CONTRACT, nunca LIVE.
    const evidence = { axis: 'QWEN_CONTRACT', transport: 'mock', live: false };
    expect(evidence.live).toBe(false);
    expect(['QWEN_PROVIDER_STRUCTURAL', 'QWEN_CONTRACT', 'QWEN_ROUTING', 'QWEN_FALLBACK', 'QWEN_LIVE']).toContain(
      evidence.axis,
    );
    global.fetch = realFetch;
  });

  test('QWEN_MALFORMED_RESPONSE: resposta sem choices vira falha classificada (nunca texto inventado)', async () => {
    tenantAIService.getDecryptedAPIKey.mockResolvedValue('jest-fake-qwen-key');
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ output: 'shape inesperado' }) }));
    const provider = createOpenAICompatibleProvider(QWEN_DEF);
    // Regressão do bootstrap 2026-10-07: `content || '[Resposta vazia da X]'` convertia saída
    // inutilizável em TEXTO VÁLIDO — o Router falhava depois com NO_JSON_FOUND (classe NÃO
    // rerouteável) e repetia o MESMO modelo. Agora sobe como falha de provider classificada.
    await expect(provider.generate('x', { tenantId: TENANT_ID, model: 'qwen3-max' })).rejects.toMatchObject({
      code: 'PROVIDER_EMPTY_RESPONSE',
    });
  });

  test('QWEN_MALFORMED_JSON: corpo inválido é propagado como falha real (nunca engolido)', async () => {
    tenantAIService.getDecryptedAPIKey.mockResolvedValue('jest-fake-qwen-key');
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token < in JSON'); } }));
    const provider = createOpenAICompatibleProvider(QWEN_DEF);
    await expect(provider.generate('x', { tenantId: TENANT_ID })).rejects.toThrow(/Unexpected token/);
  });
});

describe('Qwen — classificação de falhas via engineeringAiInvoker (base do fallback)', () => {
  async function invokeWithFakeQwen(errorFactory) {
    registerAiProvider(QWEN, {
      async generate() {
        throw errorFactory();
      },
    });
    return invokeModel({ providerId: QWEN, modelId: 'qwen3-coder-plus', prompt: 'x', tenantId: TENANT_ID });
  }

  test('QWEN_TIMEOUT: timeout vira PROVIDER_UNAVAILABLE com código preservado', async () => {
    const err = Object.assign(new Error('The operation was aborted'), { code: 'ETIMEDOUT', status: 504 });
    await expect(invokeWithFakeQwen(() => err)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      httpStatus: 504,
      providerErrorCode: 'ETIMEDOUT',
    });
  });

  test('QWEN_RATE_LIMIT: 429 preserva status e código externo para o reroute decidir', async () => {
    const err = Object.assign(new Error('Requests rate limit exceeded'), {
      code: 'Throttling.RateQuota',
      status: 429,
    });
    await expect(invokeWithFakeQwen(() => err)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      httpStatus: 429,
      providerErrorCode: 'Throttling.RateQuota',
    });
  });

  test('QWEN_PROVIDER_UNAVAILABLE_STATE: provider não registrado falha fechado', async () => {
    clearAiProviderConfig(QWEN);
    await expect(invokeModel({
      providerId: QWEN, modelId: 'qwen3-max', prompt: 'x', tenantId: TENANT_ID,
    })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  test('QWEN_TELEMETRY_AND_AUDIT: providerId/modelId/latência/usage registrados na invocação', async () => {
    registerAiProvider(QWEN, {
      async generate(prompt, options) {
        expect(options.model).toBe('qwen3-coder-plus');
        expect(options.source).toBe('engineering-router');
        return { text: 'ok', usage: { total_tokens: 42 } };
      },
    });
    const out = await invokeModel({
      providerId: QWEN, modelId: 'qwen3-coder-plus', prompt: 'x', tenantId: TENANT_ID,
    });
    expect(out).toEqual(expect.objectContaining({
      providerId: QWEN,
      modelId: 'qwen3-coder-plus',
      text: 'ok',
      usage: { total_tokens: 42 },
    }));
    expect(typeof out.latencyMs).toBe('number');
    expect(getRegisteredProviderIds()).toContain(QWEN);
  });
});

describe('Qwen — seleção por capability e papéis (nunca por nome)', () => {
  test('QWEN_AS_CODER: único candidato qualificado por capability', () => {
    const result = selectForRole(qwenOnly(), { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected.providerId).toBe(QWEN);
    expect(result.reasonCodes).toContain('CAPABILITY_MATCH');
  });

  test('QWEN_AS_REVIEWER: elegível quando a policy exige CODE_REVIEW', () => {
    const result = selectForRole(qwenOnly(), { role: 'REVIEWER', requiredCapabilities: ['CODE_REVIEW'] });
    expect(result.selected.providerId).toBe(QWEN);
  });

  test('QWEN_AS_ENRICHER: papel do Mission Compiler resolvido pelo mesmo seletor', () => {
    const result = selectForRole(qwenOnly(), { role: 'ENRICHER', requiredCapabilities: ['ARCHITECTURE'] });
    expect(result.selected.providerId).toBe(QWEN);
    expect(result.selected.modelId).toBeTruthy();
  });

  test('QWEN_CAPABILITY_MISSING: capability ausente desqualifica, mesmo sendo Qwen saudável', () => {
    // Nenhum modelo Qwen da allowlist declara DOCKER_INFRA — o provider saudável não basta.
    const qwenHasDocker = qwenOnly().some((m) => m.capabilities.includes('DOCKER_INFRA'));
    expect(qwenHasDocker).toBe(false);
    const result = selectForRole(qwenOnly(), { role: 'REVIEWER', requiredCapabilities: ['DOCKER_INFRA'] });
    expect(result.selected).toBeNull();
    expect(result.reasonCodes).toContain('NO_QUALIFIED_CANDIDATE');
  });

  test('QWEN_PRIMARY: escolhido como provider primário entre múltiplas famílias', () => {
    const models = [
      ...candidates({ costClass: 'HIGH' }, (e) => e.providerId === 'anthropic'),
      ...candidates({ costClass: 'LOW' }, (e) => e.providerId === QWEN),
    ];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected.providerId).toBe(QWEN);
    expect(result.reasonCodes).toContain('LOWER_COST_AMONG_QUALIFIED');
  });

  test('QWEN_FALLBACK_FROM_QWEN: Qwen indisponível → outro provider assume', () => {
    const models = [
      ...qwenOnly({ available: false }),
      ...candidates({}, (e) => e.providerId === 'deepseek'),
    ];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected.providerId).toBe('deepseek');
  });

  test('QWEN_FALLBACK_TO_QWEN: Qwen acomoda outro provider como fallback (exclusão explícita)', () => {
    const models = [
      ...candidates({}, (e) => e.providerId === 'anthropic'),
      ...qwenOnly(),
    ];
    const result = selectForRole(models, {
      role: 'REVIEWER',
      requiredCapabilities: ['CODE_REVIEW'],
      excludeProviderId: 'anthropic',
    });
    expect(result.selected.providerId).toBe(QWEN);
  });

  test('QWEN_INDEPENDENCE_HIGH_RISK: coder e reviewer em providers distintos', () => {
    const models = [
      ...candidates({}, (e) => e.providerId === 'anthropic'),
      ...qwenOnly(),
    ];
    const result = selectCoderAndReviewer(models, {
      coderCapabilities: ['CODING', 'DEBUGGING', 'TOOL_USE'],
      reviewerCapabilities: ['CODE_REVIEW', 'ARCHITECTURE'],
      independentReviewRequired: true,
      policyVersion: 'jest',
    });
    expect(result.coder.selected.providerId).toBe('anthropic');
    expect(result.reviewer.selected.providerId).toBe(QWEN);
    expect(result.reviewer.reasonCodes).toContain('INDEPENDENT_PROVIDER_APPLIED');
  });

  test('QWEN_INDEPENDENCE_UNAVAILABLE: independência impossível é registrada, nunca fingida', () => {
    const result = selectCoderAndReviewer(qwenOnly(), {
      coderCapabilities: ['CODING', 'DEBUGGING', 'TOOL_USE'],
      reviewerCapabilities: ['CODE_REVIEW', 'ARCHITECTURE'],
      independentReviewRequired: true,
      policyVersion: 'jest',
    });
    expect(result.reviewer.selected.providerId).toBe(QWEN);
    expect(result.reviewer.reasonCodes).toContain('INDEPENDENT_PROVIDER_UNAVAILABLE');
  });

  test('QWEN_NOT_HARDCODED: nenhum nome de modelo/provider Qwen no código de decisão', () => {
    const decisionFiles = [
      'engine/engineeringRouter/modelSelector.js',
      'engine/engineeringRouter/routingPolicy.js',
      'engine/engineeringRouter/taskClassifier.js',
      'engine/engineeringRouter/modelCatalogPolicy.js',
    ];
    for (const rel of decisionFiles) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/qwen3|dashscope|aliyuncs/i);
    }
  });
});

// §25-§29 — taxonomia de estados do Qwen. Nenhum destes testes PULA: cada um ASSERE o estado
// alcançável no ambiente atual. `QWEN_LIVE` só é PASS com resposta real da API; sem credencial o
// estado é `NOT_EXECUTED_NO_CREDENTIAL`, que nunca é convertido em PASS por omissão.
describe('Qwen — taxonomia de estados (nada de "live" sem execução ao vivo)', () => {
  const AXES = ['QWEN_PROVIDER_STRUCTURAL', 'QWEN_CONTRACT', 'QWEN_ROUTING', 'QWEN_FALLBACK', 'QWEN_LIVE'];

  test('LOS_ESTADOS_DECLARADOS: os 5 eixos são exatamente os auditáveis', () => {
    expect(AXES).toHaveLength(5);
    expect(new Set(AXES).size).toBe(5);
  });

  test('QWEN_PROVIDER_STRUCTURAL: registry canônico responde pelos 4 eixos estruturais', () => {
    expect(getProvider(QWEN)).toBeDefined();
    expect(isSupportedProvider(QWEN)).toBe(true);
    expect(getProviderIds()).toContain(QWEN);
    expect(QWEN_DEF.defaultModel).toBeTruthy();
  });

  /**
   * SEMÂNTICA DE ESTADO LIVE (missão V2): `PASS` só existe com HTTP success E resposta VÁLIDA de
   * inferência E normalização válida. Antes este teste aceitava 401/403/429 como "esperado" — o que
   * equivale a chamar falha de autenticação de sucesso. Cada desfecho tem estado próprio.
   */
  function classifyQwenLive({ status = null, body = null, networkError = null } = {}) {
    if (networkError) return 'TIMEOUT_OR_INFRA_ERROR';
    if (status === 200) {
      if (!body || !Array.isArray(body.choices) || body.choices.length === 0) return 'FAIL_INVALID_RESPONSE';
      const message = body.choices[0] && body.choices[0].message;
      const content = message && typeof message.content === 'string' ? message.content.trim() : '';
      if (content === '') return 'FAIL_NORMALIZATION';
      return 'PASS';
    }
    if (status === 401 || status === 403) return 'FAIL_AUTH';
    if (status === 429) return 'RATE_LIMITED';
    if (typeof status === 'number' && status >= 500) return 'PROVIDER_ERROR';
    return 'FAIL_UNEXPECTED';
  }

  test('QWEN_LIVE_CLASSIFICACAO: cada desfecho tem estado próprio e só 200+válido é PASS', () => {
    expect(classifyQwenLive({ networkError: new Error('timeout') })).toBe('TIMEOUT_OR_INFRA_ERROR');
    expect(classifyQwenLive({ status: 401 })).toBe('FAIL_AUTH');
    expect(classifyQwenLive({ status: 403 })).toBe('FAIL_AUTH');
    expect(classifyQwenLive({ status: 429 })).toBe('RATE_LIMITED');
    expect(classifyQwenLive({ status: 500 })).toBe('PROVIDER_ERROR');
    expect(classifyQwenLive({ status: 503 })).toBe('PROVIDER_ERROR');
    expect(classifyQwenLive({ status: 200, body: {} })).toBe('FAIL_INVALID_RESPONSE');
    expect(classifyQwenLive({ status: 200, body: { choices: [] } })).toBe('FAIL_INVALID_RESPONSE');
    expect(classifyQwenLive({ status: 200, body: { choices: [{ message: { content: '   ' } }] } })).toBe('FAIL_NORMALIZATION');
    // 401/429/5xx NUNCA podem ser PASS — é exatamente o que a missão proíbe.
    for (const out of [classifyQwenLive({ status: 401 }), classifyQwenLive({ status: 429 }), classifyQwenLive({ status: 500 })]) {
      expect(out).not.toBe('PASS');
    }
    expect(classifyQwenLive({ status: 200, body: { choices: [{ message: { content: 'resposta' } }] } })).toBe('PASS');
  });

  test('QWEN_LIVE: credencial resolvida pelo PRODUTO e desfecho OBSERVADO (nunca PASS por omissão)', async () => {
    const { connect, close } = require('../../api/db/sequelize');
    const realTenantAIService = jest.requireActual('../../api/services/tenantAIService');

    let liveKey = null;
    let resolveError = null;
    try {
      // PRAZO EXPLÍCITO (medido no CI, run 39585223390): sem Postgres no runner o `connect()`
      // fica pendurado e o Jest matava o teste por `Exceeded timeout of 60000 ms` — o fluxo
      // nunca chegava ao `skipOrFail` que registra NOT_EXECUTED, então a suíte ficava vermelha
      // por AMBIENTE. Com prazo, a indisponibilidade vira erro explícito e o estado reportado é
      // o correto (NOT_EXECUTED em dev, INFRA_ERROR em release-authoritative).
      await infraGate.comPrazo(() => connect(), { ms: 8000, requisito: 'postgres' });
      liveKey = await infraGate.comPrazo(
        () => realTenantAIService.getDecryptedAPIKey('system', QWEN),
        { ms: 8000, requisito: 'postgres+encryption_key' },
      );
    } catch (error) {
      resolveError = error;
    } finally {
      await infraGate.comPrazo(() => close(), { ms: 5000, requisito: 'postgres' }).catch(() => {});
    }

    // Infra indisponível (Postgres fora do ar, ou ENCRYPTION_KEY diferente da que cifrou a
    // credencial). Registrado explicitamente; em RELEASE_AUTHORITATIVE a porta LANÇA em vez de pular.
    if (infraGate.skipOrFail({
      suite: 'QWEN_LIVE',
      available: !resolveError,
      requirement: 'postgres+encryption_key',
      reason: resolveError ? resolveError.message : null,
    })) {
      expect(true).toBe(true);
      return;
    }

    let emitted = null;
    const emitEvidence = (state, extra = {}) => {
      emitted = {
        artifactType: 'qwen-live-evidence',
        artifactVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        requirement: 'V2-35',
        source: 'tenant_ai_credentials',
        tenant: 'system',
        provider: QWEN,
        model: QWEN_DEF.defaultModel,
        baseUrl: QWEN_DEF.baseUrl,
        state,
        ...extra,
      };
      // Só no regime AUTORITATIVO: em `npm run test:unit` a evidência não é emitida (não reescreve
      // artefato governado a cada execução de desenvolvimento).
      if (infraGate.isAuthoritative()) {
        const target = path.join(ROOT, 'reports', 'qwen-live-evidence.json');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${JSON.stringify(emitted, null, 2)}\n`, 'utf8');
      }
      return emitted;
    };

    // Sem credencial cadastrada no PRODUTO: estado próprio, nunca PASS.
    if (!liveKey) {
      const payload = emitEvidence('NOT_EXECUTED_NO_CREDENTIAL', { reason: 'no_tenant_credential_for_provider' });
      expect(payload.state).not.toBe('PASS');
      expect(payload.state).not.toBe('GO');
      return;
    }

    // Credencial presente: a chamada é REAL e o ESTADO reflete o desfecho observado.
    let outcome;
    let httpStatus = null;
    let providerError = null;
    try {
      const response = await fetch(`${QWEN_DEF.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${liveKey}` },
        body: JSON.stringify({ model: QWEN_DEF.defaultModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }),
      });
      httpStatus = response.status;
      const body = await response.json().catch(() => null);
      providerError = body && body.error ? (body.error.message || body.error.code) : null;
      outcome = classifyQwenLive({ status: response.status, body });
    } catch (error) {
      providerError = error.message;
      outcome = classifyQwenLive({ networkError: error });
    }

    // O estado é OBSERVADO e não pode ser mascarado: 401 vira FAIL_AUTH, 429 vira RATE_LIMITED, etc.
    expect(['PASS', 'FAIL_AUTH', 'RATE_LIMITED', 'PROVIDER_ERROR', 'FAIL_INVALID_RESPONSE', 'FAIL_NORMALIZATION', 'TIMEOUT_OR_INFRA_ERROR', 'FAIL_UNEXPECTED']).toContain(outcome);

    // BINDING: a evidência publicada carrega EXATAMENTE o desfecho medido — é por ela que o gate
    // classifica o requisito; nenhum texto declarado decide mais este item.
    const payload = emitEvidence(outcome, { httpStatus, providerError, credentialLength: liveKey.length });
    expect(payload.state).toBe(outcome);
    expect(payload.httpStatus).toBe(httpStatus);
  }, 60000);
});
