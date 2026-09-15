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

const { extractInspectionFindings } = require('./benchmarkFindingExtraction');
const { RESEARCH_AXES, SEMANTIC_CODES, FINDING_ORIGINS } = require('./benchmarkResearchSemantics');

const crypto = require('crypto');

const RESEARCH_RUN_STATES = Object.freeze({
  BLOCKED_NO_EXTERNAL_ACCESS: 'RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS',
  NO_CANDIDATES: 'RESEARCH_NO_CANDIDATES',
  EVIDENCE_CAPTURED: 'RESEARCH_EVIDENCE_CAPTURED',
  FETCH_FAILED: 'RESEARCH_FETCH_FAILED',
  INSPECTION_FAILED: 'RESEARCH_INSPECTION_FAILED',
  EVIDENCE_HASH_MISMATCH: 'RESEARCH_EVIDENCE_HASH_MISMATCH',
});

/**
 * Capacidades exigidas em sequência para registrar um achado com evidência.
 *
 * §TAREFA 07/08 — `inspectDocumentation` e `inspectApiDocs` são OBRIGATÓRIAS na
 * cadeia: antes elas existiam no catálogo e nunca eram chamadas, então a
 * "pesquisa" era uma URL guardada como prova de 30 funcionalidades. Inspeção é
 * o passo que transforma documento em estrutura.
 */
const REQUIRED_CAPABILITIES = Object.freeze([
  'research.search',
  'research.fetch',
  'research.inspectDocumentation',
  'research.captureEvidence',
]);

/** Exigida sempre que o benchmark declara superfície de API. */
const API_CAPABILITY = 'research.inspectApiDocs';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

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
   * CADEIA COMPLETA de inspeção de UMA fonte declarada (§TAREFAS 05-12):
   *
   *   search → fetch (com contentHash) → inspectDocumentation/inspectApiDocs
   *   → extração estruturada → achados com evidência LIGADA ao hash analisado
   *
   * O runner NÃO grava nada aqui: ele devolve a estrutura extraída para o
   * supervisor decidir e registrar. Isso mantém a política no serviço.
   *
   * @returns {Promise<{status, source, inspections, findings, rejected, reason, provenance}>}
   */
  async function inspectSource({
    vertical,
    benchmark,
    benchmarkId,
    query,
    source,
    apiApplicable = true,
    pickCandidate = null,
    // Quando a busca NÃO superficia a fonte declarada, a fonte — que vem do
    // sample GOVERNADO (config/benchmarks/<vertical>.json, pré-registrado e
    // verificado por humano) — é obtida DIRETAMENTE. Isto é CONFIRMAÇÃO de
    // fonte: a URL não veio da busca, então não há risco de substituição; a
    // evidência continua ligada ao conteúdo real obtido, por hash. O default
    // é `false` para que chamadores de pura descoberta mantenham NO_CANDIDATES.
    declaredUrlFallback = false,
  } = {}) {
    ensureCapabilities();

    const missing = REQUIRED_CAPABILITIES.filter((capability) => !availableCapabilities().includes(capability));
    if (apiApplicable && !availableCapabilities().includes(API_CAPABILITY)) missing.push(API_CAPABILITY);
    if (missing.length > 0) {
      return {
        status: RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS,
        reason: `research_capability_unavailable: ${missing.join(', ')}`,
        missing,
        inspections: { documentation: false, api: false, apiApplicable },
        findings: [],
        rejected: [],
        provenance: null,
      };
    }

    const search = await callCapability('research.search', { query });
    const candidates = Array.isArray(search.output?.candidates) ? search.output.candidates : [];
    let chosen = typeof pickCandidate === 'function' ? pickCandidate(candidates) : candidates[0];
    // A proveniência da SELEÇÃO é parte do registro de auditoria: a mesma URL
    // alcançada pela busca ou pelo fallback declarado significa coisas
    // diferentes para quem audita (descoberta vs confirmação de fonte).
    let sourceSelection = 'search';
    if ((!chosen || !isNonEmptyString(chosen.url))
      && declaredUrlFallback === true
      && isNonEmptyString(source?.url)) {
      // EXATAMENTE a URL declarada — nunca "o candidato mais parecido".
      chosen = { url: String(source.url).trim(), title: String(source.url).trim() };
      sourceSelection = 'declared-config';
    }
    if (!chosen || !isNonEmptyString(chosen.url)) {
      return {
        status: RESEARCH_RUN_STATES.NO_CANDIDATES,
        reason: 'research_no_candidate_source',
        inspections: { documentation: false, api: false, apiApplicable },
        findings: [],
        rejected: [],
        provenance: null,
      };
    }

    const fetched = await callCapability('research.fetch', { url: chosen.url });
    const httpStatus = Number(fetched.output?.httpStatus);
    const content = typeof fetched.output?.content === 'string' ? fetched.output.content : '';
    if (!Number.isFinite(httpStatus) || httpStatus >= 400 || content === '') {
      return {
        status: RESEARCH_RUN_STATES.FETCH_FAILED,
        reason: `research_fetch_not_confirmed: status=${Number.isFinite(httpStatus) ? httpStatus : 'unknown'}`,
        inspections: { documentation: false, api: false, apiApplicable },
        findings: [],
        rejected: [],
        provenance: buildResearchProvenance({
          capability: 'research.fetch',
          toolId: fetched.toolId,
          provider: fetched.provider,
          source: { url: chosen.url, tier: source?.tier ?? null },
          at: clock(),
          sourceSelection,
        }),
      };
    }

    // §TAREFA 06 — o hash é do conteúdo EFETIVAMENTE analisado. Se o provider
    // não devolve hash, ele é CALCULADO do conteúdo recebido (nunca assumido).
    const analyzedContentHash = isNonEmptyString(fetched.output?.contentHash)
      ? String(fetched.output.contentHash)
      : `sha256:${sha256Hex(content)}`;
    const contentType = isNonEmptyString(fetched.output?.contentType)
      ? String(fetched.output.contentType)
      : (isNonEmptyString(chosen.contentType) ? String(chosen.contentType) : null);

    const captured = await callCapability('research.captureEvidence', {
      url: chosen.url,
      documentRef: chosen.url,
      benchmarkId,
      contentHash: analyzedContentHash,
    });
    const evidenceRef = captured.output?.evidenceRef || captured.output?.contentHash || null;
    if (!isNonEmptyString(evidenceRef)) {
      return {
        status: RESEARCH_RUN_STATES.FETCH_FAILED,
        reason: 'research_evidence_not_captured',
        inspections: { documentation: false, api: false, apiApplicable },
        findings: [],
        rejected: [],
        provenance: null,
      };
    }

    // §TAREFA 11 — binding: a evidência precisa ser do MESMO conteúdo analisado.
    const evidenceContentHash = isNonEmptyString(captured.output?.contentHash)
      ? String(captured.output.contentHash)
      : analyzedContentHash;
    if (evidenceContentHash !== analyzedContentHash) {
      return {
        status: RESEARCH_RUN_STATES.EVIDENCE_HASH_MISMATCH,
        reason: `${SEMANTIC_CODES.EVIDENCE_HASH_MISMATCH}: analyzed=${analyzedContentHash} evidence=${evidenceContentHash}`,
        inspections: { documentation: false, api: false, apiApplicable },
        findings: [],
        rejected: [],
        evidenceRef,
        analyzedContentHash,
        evidenceContentHash,
        provenance: null,
      };
    }

    const inspections = { documentation: false, api: false, apiApplicable };
    const findings = [];
    const rejected = [];
    const perAxis = {};

    // Falha de inspeção é um FATO DE PESQUISA (a fonte foi obtida, mas não foi
    // possível extrair estrutura dela) — nunca um crash e nunca "zero achados
    // silencioso". Um eixo que não foi inspecionado não pode ser declarado
    // pesquisado.
    let documentationInspection;
    try {
      documentationInspection = await callCapability('research.inspectDocumentation', {
        url: chosen.url,
        content,
        contentHash: analyzedContentHash,
        contentType,
        query,
      });
    } catch (error) {
      return {
        status: RESEARCH_RUN_STATES.INSPECTION_FAILED,
        reason: `research_inspection_failed: inspectDocumentation (${error.message})`,
        inspections,
        findings: [],
        rejected: [],
        evidenceRef,
        analyzedContentHash,
        sourceSelection,
        provenance: null,
      };
    }
    inspections.documentation = true;
    const documentationExtraction = extractInspectionFindings({
      inspection: documentationInspection.output || {},
      inspectionKind: 'documentation',
      vertical,
      benchmarkId,
      benchmark,
      contentHash: analyzedContentHash,
      sourceUrl: chosen.url,
      sourceTier: source?.tier ?? null,
    });
    findings.push(...documentationExtraction.findings.map((finding) => ({ ...finding, inspectionKind: 'documentation' })));
    rejected.push(...documentationExtraction.rejected.map((entry) => ({ ...entry, inspectionKind: 'documentation' })));
    perAxis.documentation = documentationExtraction.perAxis;

    if (apiApplicable) {
      let apiInspection;
      try {
        apiInspection = await callCapability('research.inspectApiDocs', {
          url: chosen.url,
          content,
          contentHash: analyzedContentHash,
          contentType,
          query,
        });
      } catch (error) {
        // A inspeção de documentação JÁ aconteceu: o eixo ainda não pode ser
        // declarado completo sem a parte de API. O motivo é nominal.
        return {
          status: RESEARCH_RUN_STATES.INSPECTION_FAILED,
          reason: `research_inspection_failed: inspectApiDocs (${error.message})`,
          inspections,
          findings,
          rejected,
          perAxis,
          evidenceRef,
          analyzedContentHash,
          sourceSelection,
          provenance: null,
        };
      }
      inspections.api = true;
      const apiExtraction = extractInspectionFindings({
        inspection: apiInspection.output || {},
        inspectionKind: 'api',
        vertical,
        benchmarkId,
        benchmark,
        contentHash: analyzedContentHash,
        sourceUrl: chosen.url,
        sourceTier: source?.tier ?? null,
      });
      findings.push(...apiExtraction.findings.map((finding) => ({ ...finding, inspectionKind: 'api' })));
      rejected.push(...apiExtraction.rejected.map((entry) => ({ ...entry, inspectionKind: 'api' })));
      perAxis.api = apiExtraction.perAxis;
    }

    return {
      status: RESEARCH_RUN_STATES.EVIDENCE_CAPTURED,
      reason: null,
      source: {
        url: chosen.url,
        tier: source?.tier ?? null,
        specificity: chosen.specificity || 'SPECIFIC',
        // A VERIFICAÇÃO vem do status HTTP real — nunca de uma afirmação do agente.
        verified: true,
        httpStatus,
        contentType,
        contentHash: analyzedContentHash,
        sourceSelection,
      },
      inspections,
      evidenceRef,
      analyzedContentHash,
      findings,
      rejected,
      perAxis,
      axesAttempted: Object.keys(perAxis),
      provenance: buildResearchProvenance({
        capability: 'research.captureEvidence',
        toolId: captured.toolId,
        provider: captured.provider,
        source: { url: chosen.url, tier: source?.tier ?? null },
        evidenceRef,
        at: clock(),
        sourceSelection,
      }),
    };
  }

  /**
   * Descobre uma fonte, obtém o conteúdo, captura evidência e REGISTRA o achado.
   *
   * ATENÇÃO (missão corretiva): este método registra UM achado cujo nome vem do
   * chamador. Ele NÃO pode ser usado com o nome do concorrente — o serviço
   * recusa por código (`BENCHMARK_SUBJECT_IS_NOT_A_FINDING`). O caminho de
   * produção é `inspectSource()`, que extrai o nome do CONTEÚDO.
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
    locator = null,
    contentHash = null,
    benchmark = null,
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
      // §TAREFA 11 — o hash acompanha a fonte: sem ele a evidência não está
      // ligada ao conteúdo analisado.
      contentHash: contentHash || (isNonEmptyString(fetched.output?.contentHash)
        ? String(fetched.output.contentHash)
        : `sha256:${sha256Hex(content)}`),
    };

    const finding = await service.recordFinding({
      tenantId,
      vertical,
      benchmarkId,
      kind,
      externalName: externalName || chosen.title || chosen.url,
      canonicalId,
      source,
      evidenceRef,
      classification,
      archetype,
      locator,
      analyzedContentHash: source.contentHash,
      benchmark,
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

  /** Marca o benchmark como analisado (exige evidência já REGISTRADA no store). */
  function markAnalyzed({ vertical, benchmarkId, marketArchetypeMapping }) {
    return service.markAnalyzed({ tenantId, vertical, benchmarkId, marketArchetypeMapping });
  }

  return {
    researchAndRecord,
    inspectSource,
    markAnalyzed,
    availableCapabilities,
    ensureCapabilities,
    states: RESEARCH_RUN_STATES,
    requiredCapabilities: REQUIRED_CAPABILITIES,
    apiCapability: API_CAPABILITY,
    capabilities: RESEARCH_CAPABILITIES,
  };
}

module.exports = { RESEARCH_RUN_STATES, REQUIRED_CAPABILITIES, API_CAPABILITY, createBenchmarkResearchRunner };
