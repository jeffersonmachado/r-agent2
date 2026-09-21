'use strict';

/**
 * engine/engineeringRouter/modelCapabilities.js
 *
 * Extensão versionada do `engine/aiProviderRegistry.js` existente com metadados de
 * capability/role/contextClass/costClass por `provider:model`, SEM tocar no registry
 * original e SEM criar um segundo registry de providers.
 *
 * Por que este arquivo e não uma migração no model `AiProvider`:
 * - `AiProvider.models` (JSONB) hoje é consumido por vários pontos do backend/frontend como
 *   `{value, label}`; mudar esse shape arrisca quebrar consumidores existentes fora do escopo
 *   desta missão (proibido pela regra de fechamento de escopo).
 * - Um arquivo puro e versionado é auditável por diff de código (governança pode validar seu
 *   conteúdo) e não exige migração de banco nem sincronização de builtins.
 *
 * Somente modelos explicitamente listados aqui participam do Engineering Model Router — isto
 * é intencional: um modelo não mapeado não é elegível para CODER/REVIEWER (allowlist segura por
 * padrão, em vez de assumir capability desconhecida).
 *
 * Módulo puro (sem I/O, sem leitura de banco/env).
 */

const { CAPABILITIES, MODEL_ROLES, COST_CLASSES, CONTEXT_CLASSES } = require('./constants');

const CAPABILITY_SET = new Set(CAPABILITIES);
const ROLE_SET = new Set(MODEL_ROLES);
const COST_SET = new Set(COST_CLASSES);
const CONTEXT_SET = new Set(CONTEXT_CLASSES);

function entry({ roles, capabilities, contextClass, costClass }) {
  for (const r of roles) {
    if (!ROLE_SET.has(r)) throw new Error(`modelCapabilities: role inválida "${r}"`);
  }
  for (const c of capabilities) {
    if (!CAPABILITY_SET.has(c)) throw new Error(`modelCapabilities: capability inválida "${c}"`);
  }
  if (!CONTEXT_SET.has(contextClass)) throw new Error(`modelCapabilities: contextClass inválida "${contextClass}"`);
  if (!COST_SET.has(costClass)) throw new Error(`modelCapabilities: costClass inválida "${costClass}"`);
  return Object.freeze({
    roles: Object.freeze([...roles]),
    capabilities: Object.freeze([...capabilities]),
    contextClass,
    costClass,
  });
}

const CODING_CORE = ['CODING', 'DEBUGGING', 'TOOL_USE', 'REPOSITORY_AUDIT'];
const REVIEW_CORE = ['CODE_REVIEW', 'SECURITY_REVIEW', 'ARCHITECTURE', 'GOVERNANCE'];

const MODEL_CAPABILITIES = Object.freeze({
  // Anthropic — CODER e REVIEWER, classe de contexto estendida.
  'anthropic:claude-opus-5': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'DATABASE', 'FRONTEND', 'DOCKER_INFRA', 'RELEASE'],
    contextClass: 'EXTENDED',
    costClass: 'HIGH',
  }),
  'anthropic:claude-sonnet-5': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'DATABASE', 'FRONTEND', 'DOCKER_INFRA', 'RELEASE'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'anthropic:claude-haiku-4-5-20251001': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: ['CODING', 'DEBUGGING', 'TEST_GENERATION', 'CODE_REVIEW'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
  }),
  // OpenAI — codex para CODER, mini para tarefas pequenas.
  'openai:gpt-5-codex': entry({
    roles: ['CODER'],
    capabilities: [...CODING_CORE, 'TEST_GENERATION', 'DATABASE', 'FRONTEND', 'DOCKER_INFRA'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'openai:gpt-5.5-pro': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'DATABASE', 'FRONTEND', 'RELEASE'],
    contextClass: 'EXTENDED',
    costClass: 'HIGH',
  }),
  'openai:gpt-5.4-mini': entry({
    roles: ['CODER'],
    capabilities: ['CODING', 'DEBUGGING', 'TEST_GENERATION', 'FRONTEND'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
  }),
  // gpt-4o: modelo estável de propósito geral, confirmado disponível via chat completions no
  // pilot real (ao contrário de gpt-5.5-pro/gpt-5-codex, que a API rejeitou como inexistentes/
  // descontinuados nesta conta). Mantido como REVIEWER de custo médio para não deixar o
  // provider OpenAI sem nenhum reviewer funcional quando é o único provider disponível.
  'openai:gpt-4o': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'DATABASE', 'FRONTEND'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  // DeepSeek — bom para debugging/reasoning a custo baixo.
  'deepseek:deepseek-reasoner': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: ['CODING', 'DEBUGGING', 'CODE_REVIEW', 'ARCHITECTURE', 'DATABASE'],
    contextClass: 'LONG',
    costClass: 'LOW',
  }),
  'deepseek:deepseek-chat': entry({
    roles: ['CODER'],
    capabilities: ['CODING', 'DEBUGGING', 'TEST_GENERATION', 'FRONTEND'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
  }),
  // Mistral — reviewer independente de baixo custo.
  'mistral:mistral-large-latest': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: ['CODING', 'DEBUGGING', 'CODE_REVIEW', 'ARCHITECTURE', 'FRONTEND'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  // Groq — latência baixa, útil para revisões rápidas de baixo risco.
  'groq:llama-3.3-70b-versatile': entry({
    roles: ['REVIEWER'],
    capabilities: ['CODE_REVIEW', 'CODING'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
  }),
  // Kimi — contexto longo para auditoria de repositório.
  'kimi:moonshot-v1-128k': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: ['CODING', 'REPOSITORY_AUDIT', 'CODE_REVIEW', 'LONG_CONTEXT', 'ARCHITECTURE'],
    contextClass: 'EXTENDED',
    costClass: 'MEDIUM',
  }),
});

function keyOf(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

function getModelCapability(providerId, modelId) {
  return MODEL_CAPABILITIES[keyOf(providerId, modelId)] || null;
}

function listCapabilityEntries() {
  return Object.entries(MODEL_CAPABILITIES).map(([key, value]) => {
    const [providerId, ...rest] = key.split(':');
    return { providerId, modelId: rest.join(':'), ...value };
  });
}

function isModelMapped(providerId, modelId) {
  return Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, keyOf(providerId, modelId));
}

module.exports = {
  MODEL_CAPABILITIES,
  getModelCapability,
  listCapabilityEntries,
  isModelMapped,
};
