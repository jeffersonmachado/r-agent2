'use strict';

/**
 * Benchmark Research Runner — o subagente de pesquisa NÃO acessa a web
 * diretamente: ele executa CAPABILITIES governadas (`research.*`) e persiste o
 * resultado como evidência auditável.
 *
 * PROBLEMA (ordem de execução #14): existir a camada de pesquisa não basta se
 * o agente puder simplesmente buscar e "achar" coisas. O runner fecha o ciclo:
 *
 *   research.search           → candidatos de fonte (URL + título)
 *   research.fetch            → conteúdo + status HTTP REAIS
 *   research.captureEvidence  → referência de evidência + hash de conteúdo
 *   benchmarkResearchService  → registro do achado COM a fonte verificada
 *
 * Regras:
 *  - sem provider para a capability, o estado é `BLOCKED_NO_EXTERNAL_ACCESS` —
 *    nunca "zero novidade", nunca achado inventado, nunca estado do sample
 *    alterado por ausência de trabalho;
 *  - `verified` NÃO é decidido pelo agente: vem do status HTTP real obtido pelo
 *    `research.fetch`. Sem obtenção confirmada o achado é registrado como não
 *    verificado e NÃO conta como prova;
 *  - toda capability é resolvida pelo Canonical Tool Registry (tenant,
 *    visibilidade, permissão, schema, política e auditoria aplicados lá);
 *  - o runner não liga a web sozinho: os runners de capability são INJETADOS.
 *    Sem injeção, o resultado é bloqueio explícito — não um mock silencioso.
 */

const {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
  ensureResearchCapabilities,
  executeResearchCapability,
  buildResearchProvenance,
} = require('./researchCapabilities');

const RESEARCH_RUN_STATES = Object.freeze({
  BLOCKED_NO_EXTERNAL_ACCESS: 'RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS',
  NO_CANDIDATES: 'RESEARCH_NO_CANDIDATES',
  EVIDENCE_CAPTURED: 'RESEARCH_EVIDENCE_CAPTURED',
  FETCH_FAILED: 'RESEARCH_FETCH_FAILED',
});

/** Capacities exigidas em sequência para registrar um achado com evidência. */
const REQUIRED_CAPABILITIES = Object.freeze(['research.search', 'research.fetch', 'research.captureEvidence']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {object} args
 * @param {object} args.registry  Canonical Tool Registry
 * @param {object} [args.runners] implementações reais (rede/MCP) das capabilities
 * @param {string} args.tenantId  tenant do run (research é SYSTEM: 'system')
 * @param {object} args.actor     principal com classificação e escopos
 * @param {object} args.service   `benchmarkResearchService` (registro de achados)
 * @param {Function} [args.now]
 */
function createBenchmarkResearchRunner({ registry, runners, tenantId, actor, service, now } = {}) {
  if (!registry) throw new Error('research_runner_registry_required');
  if (!service) throw new Error('research_runner_service_required');

  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  const actorPrincipal = actor || { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS };

  /**
   * Registra apenas as capabilities cujo runner foi INJETADO.
   *
   * Runner ausente não é erro de programa: é ausência de provider (a
   * capability simplesmente não existe neste runtime). Por isso o registro é
   * parcial e as ausentes são reportadas — o bloqueio aparece em
   * `availableCapabilities()`, não como exceção.
   */
  function ensureCapabilities() {
    const present = {};
    const missing = [];
    for (const definition of RESEARCH_CAPABILITIES) {
      const runner = runners?.[definition.runner];
      if (typeof runner !== 'function') {
        missing.push(definition.capability);
        continue;
      }
      present[definition.runner] = runner;
    }
    const registration = Object.keys(present).length > 0
      ? ensureResearchCapabilities(registry, present)
      : { registered: [], existing: [] };
    return { ...registration, missing };
  }

  /** Capacidades efetivamente atendíveis neste runtime. */
  function availableCapabilities() {
    return RESEARCH_CAPABILITY_IDS.filter((capability) => {
      try {
        const providers = registry.list({ classification: actorPrincipal.classification, permissions: actorPrincipal.permissions });
        return providers.some((tool) => tool.capability === capability);
      } catch (_) {
        return false;
      }
    });
  }

  /**
   * Executa uma capability de pesquisa pelo registry (governada).
   * Propaga o erro de indisponibilidade sem mascará-lo.
   */
  async function callCapability(capability, input) {
    return executeResearchCapability({
      registry,
      capability,
      tenantId,
      actor: actorPrincipal,
      input,
    });
  }

  /**
   * Descobre uma fonte, obtém o conteúdo, captura evidência e REGISTRA o achado.
   *
   * @returns {Promise<{status, finding?, evidence?, provenance, reason?}>}
   */
  async function researchAndRecord({
    vertical,
    benchmarkId,
    query,
    externalName,
    kind,
    canonicalId = null,
    classification = null,
    archetype = null,
    sourceTier = null,
    pickCandidate = null,
  } = {}) {
    if (!isNonEmptyString(vertical) || !isNonEmptyString(benchmarkId) || !isNonEmptyString(query)) {
      throw new Error('research_runner_input_invalid');
    }

    ensureCapabilities();

    const missing = REQUIRED_CAPABILITIES.filter((capability) => !availableCapabilities().includes(capability));
    if (missing.length > 0) {
      // Sem acesso externo configurado: BLOQUEIO explícito e auditável.
      return {
        status: RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS,
        reason: `research_capability_unavailable: ${missing.join(', ')}`,
        provenance: null,
      };
    }

    const search = await callCapability('research.search', { query });
    const candidates = Array.isArray(search.output?.candidates) ? search.output.candidates : [];
    const chosen = typeof pickCandidate === 'function' ? pickCandidate(candidates) : candidates[0];
    if (!chosen || !isNonEmptyString(chosen.url)) {
      return {
        status: RESEARCH_RUN_STATES.NO_CANDIDATES,
        reason: 'research_no_candidate_source',
        provenance: null,
      };
    }

    const fetched = await callCapability('research.fetch', { url: chosen.url });
    const httpStatus = Number(fetched.output?.httpStatus);
    const content = typeof fetched.output?.content === 'string' ? fetched.output.content : '';
    if (!Number.isFinite(httpStatus) || httpStatus >= 400 || content === '') {
      // Obtenção NÃO confirmada: nada é registrado como prova.
      return {
        status: RESEARCH_RUN_STATES.FETCH_FAILED,
        reason: `research_fetch_not_confirmed: status=${Number.isFinite(httpStatus) ? httpStatus : 'unknown'}`,
        provenance: buildResearchProvenance({
          capability: 'research.fetch',
          toolId: fetched.toolId,
          provider: fetched.provider,
          source: { url: chosen.url, tier: sourceTier },
          at: clock(),
        }),
      };
    }

    const captured = await callCapability('research.captureEvidence', {
      url: chosen.url,
      documentRef: chosen.url,
      benchmarkId,
    });
    const evidenceRef = captured.output?.evidenceRef || captured.output?.contentHash || null;
    if (!isNonEmptyString(evidenceRef)) {
      return {
        status: RESEARCH_RUN_STATES.FETCH_FAILED,
        reason: 'research_evidence_not_captured',
        provenance: null,
      };
    }

    const source = {
      url: chosen.url,
      tier: sourceTier,
      specificity: chosen.specificity || 'SPECIFIC',
      // A VERIFICAÇÃO vem do status HTTP real obtido pela capability — nunca de
      // uma afirmação do agente.
      verified: true,
      httpStatus,
    };

    const finding = service.recordFinding({
      vertical,
      benchmarkId,
      kind,
      externalName: externalName || chosen.title || chosen.url,
      canonicalId,
      source,
      evidenceRef,
      classification,
      archetype,
    });

    return {
      status: RESEARCH_RUN_STATES.EVIDENCE_CAPTURED,
      finding,
      source,
      provenance: buildResearchProvenance({
        capability: 'research.captureEvidence',
        toolId: captured.toolId,
        provider: captured.provider,
        source: { url: chosen.url, tier: sourceTier },
        evidenceRef,
        at: clock(),
      }),
    };
  }

  /** Marca o benchmark como analisado (exige evidência já registrada). */
  function markAnalyzed({ vertical, benchmarkId, marketArchetypeMapping }) {
    return service.markAnalyzed({ vertical, benchmarkId, marketArchetypeMapping });
  }

  return {
    researchAndRecord,
    markAnalyzed,
    availableCapabilities,
    ensureCapabilities,
    states: RESEARCH_RUN_STATES,
    requiredCapabilities: REQUIRED_CAPABILITIES,
    capabilities: RESEARCH_CAPABILITIES,
  };
}

module.exports = { RESEARCH_RUN_STATES, REQUIRED_CAPABILITIES, createBenchmarkResearchRunner };
