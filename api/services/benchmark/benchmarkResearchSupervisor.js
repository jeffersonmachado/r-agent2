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
  createBenchmarkResearchService,
  RESEARCH_STATES,
  RESEARCH_BLOCKERS,
} = require('./benchmarkResearchService');

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
  const researchTenant = isNonEmptyString(tenantId) ? String(tenantId) : 'system';
  const principal = actor || {
    classification: 'DEVELOPMENT',
    permissions: [BENCHMARK_RESEARCH_CAPABILITY.capability],
  };

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
      for (const declared of entry.declaredSources) {
        // O subagente só age por CAPABILITY governada. Sem provider, o retorno
        // é bloqueio explícito — nunca um achado inventado.
        const outcome = await runner.researchAndRecord({
          vertical,
          benchmarkId: entry.benchmarkId,
          query: entry.query,
          kind: 'capability',
          externalName: entry.name,
          sourceTier: declared.tier,
          // A fonte precisa ser EXATAMENTE a declarada. Aceitar "a primeira que
          // veio" atribuiria a um fornecedor a fonte de outro — o tipo de troca
          // silenciosa que transforma evidência em ficção.
          pickCandidate: (candidates) => (Array.isArray(candidates) ? candidates : [])
            .find((candidate) => normalizeSourceUrl(candidate?.url) === normalizeSourceUrl(declared.url)) || null,
        });
        attempts.push({ url: declared.url, status: outcome.status, reason: outcome.reason || null });
        if (outcome.status === RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS) break;
      }

      results.push({ benchmarkId: entry.benchmarkId, attempts });

      // `markAnalyzed` só é tentado quando existe evidência VERIFICADA.
      // Recusa é reportada nominalmente — nunca silenciada.
      if (attempts.some((attempt) => attempt.status === RESEARCH_RUN_STATES.EVIDENCE_CAPTURED)) {
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
          results[results.length - 1].analysisRefused = error.code || error.message;
        }
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
  buildResearchPlanFromSample,
  ensureBenchmarkResearchCapability,
  createBenchmarkResearchSupervisor,
};
