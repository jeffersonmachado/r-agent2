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
  // OpenAI — ER-V1-SEAL-005 (Current Model Policy): `gpt-5-codex` e `gpt-5.5-pro` REMOVIDOS
  // desta allowlist. Evidência real e já documentada (pilot real, ver histórico deste arquivo
  // antes desta missão): a API OpenAI real rejeitou ambos com 404 (`model_not_found`/
  // descontinuado) para a conta/credencial atual — mantê-los mapeados aqui, mesmo sabendo disso,
  // seria exatamente o que a política proíbe ("NÃO inventar disponibilidade. Se provider não
  // listar um modelo: UNAVAILABLE/UNKNOWN conforme evidence."). `openai:gpt-4o` é o único modelo
  // OpenAI com disponibilidade real CONFIRMADA (ver comentário abaixo) e cobre CODER/REVIEWER
  // sozinho enquanto nenhuma nova evidência positiva justificar remapear outro nome da família
  // atual. Reintroduzir qualquer modelo OpenAI aqui exige nova confirmação real (discovery
  // `GET /v1/models` ou chamada real bem-sucedida), nunca assumir pelo nome.
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
  // DeepSeek — modelos reais atualizados (achado do pilot real + discovery proativo: os
  // modelos antigos "deepseek-chat"/"deepseek-reasoner" não existem mais na API real; a conta
  // real atual só expõe "deepseek-flash"/"deepseek-v4-pro" — confirmado via `GET
  // https://api.deepseek.com/v1/models`). Preço real (set/2026): V4.1-Flash $0.30/$1.20 por 1M
  // tokens (peak); V4-Pro $1.32/$3.96 por 1M tokens (peak); ambos com 1M de contexto.
  'deepseek:deepseek-flash': entry({
    roles: ['CODER'],
    capabilities: ['CODING', 'DEBUGGING', 'TEST_GENERATION', 'FRONTEND', 'TOOL_USE'],
    contextClass: 'EXTENDED',
    costClass: 'LOW',
  }),
  'deepseek:deepseek-v4-pro': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, 'CODE_REVIEW', 'ARCHITECTURE', 'DATABASE', 'TEST_GENERATION'],
    contextClass: 'EXTENDED',
    costClass: 'MEDIUM',
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
  // Kimi/Moonshot — modelos reais atualizados (achado do pilot real + discovery proativo: o
  // modelo antigo "moonshot-v1-128k" não existe mais na API real; a conta real atual só expõe a
  // família "kimi-k2.x"/"kimi-k3" — confirmado via `GET https://api.moonshot.ai/v1/models`).
  // Preço real (set/2026): K2.6 $0.95/$4.00 e K2.7-Code $0.95/$4.00 (262K ctx); K2.7-Code
  // HighSpeed $1.90/$8.00 (mesma família, 6x mais rápido); K3 (flagship, 2.8T params, 1M ctx)
  // $3/$15 por 1M tokens — "complex coding, knowledge work, long-horizon agentic workflows".
  'kimi:kimi-k2.6': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: ['CODING', 'REPOSITORY_AUDIT', 'CODE_REVIEW', 'LONG_CONTEXT', 'ARCHITECTURE'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'kimi:kimi-k2.7-code': entry({
    roles: ['CODER'],
    capabilities: [...CODING_CORE, 'TEST_GENERATION'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'kimi:kimi-k2.7-code-highspeed': entry({
    roles: ['CODER'],
    capabilities: [...CODING_CORE, 'TEST_GENERATION'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'kimi:kimi-k3': entry({
    roles: ['CODER', 'REVIEWER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'DATABASE', 'FRONTEND', 'RELEASE'],
    contextClass: 'EXTENDED',
    costClass: 'HIGH',
  }),
  // Qwen (Alibaba Cloud) — família com múltiplos modelos/versões, exatamente como qualquer outro
  // provider: as entradas abaixo são elegibilidade DECLARADA por capability, não garantia de
  // disponibilidade. Um `providerId:modelId` só participa do roteamento se estiver aqui
  // (allowlist estática), e mesmo estando aqui continua sujeito a `enabled` (decisão do
  // operador em `ai_providers`), `hasCredential` (credencial do tenant) e `available`
  // (falha real recente do modelId específico registrada em `modelAvailabilityStore`) — os
  // mesmos quatro filtros aplicados a todos os providers em `modelSelector.evaluateCandidate`.
  // Nenhum destes nomes é referenciado em código de roteamento: o Router resolve por capability.
  'qwen:qwen3-coder-plus': entry({
    roles: ['CODER'],
    capabilities: [...CODING_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'FRONTEND'],
    contextClass: 'LONG',
    costClass: 'MEDIUM',
  }),
  'qwen:qwen3-coder-flash': entry({
    roles: ['CODER'],
    capabilities: ['CODING', 'DEBUGGING', 'TEST_GENERATION'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
  }),
  // qwen3-max: modelo generalista de raciocínio — cobre CODER, REVIEWER e ENRICHER, o que dá ao
  // Mission Compiler uma opção Qwen real quando a policy exigir enriquecimento por provider
  // diferente do coder.
  'qwen:qwen3-max': entry({
    roles: ['CODER', 'REVIEWER', 'ENRICHER'],
    capabilities: [...CODING_CORE, ...REVIEW_CORE, 'TEST_GENERATION', 'LONG_CONTEXT', 'DATABASE', 'FRONTEND'],
    contextClass: 'EXTENDED',
    costClass: 'MEDIUM',
  }),
  'qwen:qwen-plus': entry({
    roles: ['REVIEWER', 'ENRICHER'],
    capabilities: ['CODE_REVIEW', 'ARCHITECTURE', 'GOVERNANCE', 'CODING'],
    contextClass: 'LONG',
    costClass: 'LOW',
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
