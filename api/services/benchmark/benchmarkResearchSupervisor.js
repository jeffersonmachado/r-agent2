'use strict';

/**
 * Benchmark Research Supervisor — o ORQUESTRADOR REAL da pesquisa competitiva
 * (§B1/§B2/§B3 da missão 2026-09-13).
 *
 * ANTES (gap confirmado): `createBenchmarkResearchRunner()` existia apenas como
 * biblioteca — nenhum caminho de produção o chamava. Uma capacidade sem
 * chamador é código morto com aparência de funcionalidade.
 *
 * AGORA o supervisor:
 *   1. declara uma CAPABILITY CANÔNICA explícita (`benchmark.research.execute`)
 *      no Canonical Tool Registry, visível apenas em DEVELOPMENT — é assim que
 *      o Agent OS / Process Runtime passam a alcançá-lo;
 *   2. monta o plano de pesquisa a partir do SAMPLE declarado (nunca inventa
 *      URL, benchmark ou query sem base);
 *   3. delega cada consulta ao subagente `benchmarkResearchRunner`, que só
 *      executa CAPABILITIES governadas (`research.*`) pelo registry — o
 *      subagente não toca a rede diretamente;
 *   4. persiste fonte → evidência → achado no store (Postgres) e só então
 *      habilita `markAnalyzed`.
 *
 * Honestidade de resultado (regra dura):
 *   - sem provider para as capabilities de pesquisa, o resultado do run é
 *     `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS`, com a lista NOMINAL do que falta.
 *     Nada é registrado, nenhum `analyzedAt` é gravado, nenhum sample é
 *     alterado;
 *   - a ordem do discovery set é a registrada (§5): o supervisor NUNCA abre a
 *     análise sem discovery set pré-registrado;
 *   - o holdout continua protegido pela máquina de estados do serviço (§13).
 */

const { createBenchmarkResearchRunner, RESEARCH_RUN_STATES } = require('./benchmarkResearchRunner');
const {
  RESEARCH_AXES,
  RESEARCH_AXIS_LIST,
  AXIS_STATES,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  assertSystemTenant,
  axisForKind,
  kindForAxis,
  buildAxisCompleteness,
  evaluateAnalyzedCriterion,
} = require('./benchmarkResearchSemantics');
const { RESEARCH_CAPABILITY_IDS } = require('./researchCapabilities');
const {
  createBenchmarkResearchService,
  RESEARCH_STATES,
  RESEARCH_BLOCKERS,
} = require('./benchmarkResearchService');

/**
 * §TAREFA 27/28/83 — PERMISSIONS EXPLÍCITAS do research principal.
 *
 * Antes: `permissions: ['benchmark.research.execute']`. O supervisor podia
 * declarar a capability mas não tinha delegação para `research.*`, então os
 * provedores nunca eram alcançáveis pelo principal default — e um wildcard
 * (`research.*` ou `mcp.*`) teria resolvido o sintoma concedendo MAIS do que o
 * necessário. A lista abaixo é nominal: exatamente o que a pesquisa competitiva
 * usa, nada além.
 */
const RESEARCH_PRINCIPAL_PERMISSIONS = Object.freeze([
  'benchmark.research.execute',
  ...RESEARCH_CAPABILITY_IDS,
]);

/**
 * Principal INTERNO do serviço de pesquisa (TAREFA 28).
 * `classification = DEVELOPMENT` (superfície de engenharia), sem wildcard,
 * sem permissão de domínio de cliente e com tenant SYSTEM resolvido server-side.
 */
function buildResearchPrincipal({ permissions = RESEARCH_PRINCIPAL_PERMISSIONS } = {}) {
  return {
    classification: 'DEVELOPMENT',
    tenant: 'system',
    domain: 'SYSTEM',
    permissions: [...permissions],
  };
}

/** A capability canônica pela qual o runtime alcança a pesquisa de benchmarks. */
const BENCHMARK_RESEARCH_CAPABILITY = Object.freeze({
  id: 'rap.benchmark.research.supervisor',
  capability: 'benchmark.research.execute',
  aliases: Object.freeze(['benchmark.research.execute']),
  visibility: 'DEVELOPMENT',
  permissions: Object.freeze(['benchmark.research.execute']),
  description: 'Executa a pesquisa competitiva de uma vertical de benchmark pelo Canonical Tool Registry.',
  runner: 'execute',
  riskLevel: 'low',
  // Gravação INTERNA de artefato de pesquisa SYSTEM (nunca mutação de domínio
  // de cliente) — mesma semântica declarada para `research.captureEvidence`.
  sideEffects: false,
  confirmationPolicy: 'autonomous',
  idempotencyPolicy: 'recommended',
  executionMode: 'durable',
  version: '1.0.0',
});

/** Estados do run sob a ótica do supervisor (superset dos do runner/service). */
const RESEARCH_RUN_OUTCOMES = Object.freeze({
  BLOCKED_NO_EXTERNAL_ACCESS: 'RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS',
  NOTHING_ANALYZED: 'RESEARCH_NOTHING_ANALYZED',
  PARTIAL: 'RESEARCH_PARTIAL',
  ANALYZED: 'RESEARCH_ANALYZED',
});

/**
 * Severidade de um resultado de fonte que NÃO virou prova.
 *
 * Distinção que importa para o critério de análise (TAREFA 20 — "nenhum erro
 * crítico em aberto"):
 *   - `NO_CANDIDATES` é INFORMATIVO. Uma fonte DECLARADA pelo sample que a
 *     busca não indexou não invalida as outras fontes do mesmo benchmark; o
 *     fato fica registrado no attempt e no relatório.
 *   - `FETCH_FAILED`, `INSPECTION_FAILED` e `EVIDENCE_HASH_MISMATCH` são
 *     CRÍTICOS: havia conteúdo e ele não pôde virar prova. Analisar o benchmark
 *     assim seria declarar cobertura sem ter lido nada.
 */
const OUTCOME_SEVERITY = Object.freeze({
  [RESEARCH_RUN_STATES.NO_CANDIDATES]: 'INFO',
  [RESEARCH_RUN_STATES.FETCH_FAILED]: 'ERROR',
  [RESEARCH_RUN_STATES.INSPECTION_FAILED]: 'ERROR',
  [RESEARCH_RUN_STATES.EVIDENCE_HASH_MISMATCH]: 'ERROR',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normaliza uma URL de fonte para COMPARAÇÃO (barra final e caixa do host).
 * Não é uma normalização de segurança: é só para não recusar a fonte declarada
 * por causa de `https://x.com` vs `https://x.com/`.
 */
function normalizeSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}${url.search}`;
  } catch (_) {
    return raw;
  }
}

/**
 * Registra a capability do supervisor no Canonical Tool Registry (idempotente).
 * Runner ausente é ERRO — capability declarada sem executor é promessa vazia.
 */
function ensureBenchmarkResearchCapability(registry, runners = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('benchmark_research_registry_required');
  }
  if (registry.get(BENCHMARK_RESEARCH_CAPABILITY.id)) {
    return { registered: [], existing: [BENCHMARK_RESEARCH_CAPABILITY.id] };
  }
  const runner = runners[BENCHMARK_RESEARCH_CAPABILITY.runner];
  if (typeof runner !== 'function') {
    throw new Error(`benchmark_research_runner_missing: ${BENCHMARK_RESEARCH_CAPABILITY.runner}`);
  }

  registry.register({
    id: BENCHMARK_RESEARCH_CAPABILITY.id,
    aliases: [...BENCHMARK_RESEARCH_CAPABILITY.aliases],
    capability: BENCHMARK_RESEARCH_CAPABILITY.capability,
    visibility: BENCHMARK_RESEARCH_CAPABILITY.visibility,
    permissions: [...BENCHMARK_RESEARCH_CAPABILITY.permissions],
    description: BENCHMARK_RESEARCH_CAPABILITY.description,
    riskLevel: BENCHMARK_RESEARCH_CAPABILITY.riskLevel,
    sideEffects: BENCHMARK_RESEARCH_CAPABILITY.sideEffects,
    confirmationPolicy: BENCHMARK_RESEARCH_CAPABILITY.confirmationPolicy,
    idempotencyPolicy: BENCHMARK_RESEARCH_CAPABILITY.idempotencyPolicy,
    executionMode: BENCHMARK_RESEARCH_CAPABILITY.executionMode,
    inputSchema: {
      type: 'object',
      required: ['vertical'],
      properties: {
        vertical: { type: 'string' },
        plan: { type: 'array' },
      },
      additionalProperties: false,
    },
    version: BENCHMARK_RESEARCH_CAPABILITY.version,
    metadata: Object.freeze({
      provider: 'native',
      domain: 'SYSTEM',
      surface: 'benchmark-research',
      capability: BENCHMARK_RESEARCH_CAPABILITY.capability,
      outputTrust: 'DATA_ONLY',
    }),
    execute: (input, context) => runner(input || {}, { ...context, capability: BENCHMARK_RESEARCH_CAPABILITY.capability }),
  });

  return { registered: [BENCHMARK_RESEARCH_CAPABILITY.id], existing: [] };
}

/**
 * Plano de pesquisa derivado do SAMPLE declarado.
 *
 * Cada benchmark contribui com (a) as URLs que ELE MESMO declara como fonte
 * oficial e (b) uma query derivada do seu nome. Nada aqui é inventado: se o
 * sample não declara fonte, o benchmark não gera probe e o motivo é explícito.
 *
 * @param {object} sample sample do engine (`config/benchmarks/<vertical>.json`)
 * @returns {{benchmarks: Array, skipped: Array}}
 */
function buildResearchPlanFromSample(sample) {
  const benchmarks = [];
  const skipped = [];
  for (const benchmark of Array.isArray(sample?.benchmarks) ? sample.benchmarks : []) {
    const declaredUrls = (Array.isArray(benchmark.sources) ? benchmark.sources : [])
      .filter((source) => isNonEmptyString(source?.url))
      .map((source) => ({ url: source.url, tier: source.tier ?? null, specificity: source.specificity || null }));
    if (declaredUrls.length === 0) {
      skipped.push({ benchmarkId: benchmark.id, reason: 'benchmark_without_declared_source' });
      continue;
    }
    benchmarks.push({
      benchmarkId: benchmark.id,
      name: benchmark.name || benchmark.id,
      archetype: benchmark.archetype || null,
      role: benchmark.role || null,
      // O SUJEITO da pesquisa (nome + aliases) precisa viajar com o plano para
      // que a extração possa recusar o fornecedor como se fosse achado.
      benchmark: {
        id: benchmark.id,
        name: benchmark.name || benchmark.id,
        aliases: Array.isArray(benchmark.aliases) ? [...benchmark.aliases] : [],
      },
      apiApplicable: benchmark.apiApplicable !== false,
      declaredSources: declaredUrls,
      query: `${benchmark.name || benchmark.id} funcionalidades documentação oficial`,
    });
  }
  return { benchmarks, skipped };
}

/**
 * @param {object} args
 * @param {object} args.store      store persistente (Postgres) — obrigatório
 * @param {object} args.registry   Canonical Tool Registry
 * @param {object} [args.providers] runners REAIS das capabilities `research.*`
 * @param {string} [args.tenantId] tenant do run (pesquisa é SYSTEM)
 * @param {object} [args.actor]    principal (DEVELOPMENT por definição)
 * @param {Function} [args.now]
 * @param {object} [args.logger]
 */
function createBenchmarkResearchSupervisor({
  store,
  registry,
  providers = {},
  tenantId,
  actor,
  now,
  logger,
} = {}) {
  if (!store) throw new Error(RESEARCH_BLOCKERS.PERSISTENCE_REQUIRED);
  if (!registry) throw new Error('benchmark_research_registry_required');

  const log = logger || { info() {}, warn() {}, error() {}, debug() {} };
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  // §TAREFA 30/31/84 — pesquisa competitiva é SYSTEM/INTERNAL. Um tenant
  // operacional aqui seria dado de cliente alimentando pesquisa de mercado.
  const researchTenant = assertSystemTenant(isNonEmptyString(tenantId) ? tenantId : 'system');
  const principal = actor || buildResearchPrincipal();

  const service = createBenchmarkResearchService({ store, now: clock });
  const runner = createBenchmarkResearchRunner({
    registry,
    runners: providers,
    tenantId: researchTenant,
    actor: principal,
    service,
    now: clock,
  });

  function register() {
    return runner.ensureCapabilities();
  }

  /** Capabilities de pesquisa efetivamente ATENDÍVEIS neste runtime. */
  function providerAvailability() {
    const available = runner.availableCapabilities();
    const required = runner.requiredCapabilities;
    const missing = required.filter((capability) => !available.includes(capability));
    const externalAccess = missing.length === 0;
    return {
      available,
      required: [...required],
      missing,
      externalAccess,
      /**
       * Por que a lista de ausentes é o que é (auditável, nunca implícito):
       * a plataforma NÃO implementa provider nativo de pesquisa — as
       * capabilities são atendidas por tools externas governadas registradas
       * no Canonical Tool Registry (MCP Control Plane). Sem conexão MCP
       * habilitada que atenda `research.*`, não há pesquisa possível.
       *
       * Importante: um provedor de LLM NÃO é um provider de pesquisa. A
       * política canônica de fontes é explícita — inferência de LLM não é prova
       * de capability. Usar conhecimento paramétrico como "fonte" produziria
       * exatamente a evidência fabricada que estas regras existem para impedir.
       */
      reason: externalAccess
        ? 'research_provider_available'
        : 'no_governed_research_provider: nenhum provider nativo existe e nenhuma conexão MCP atende research.* (LLM não é fonte de pesquisa)',
    };
  }

  /**
   * Executa a pesquisa de UMA vertical.
   *
   * O discovery set DEVE estar pré-registrado (§5). O supervisor não o cria:
   * criar a ordem e depois analisar seria escolher a ordem que produz o
   * resultado que se quer.
   */
  async function research({ vertical, plan = null, sample = null } = {}) {
    const summary = await service.summarize({ tenantId: researchTenant, vertical });
    if (summary.state === RESEARCH_STATES.NOT_STARTED) {
      const error = new Error(`${RESEARCH_BLOCKERS.NO_DISCOVERY_SET}: ${vertical}`);
      error.code = RESEARCH_BLOCKERS.NO_DISCOVERY_SET;
      throw error;
    }

    register();
    const availability = providerAvailability();
    const rawPlan = plan || (sample ? buildResearchPlanFromSample(sample) : null);
    if (!rawPlan || rawPlan.benchmarks.length === 0) {
      return {
        status: RESEARCH_RUN_OUTCOMES.NOTHING_ANALYZED,
        vertical,
        reason: 'research_plan_empty',
        availability,
        results: [],
        analyzed: [],
      };
    }

    // §5 — só se pesquisa o que foi PRÉ-REGISTRADO. Um plano que cita um
    // benchmark fora do discovery set não é "pesquisa extra": é análise sem
    // ordem declarada, e a curva de novidade deixaria de ser auditável.
    const registered = new Set(Array.isArray(summary.discoverySet) ? summary.discoverySet : []);
    const planned = rawPlan.benchmarks.filter((entry) => registered.has(entry.benchmarkId));
    const skipped = rawPlan.benchmarks
      .filter((entry) => !registered.has(entry.benchmarkId))
      .map((entry) => ({ benchmarkId: entry.benchmarkId, reason: 'benchmark_not_in_discovery_set' }));

    if (planned.length === 0) {
      return {
        status: RESEARCH_RUN_OUTCOMES.NOTHING_ANALYZED,
        vertical,
        reason: 'research_plan_outside_discovery_set',
        availability,
        results: [],
        analyzed: [],
        skipped,
      };
    }

    const results = [];
    const analyzed = [];

    for (const entry of planned) {
      const attempts = [];
      const errors = [];
      const subject = entry.benchmark || { id: entry.benchmarkId, name: entry.name, aliases: [] };
      const apiApplicable = entry.apiApplicable !== false;

      // Estado INICIAL por eixo: `NOT_RESEARCHED`. Um eixo só sai deste estado
      // quando a inspeção de uma fonte efetivamente executou (TAREFA 19/21).
      const axes = {
        [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.NOT_RESEARCHED,
        [RESEARCH_AXES.JOURNEY]: AXIS_STATES.NOT_RESEARCHED,
        [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.NOT_RESEARCHED,
      };
      const findingsByAxis = {
        [RESEARCH_AXES.CAPABILITY]: 0,
        [RESEARCH_AXES.JOURNEY]: 0,
        [RESEARCH_AXES.BUSINESS_RULE]: 0,
      };
      const inspections = { documentation: false, api: false, apiApplicable };
      let blocked = false;

      for (const declared of entry.declaredSources) {
        // O subagente só age por CAPABILITY governada. Sem provider, o retorno
        // é bloqueio explícito — nunca um achado inventado.
        const outcome = await runner.inspectSource({
          vertical,
          benchmark: subject,
          benchmarkId: entry.benchmarkId,
          query: entry.query,
          source: { url: declared.url, tier: declared.tier },
          apiApplicable,
          // A fonte precisa ser EXATAMENTE a declarada. Aceitar "a primeira que
          // veio" atribuiria a um fornecedor a fonte de outro — o tipo de troca
          // silenciosa que transforma evidência em ficção.
          pickCandidate: (candidates) => (Array.isArray(candidates) ? candidates : [])
            .find((candidate) => normalizeSourceUrl(candidate?.url) === normalizeSourceUrl(declared.url)) || null,
        });

        attempts.push({
          url: declared.url,
          status: outcome.status,
          reason: outcome.reason || null,
          findings: Array.isArray(outcome.findings) ? outcome.findings.length : 0,
        });

        if (outcome.status === RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS) {
          blocked = true;
          break;
        }

        if (outcome.status !== RESEARCH_RUN_STATES.EVIDENCE_CAPTURED) {
          // Fonte inspecionável que falhou: o eixo NÃO pode ser declarado
          // pesquisado, e o motivo entra na lista nominal de erros com a
          // severidade correta (informativo ≠ crítico).
          errors.push({
            severity: OUTCOME_SEVERITY[outcome.status] || 'ERROR',
            code: outcome.status,
            reason: outcome.reason || null,
            resolved: false,
            at: clock(),
          });
          continue;
        }

        inspections.documentation = inspections.documentation || outcome.inspections.documentation === true;
        inspections.api = inspections.api || outcome.inspections.api === true;

        for (const extracted of outcome.findings) {
          try {
            await service.recordFinding({
              tenantId: researchTenant,
              vertical,
              benchmarkId: entry.benchmarkId,
              kind: extracted.kind,
              externalName: extracted.externalName,
              canonicalId: extracted.canonicalId,
              source: { ...outcome.source },
              evidenceRef: outcome.evidenceRef,
              classification: extracted.classification,
              archetype: entry.archetype || null,
              origin: extracted.origin,
              locator: extracted.locator,
              normalizedId: extracted.normalizedId,
              analyzedContentHash: outcome.analyzedContentHash,
              benchmark: subject,
              metadata: {
                description: extracted.description,
                fragmentHash: extracted.fragmentHash,
                inspectionKind: extracted.inspectionKind,
                confidence: extracted.confidence,
              },
            });
            const axis = axisForKind(extracted.kind);
            if (axis) findingsByAxis[axis] += 1;
          } catch (error) {
            errors.push({
              severity: 'ERROR',
              code: error.code || 'research_finding_not_recorded',
              reason: error.message,
              resolved: false,
              at: clock(),
            });
          }
        }
      }

      // Transição de estado por eixo, derivada dos FATOS desta passagem.
      for (const axis of RESEARCH_AXIS_LIST) {
        if (blocked) {
          axes[axis] = AXIS_STATES.BLOCKED;
          continue;
        }
        const postgres = findingsByAxis[axis];
        if (inspections.documentation && (inspections.api || !apiApplicable)) {
          axes[axis] = postgres > 0 ? AXIS_STATES.RESEARCHED_WITH_FINDINGS : AXIS_STATES.RESEARCHED_NO_FINDINGS;
        } else if (attempts.length > 0) {
          axes[axis] = AXIS_STATES.FAILED;
        }
        await service.setAxisState({
          tenantId: researchTenant,
          vertical,
          benchmarkId: entry.benchmarkId,
          axis,
          state: axes[axis],
          reason: axes[axis] === AXIS_STATES.FAILED ? 'inspection_not_executed' : null,
        });
      }

      await service.recordInspections({
        tenantId: researchTenant,
        vertical,
        benchmarkId: entry.benchmarkId,
        inspections: { ...inspections, executedAt: clock() },
        // O SUJEITO e a lista de erros ficam PERSISTIDOS: o critério de análise
        // e a recusa precisam ser reconstruíveis depois do restart.
        metadata: { benchmark: subject, errors },
      });

      const result = {
        benchmarkId: entry.benchmarkId,
        attempts,
        axes,
        findingsByAxis,
        axisCompleteness: buildAxisCompleteness({ axes }),
        errors,
      };
      results.push(result);

      // §TAREFA 20/25/80 — `markAnalyzed` só é TENTADO quando o critério forte
      // é satisfeito. A recusa é reportada nominalmente, nunca silenciada.
      const criterion = evaluateAnalyzedCriterion({
        benchmark: subject,
        inspections,
        axes,
        findings: Object.values(findingsByAxis).some((count) => count > 0) ? [{ verified: true }] : [],
        evidence: inspections.documentation ? [{ verified: true, contentHash: 'bound', locator: 'bound' }] : [],
        errors,
        sourceDiscovery: attempts.some((attempt) => attempt.status === RESEARCH_RUN_STATES.EVIDENCE_CAPTURED),
      });
      if (!criterion.satisfied) {
        result.analysisRefused = criterion.missing;
        continue;
      }

      try {
        await service.markAnalyzed({
          tenantId: researchTenant,
          vertical,
          benchmarkId: entry.benchmarkId,
          marketArchetypeMapping: {
            archetype: entry.archetype || 'unmapped',
            rationale: 'mapeamento declarado no sample do benchmark',
          },
        });
        analyzed.push(entry.benchmarkId);
      } catch (error) {
        result.analysisRefused = error.code === RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE
          ? `${error.code}: ${error.message}`
          : (error.code || error.message);
      }
    }

    const blocked = results.every((result) => result.attempts.every(
      (attempt) => attempt.status === RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS,
    ));

    let status = RESEARCH_RUN_OUTCOMES.NOTHING_ANALYZED;
    if (blocked) status = RESEARCH_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS;
    else if (analyzed.length > 0) status = RESEARCH_RUN_OUTCOMES.ANALYZED;
    else if (results.some((result) => result.attempts.length > 0)) status = RESEARCH_RUN_OUTCOMES.PARTIAL;

    log.info('[benchmark-research] run concluído', {
      tenant: researchTenant,
      vertical,
      status,
      analyzed: analyzed.length,
      missingCapabilities: availability.missing,
    });

    return {
      status,
      vertical,
      availability,
      results,
      analyzed,
      skipped,
      summary: await service.summarize({ tenantId: researchTenant, vertical }),
    };
  }

  /** PATCH do sample derivado dos fatos PERSISTIDOS (consumido pelo registro). */
  function buildSamplePatch({ vertical, inventoryVersion = null } = {}) {
    return service.buildSamplePatch({ tenantId: researchTenant, vertical, inventoryVersion });
  }

  function summarize({ vertical } = {}) {
    return service.summarize({ tenantId: researchTenant, vertical });
  }

  return {
    tenantId: researchTenant,
    actor: principal,
    capability: BENCHMARK_RESEARCH_CAPABILITY,
    register,
    providerAvailability,
    research,
    buildSamplePatch,
    summarize,
    ensureCapabilities: register,
    service,
    runner,
  };
}

module.exports = {
  BENCHMARK_RESEARCH_CAPABILITY,
  RESEARCH_RUN_OUTCOMES,
  RESEARCH_PRINCIPAL_PERMISSIONS,
  OUTCOME_SEVERITY,
  buildResearchPrincipal,
  buildResearchPlanFromSample,
  ensureBenchmarkResearchCapability,
  createBenchmarkResearchSupervisor,
};
