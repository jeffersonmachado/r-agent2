'use strict';

/**
 * Research Capabilities — subagentes de pesquisa NÃO ganham acesso externo
 * irrestrito.
 *
 * Um agente de pesquisa ("descubra o mercado de Fitness") precisa de rede. Dar
 * a ele `fetch(url)` livre é dar SSRF, exfiltração e evidência não auditável.
 * Em vez disso, o RAP declara CAPABILITIES DE PESQUISA governadas — as mesmas
 * para qualquer subagente — e cada uma pode ser atendida pela implementação
 * nativa ou por uma tool de MCP externo governado:
 *
 *   research.search              → busca em fontes (retorna candidatos + URL)
 *   research.fetch               → obtém um documento (política de endpoint)
 *   research.inspectDocumentation→ extrai estrutura de documentação oficial
 *   research.inspectApiDocs      → extrai contrato de API/Swagger oficial
 *   research.captureEvidence     → registra evidência com hash/Referência
 *
 * Características obrigatórias:
 *  - visibilidade DEVELOPMENT: pesquisa competitiva é superfície de engenharia
 *    (benchmark é SYSTEM/INTERNAL), nunca PRODUCTION;
 *  - `metadata.domain = 'SYSTEM'`: nada de dados de pesquisa em RAG operacional;
 *  - toda capability é READ-ONLY (`sideEffects: false`) — captura de evidência é
 *    gravação INTERNA de artefato, não mutação de domínio de cliente;
 *  - a execução passa pelo Canonical Tool Registry (tenant, permissão,
 *    visibilidade, schema, política, auditoria);
 *  - a resposta de tool MCP é DADO: nunca vira automaticamente
 *    `VERIFIED_OFFICIAL` — quem decide isso é a política de fonte.
 */

const { NATIVE_PROVIDER, resolveProvider } = require('../../../src/core/mcp/capability-resolution');

const RESEARCH_CAPABILITIES = Object.freeze([
  Object.freeze({
    capability: 'research.search',
    id: 'rap.research.search',
    description: 'Busca candidatos de fonte (URL + título) para um termo de pesquisa.',
    runner: 'search',
  }),
  Object.freeze({
    capability: 'research.fetch',
    id: 'rap.research.fetch',
    description: 'Obtém o conteúdo de uma URL de pesquisa sob política de endpoint. Contrato de saída: { httpStatus, content, contentType, retrievedAt, contentHash } — o HASH é do conteúdo efetivamente devolvido e é ele que liga a evidência ao que foi analisado.',
    runner: 'fetch',
  }),
  Object.freeze({
    capability: 'research.inspectDocumentation',
    id: 'rap.research.inspectDocumentation',
    description: 'Extrai estrutura de documentação oficial (seções, recursos, capacidades, jornadas e regras) DO CONTEÚDO recebido. Cada item precisa de locator na fonte.',
    runner: 'inspectDocumentation',
  }),
  Object.freeze({
    capability: 'research.inspectApiDocs',
    id: 'rap.research.inspectApiDocs',
    description: 'Extrai contrato de API oficial (endpoints, operações, schemas e capacidades observáveis) DO CONTEÚDO recebido.',
    runner: 'inspectApiDocs',
  }),
  Object.freeze({
    capability: 'research.captureEvidence',
    id: 'rap.research.captureEvidence',
    description: 'Registra evidência de fonte com hash de conteúdo e referência versionada.',
    runner: 'captureEvidence',
  }),
]);

const RESEARCH_CAPABILITY_IDS = Object.freeze(RESEARCH_CAPABILITIES.map((c) => c.capability));

const VISIBILITY = 'DEVELOPMENT';

function assertRunnerPresent(runners, key, capability) {
  if (typeof runners?.[key] !== 'function') {
    throw new Error(`research_capability_runner_missing: ${key} (${capability})`);
  }
}

/**
 * Registra as capabilities de pesquisa no Canonical Tool Registry
 * (idempotente — registro compartilhado com agentes e MCP).
 *
 * @param {object} registry Canonical Tool Registry
 * @param {object} runners  mapa `runner → função(input, context)`
 * @returns {{registered: string[], existing: string[]}}
 */
function ensureResearchCapabilities(registry, runners = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('research_capability_registry_required');
  }
  const registered = [];
  const existing = [];

  for (const definition of RESEARCH_CAPABILITIES) {
    if (registry.get(definition.id)) {
      existing.push(definition.id);
      continue;
    }
    assertRunnerPresent(runners, definition.runner, definition.capability);

    registry.register({
      id: definition.id,
      capability: definition.capability,
      visibility: VISIBILITY,
      permissions: [definition.capability],
      description: definition.description,
      riskLevel: 'low',
      sideEffects: false,
      confirmationPolicy: 'autonomous',
      idempotencyPolicy: 'none',
      executionMode: 'atomic',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          url: { type: 'string' },
          documentRef: { type: 'string' },
          evidenceRef: { type: 'string' },
          benchmarkId: { type: 'string' },
          sourceTier: { type: 'integer' },
          // §TAREFAS 06-08 — a inspeção opera sobre o CONTEÚDO obtido, e o hash
          // viaja com ele para que a evidência fique ligada ao documento
          // analisado (nunca a uma versão posterior da mesma URL).
          content: { type: 'string' },
          contentHash: { type: 'string' },
          contentType: { type: 'string' },
        },
        additionalProperties: false,
      },
      version: '1.0.0',
      metadata: Object.freeze({
        provider: NATIVE_PROVIDER,
        domain: 'SYSTEM',
        surface: 'research',
        capability: definition.capability,
        // Resposta de tool externa é DADO. Nunca VERIFIED_OFFICIAL automático.
        outputTrust: 'DATA_ONLY',
      }),
      execute: (input, context) => runners[definition.runner](input || {}, {
        ...context,
        capability: definition.capability,
      }),
    });
    registered.push(definition.id);
  }

  return { registered, existing };
}

/**
 * Resolve o provider de uma capability de pesquisa (nativo ou MCP externo) e
 * executa pelo Canonical Tool Registry.
 *
 * Sempre READ-ONLY: a seleção nunca faz fallback para provider com side effect.
 *
 * @returns {Promise<{capability, toolId, provider, reason, output}>}
 */
async function executeResearchCapability({ registry, capability, tenantId, actor, input = {} }) {
  if (!RESEARCH_CAPABILITY_IDS.includes(String(capability))) {
    throw new Error(`research_capability_unknown: ${capability}`);
  }
  const { provider, reason } = resolveProvider({ registry, capability, actor });
  if (!provider) {
    const error = new Error(`research_capability_unavailable: ${capability} (${reason})`);
    error.code = 'capability_unavailable';
    error.reason = reason;
    throw error;
  }

  const result = await registry.execute(provider.id, input, {
    tenantId,
    actor,
    confirmed: false,
  });

  return {
    capability: String(capability),
    toolId: provider.id,
    provider: provider.provider,
    reason,
    output: result.output,
  };
}

/**
 * Proveniência da execução de pesquisa (§22) — liga agente, tool, conexão,
 * fonte e evidência. Nunca contém segredo nem credencial.
 */
function buildResearchProvenance({ agentId = null, capability, toolId, provider, source = null, evidenceRef = null, at = null }) {
  return Object.freeze({
    agentId,
    capability: String(capability),
    toolId: String(toolId),
    provider: String(provider),
    sourceUrl: source?.url || null,
    sourceTier: source?.tier ?? null,
    evidenceRef: evidenceRef || null,
    at: at || new Date().toISOString(),
  });
}

module.exports = {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
  ensureResearchCapabilities,
  executeResearchCapability,
  buildResearchProvenance,
};
