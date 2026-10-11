'use strict';

/**
 * aiProviderRegistry.js — fonte única de providers de IA suportados.
 *
 * Adicionar um novo provider = adicionar UMA entrada aqui. O backend
 * (geração + validação) e o frontend (dropdowns/labels/modelos) consomem
 * este registry.
 *
 * `kind`:
 *   - 'openai-sdk'         → usa o SDK da OpenAI (se disponível) com fallback fetch.
 *   - 'openai-compatible'  → fetch direto em `{baseUrl}/chat/completions` (Bearer).
 *   - 'anthropic'          → POST `{baseUrl}/messages` (x-api-key + anthropic-version).
 *
 * Este módulo é puro (sem I/O).
 */

const AI_PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-sdk',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.2',
    models: [
      { value: 'gpt-5.5', label: 'GPT-5.5' },
      { value: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { value: 'gpt-5-nano', label: 'GPT-5 Nano' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { value: 'o4', label: 'o4' },
      { value: 'o4-mini', label: 'o4-mini' },
      { value: 'o3', label: 'o3' },
      { value: 'o3-mini', label: 'o3-mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5',
    validationModel: 'claude-haiku-4-5-20251001',
    models: [
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { value: 'claude-opus-5', label: 'Claude Opus 5' },
      { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    // Achado real (discovery via GET /v1/models numa conta real, set/2026): "deepseek-chat"/
    // "deepseek-reasoner" não existem mais na API real — a geração atual é "deepseek-flash"
    // (V4.1-Flash) e "deepseek-v4-pro".
    defaultModel: 'deepseek-flash',
    models: [
      { value: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    // Achado real (discovery via GET /v1/models numa conta real, set/2026): a família
    // "moonshot-v1-*"/"kimi-latest" não existe mais na API real — a geração atual é
    // "kimi-k2.6"/"kimi-k2.7-code"/"kimi-k2.7-code-highspeed"/"kimi-k3" (flagship).
    defaultModel: 'kimi-k2.6',
    models: [
      { value: 'kimi-k2.6', label: 'Kimi K2.6' },
      { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
      { value: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code HighSpeed' },
      { value: 'kimi-k3', label: 'Kimi K3' },
    ],
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: [
      { value: 'mistral-large-latest', label: 'Mistral Large' },
      { value: 'mistral-small-latest', label: 'Mistral Small' },
      { value: 'mistral-medium-latest', label: 'Mistral Medium' },
      { value: 'pixtral-large-latest', label: 'Pixtral Large' },
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
      { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
    ],
  },
  // Qwen (Alibaba Cloud / Model Studio) — provider de PRIMEIRA CLASSE desta arquitetura, não uma
  // integração paralela: entra pelo MESMO registry estático que alimenta
  // `aiProviderService.initializeAiProviders` (registro real na engine, com circuit breaker e
  // timeout do AI Control Plane), o MESMO `aiProviderRegistryService.ensureBuiltinProviders`
  // (catálogo governado em `ai_providers`), a MESMA resolução de credencial por tenant
  // (`tenantAIService.getDecryptedAPIKey`) e o MESMO inventário de modelos consumido pelo
  // frontend. Nenhum provider/modelo Qwen é referenciado por nome em nenhum outro ponto do
  // código: o Engineering Model Router só o enxerga via `modelCapabilities.js` (capability) e o
  // Mission Compiler via capability/policy.
  //
  // Endpoint: modo OpenAI-compatible do Model Studio (`/compatible-mode/v1`, chat/completions com
  // Bearer). A credencial é por tenant (`provider = 'qwen'`), nunca lida aqui — este módulo é puro
  // e não toca env/banco/segredo.
  //
  // `models` é o CATÁLOGO DE APRESENTAÇÃO (dropdown/labels), nunca a autoridade de elegibilidade:
  // um modelo listado aqui e ausente da allowlist de `modelCapabilities.js` NÃO é roteável, e um
  // modelo aqui listado mas não confirmado pelo discovery real da credencial do tenant cai em
  // PROVIDER_NO_CREDENTIAL/MODEL_UNAVAILABLE no roteamento — nunca é assumido como disponível só
  // porque o nome aparece nesta lista (mesma política aplicada a OpenAI/DeepSeek/Kimi).
  //
  // Sem credencial configurada: o provider fica registrado mas indisponível (`AI_PROVIDER_NOT_CONFIGURED`
  // na primeira invocação real), health/status reportam a causa e o Router continua operando com
  // os demais providers — ausência de credencial Qwen nunca é erro estrutural de boot.
  qwen: {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud)',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    // MEDIDO contra o endpoint real em 2026-10-11 (credential do tenant `system`,
    // `GET /models` -> 200 com 99 modelos): `qwen3-max` e `qwen3-coder-plus`
    // respondiam **404 "Model not exist."**. Nao existem neste endpoint, entao nao
    // podem ser o default (V2-35 ficava UNPROVEN por defeito NOSSO, nao por
    // impedimento externo) nem constar do picker. Os quatro abaixo responderam 200
    // com completude valida.
    defaultModel: 'qwen-max',
    models: [
      { value: 'qwen-max', label: 'Qwen Max' },
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
      { value: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash' },
    ],
  },
};

const SUPPORTED_PROVIDER_IDS = Object.freeze(Object.keys(AI_PROVIDERS));

function getProvider(id) {
  return AI_PROVIDERS[id] || null;
}

function isSupportedProvider(id) {
  return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, id);
}

function getProviders() {
  return Object.values(AI_PROVIDERS);
}

function getProviderIds() {
  return SUPPORTED_PROVIDER_IDS;
}

module.exports = {
  AI_PROVIDERS,
  SUPPORTED_PROVIDER_IDS,
  getProvider,
  isSupportedProvider,
  getProviders,
  getProviderIds,
};
