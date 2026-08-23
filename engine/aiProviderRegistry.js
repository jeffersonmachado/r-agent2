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
    defaultModel: 'deepseek-chat',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
    ],
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
      { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
      { value: 'kimi-latest', label: 'Kimi Latest' },
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
