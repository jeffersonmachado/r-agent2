'use strict';

/**
 * Benchmark Research Semantics — a POLÍTICA que impede a pesquisa competitiva de
 * virar ficção auditável.
 *
 * Contexto (missão corretiva 2026-09-13). O supervisor chamava o runner assim:
 *
 *     runner.researchAndRecord({ kind: 'capability', externalName: entry.name })
 *
 * onde `entry.name` é o nome do CONCORRENTE ("EVO (W12)"). O resultado era um
 * achado `kind: 'capability'`, verificado, chamado "EVO" — que o
 * `buildNovelty()` do serviço incluía em `newCapabilities`. Ou seja: o
 * concorrente entrava na curva de novidade como se fosse uma capacidade que a
 * plataforma não tem. Isso contamina três métricas de uma vez (novidade,
 * saturação e certificação) e é o tipo de erro que passa por todos os gates
 * porque cada gate isolado olha para uma peça diferente.
 *
 * Este módulo declara, de forma TESTÁVEL e sem I/O:
 *
 *   1. SUJEITO ≠ ACHADO — o nome do fornecedor nunca é um achado
 *      (`isSubjectNameFinding`), em nenhum eixo;
 *   2. EIXOS — capability / journey / businessRule, cada um com estado de
 *      pesquisa próprio. "Não pesquisado" NUNCA vale "zero novidade";
 *   3. CRITÉRIO DE ANÁLISE — `markAnalyzed` só é satisfeito com inspeção real
 *      (documentação e API), três eixos pesquisados e evidência válida;
 *   4. NORMALIZAÇÃO — equivalência semântica explícita e versionada
 *      (`config/benchmark-normalization.json`), com longest-match-wins e
 *      `OVER_MERGE_REFUSED` para semânticas distintas (freeze ≠ cancel ≠
 *      scheduled cancel ≠ suspend access ≠ inactive ≠ expired);
 *   5. ORIGEM — `EXTERNAL_OBSERVED` (tem locator na fonte) vs `RAP_DERIVED`
 *      (inferência interna). Inferência interna não é observação do
 *      concorrente e NÃO entra na novidade.
 *
 * Nada aqui inventa capacidade: o módulo só ACEITA ou RECUSA o que a inspeção
 * de fonte entregou.
 */

const NORMALIZATION_POLICY = require('../../../config/benchmark-normalization.json');

/** Eixos de pesquisa — cada um tem estado próprio (TAREFA 19). */
const RESEARCH_AXES = Object.freeze({
  CAPABILITY: 'CAPABILITY_AXIS',
  JOURNEY: 'JOURNEY_AXIS',
  BUSINESS_RULE: 'BUSINESS_RULE_AXIS',
});

const RESEARCH_AXIS_LIST = Object.freeze([
  RESEARCH_AXES.CAPABILITY,
  RESEARCH_AXES.JOURNEY,
  RESEARCH_AXES.BUSINESS_RULE,
]);

/**
 * Estado de pesquisa de UM eixo. `RESEARCHED_NO_FINDINGS` é o estado que a
 * missão exige para "pesquisei a fundo e não achei nada novo" — é ZERO
 * novidade MEDIDO, diferente de `NOT_RESEARCHED`, que é zero novidade
 * DESCONHECIDO (e portanto não pode entrar em denominador nenhum).
 */
const AXIS_STATES = Object.freeze({
  NOT_RESEARCHED: 'NOT_RESEARCHED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESEARCHED_NO_FINDINGS: 'RESEARCHED_NO_FINDINGS',
  RESEARCHED_WITH_FINDINGS: 'RESEARCHED_WITH_FINDINGS',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
});

const RESEARCHED_AXIS_STATES = Object.freeze([
  AXIS_STATES.RESEARCHED_NO_FINDINGS,
  AXIS_STATES.RESEARCHED_WITH_FINDINGS,
]);

/** Origem de um achado. */
const FINDING_ORIGINS = Object.freeze({
  EXTERNAL_OBSERVED: 'EXTERNAL_OBSERVED',
  RAP_DERIVED: 'RAP_DERIVED',
});

/** Códigos estáveis — consumidores decidem por código, nunca por texto. */
const SEMANTIC_CODES = Object.freeze({
  SUBJECT_AS_FINDING: 'BENCHMARK_SUBJECT_IS_NOT_A_FINDING',
  SUBJECT_AS_CAPABILITY: 'benchmark_subject_is_not_capability',
  OVER_MERGE_REFUSED: 'BENCHMARK_OVER_MERGE_REFUSED',
  INSPECTION_DOCUMENTATION_MISSING: 'benchmark_inspection_documentation_missing',
  INSPECTION_API_MISSING: 'benchmark_inspection_api_missing',
  AXIS_CAPABILITY_NOT_RESEARCHED: 'benchmark_axis_capability_not_researched',
  AXIS_JOURNEY_NOT_RESEARCHED: 'benchmark_axis_journey_not_researched',
  AXIS_BUSINESS_RULE_NOT_RESEARCHED: 'benchmark_axis_business_rule_not_researched',
  AXIS_BLOCKED: 'benchmark_axis_blocked',
  NO_VERIFIED_FINDING: 'benchmark_no_verified_finding',
  NO_VALID_EVIDENCE: 'benchmark_no_valid_evidence',
  API_NOT_APPLICABLE_UNJUSTIFIED: 'benchmark_api_not_applicable_unjustified',
  EVIDENCE_HASH_MISSING: 'benchmark_evidence_hash_missing',
  EVIDENCE_HASH_MISMATCH: 'EVIDENCE_HASH_MISMATCH',
  INSPECTION_HASH_MISMATCH: 'INSPECTION_HASH_MISMATCH',
  EVIDENCE_LOCATOR_MISSING: 'benchmark_evidence_locator_missing',
  RESEARCH_ERROR_UNRESOLVED: 'benchmark_research_error_unresolved',
  SYSTEM_TENANT_REQUIRED: 'benchmark_research_system_tenant_required',
});

const SYSTEM_TENANT_ALIASES = Object.freeze(['system', 'internal', 'rap-system', 'system-internal']);

const KIND_TO_AXIS = Object.freeze({
  capability: RESEARCH_AXES.CAPABILITY,
  journey: RESEARCH_AXES.JOURNEY,
  businessRule: RESEARCH_AXES.BUSINESS_RULE,
});

const AXIS_TO_KIND = Object.freeze({
  [RESEARCH_AXES.CAPABILITY]: 'capability',
  [RESEARCH_AXES.JOURNEY]: 'journey',
  [RESEARCH_AXES.BUSINESS_RULE]: 'businessRule',
});

const AXIS_TO_MISSING_CODE = Object.freeze({
  [RESEARCH_AXES.CAPABILITY]: SEMANTIC_CODES.AXIS_CAPABILITY_NOT_RESEARCHED,
  [RESEARCH_AXES.JOURNEY]: SEMANTIC_CODES.AXIS_JOURNEY_NOT_RESEARCHED,
  [RESEARCH_AXES.BUSINESS_RULE]: SEMANTIC_CODES.AXIS_BUSINESS_RULE_NOT_RESEARCHED,
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normaliza um termo para comparação: caixa, acentos, pontuação e espaços.
 * Determinístico e sem dependência de locale do sistema operacional.
 */
function normalizeTerm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value) {
  const normalized = normalizeTerm(value);
  return normalized ? normalized.split(' ') : [];
}

/** Tenant canônico da pesquisa competitiva: SEMPRE SYSTEM/INTERNAL (TAREFA 30). */
function canonicalResearchTenant(tenantId) {
  const normalized = normalizeTerm(tenantId);
  return SYSTEM_TENANT_ALIASES.includes(normalized) ? 'system' : null;
}

function assertSystemTenant(tenantId) {
  const canonical = canonicalResearchTenant(tenantId);
  if (!canonical) {
    const error = new Error(`${SEMANTIC_CODES.SYSTEM_TENANT_REQUIRED}: ${tenantId}`);
    error.code = SEMANTIC_CODES.SYSTEM_TENANT_REQUIRED;
    throw error;
  }
  return canonical;
}

/**
 * O nome do fornecedor é o SUJEITO da pesquisa, nunca um achado (§TAREFA 03).
 *
 * Casa quando o candidato é EXATAMENTE o nome/alias do benchmark, ou quando os
 * tokens do candidato são um subconjunto dos tokens do sujeito (ex.: "W12" para
 * "EVO (W12 / ABC Evo)"). Um termo de capacidade real ("congelamento de
 * matrícula") não é subconjunto de nenhum nome de fornecedor.
 */
function isSubjectNameFinding({ candidate, benchmark } = {}) {
  if (!isNonEmptyString(candidate) || !benchmark) return false;
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return false;

  const subjectNames = [benchmark.name, benchmark.id, ...(Array.isArray(benchmark.aliases) ? benchmark.aliases : [])]
    .filter(isNonEmptyString);
  for (const name of subjectNames) {
    const subjectTokens = tokenize(name);
    if (subjectTokens.length === 0) continue;
    if (normalizeTerm(name) === normalizeTerm(candidate)) return true;
    if (candidateTokens.length <= 3 && candidateTokens.every((token) => subjectTokens.includes(token))) return true;
  }
  return false;
}

/** Eixo de um `kind`; `null` para kind desconhecido (o serviço recusa). */
function axisForKind(kind) {
  return KIND_TO_AXIS[String(kind || '')] || null;
}

/** `kind` de um eixo; `null` para eixo desconhecido. */
function kindForAxis(axis) {
  return AXIS_TO_KIND[String(axis || '')] || null;
}

/** Um eixo só conta como PESQUISADO quando a pesquisa de fato terminou. */
function isResearchedAxisState(state) {
  return RESEARCHED_AXIS_STATES.includes(String(state || ''));
}

/**
 * Completude dos três eixos. `missing` é a lista NOMINAL do que não foi
 * pesquisado — nunca um booleano solto (o motivo precisa ser auditável).
 */
function buildAxisCompleteness({ axes } = {}) {
  const source = axes && typeof axes === 'object' ? axes : {};
  const present = [];
  const missing = [];
  const blocked = [];
  const notResearched = [];

  for (const axis of RESEARCH_AXIS_LIST) {
    const state = String(source[axis] || AXIS_STATES.NOT_RESEARCHED);
    if (isResearchedAxisState(state)) {
      present.push(axis);
      continue;
    }
    missing.push(axis);
    if (state === AXIS_STATES.BLOCKED) blocked.push(axis);
    if (state === AXIS_STATES.NOT_RESEARCHED) notResearched.push(axis);
  }

  return {
    complete: missing.length === 0,
    present,
    missing,
    blocked,
    notResearched,
    axes: RESEARCH_AXIS_LIST.map((axis) => ({
      axis,
      state: String(source[axis] || AXIS_STATES.NOT_RESEARCHED),
      researched: isResearchedAxisState(source[axis]),
    })),
  };
}

/**
 * Normalização de um nome observado → identidade canônica INTERNA.
 *
 * Longest-match-wins sobre os termos DECLARADOS (`config/benchmark-normalization.json`).
 * Nada de stemming, nada de aproximação: se um termo não casa exatamente com
 * um termo declarado, o resultado é `canonicalId: null` (novidade candidata) —
 * inventar equivalência infla saturação e apaga diferenças de produto.
 *
 * @returns {{normalized: string, canonicalId: string|null, matchedTerm: string|null, kind: string|null, tokens: string[], reason: string|null}}
 */
function normalizeFindingName({ externalName, kind = null } = {}) {
  const normalized = normalizeTerm(externalName);
  const tokens = tokenize(externalName);
  const base = { normalized, tokens, canonicalId: null, matchedTerm: null, kind: kind || null, reason: null };
  if (!normalized) return { ...base, reason: 'empty_name' };

  const candidates = [];
  for (const rule of Array.isArray(NORMALIZATION_POLICY.rules) ? NORMALIZATION_POLICY.rules : []) {
    if (kind && rule.kind && rule.kind !== kind) continue;
    for (const term of Array.isArray(rule.terms) ? rule.terms : []) {
      const normalizedTerm = normalizeTerm(term);
      if (!normalizedTerm) continue;
      // Casamento por FRASE INTEIRA: o termo declarado precisa aparecer como
      // sequência contígua de tokens do candidato.
      const termTokens = normalizedTerm.split(' ');
      const isContiguous = tokens.length >= termTokens.length && (() => {
        for (let start = 0; start <= tokens.length - termTokens.length; start += 1) {
          if (termTokens.every((token, offset) => tokens[start + offset] === token)) return true;
        }
        return false;
      })();
      if (!isContiguous) continue;
      candidates.push({
        canonicalId: rule.canonicalId,
        matchedTerm: normalizedTerm,
        // Longest-match-wins: "scheduled cancel" vence "cancel".
        weight: termTokens.length,
        exclusiveTokens: Array.isArray(rule.exclusiveTokens) ? rule.exclusiveTokens.map(normalizeTerm) : [],
      });
    }
  }

  if (candidates.length === 0) return { ...base, reason: 'no_declared_equivalence' };

  const bestWeight = Math.max(...candidates.map((candidate) => candidate.weight));
  const best = candidates.filter((candidate) => candidate.weight === bestWeight);
  const distinctIds = [...new Set(best.map((candidate) => candidate.canonicalId))];
  if (distinctIds.length > 1) {
    // Dois canônicos DIFERENTES com o mesmo peso: fundir seria adivinhar.
    return { ...base, reason: SEMANTIC_CODES.OVER_MERGE_REFUSED };
  }

  const winner = best[0];
  return {
    ...base,
    canonicalId: winner.canonicalId,
    matchedTerm: winner.matchedTerm,
    reason: null,
  };
}

/**
 * Um achado é EXTERNAL_OBSERVED quando o provider de inspeção deu um locator
 * que existe na fonte analisada. Sem locator, o conteúdo é interpretação
 * interna (RAP_DERIVED) e não pode ser atribuído ao concorrente (TAREFA 18).
 */
function resolveFindingOrigin({ locator, origin } = {}) {
  if (String(origin || '') === FINDING_ORIGINS.RAP_DERIVED) return FINDING_ORIGINS.RAP_DERIVED;
  return isNonEmptyString(locator) ? FINDING_ORIGINS.EXTERNAL_OBSERVED : FINDING_ORIGINS.RAP_DERIVED;
}

/**
 * Critério de ANALYZED (TAREFA 20, revisado pela missão T-B1 de 2026-09-15).
 * `ANALYZED` significa "pesquisa suficiente", não "achei uma página" — e
 * TAMBÉM não significa "achei algo novo":
 *
 *   [x] source discovery concluído
 *   [x] documentation inspection concluída
 *   [x] API inspection concluída quando aplicável — `apiApplicable === false`
 *       exige JUSTIFICATIVA explícita (documentada), nunca omissão
 *   [x] eixo de capability pesquisado
 *   [x] eixo de jornada pesquisado
 *   [x] eixo de regra de negócio pesquisado
 *   [x] evidence validity gate passou (hash + locator, casando com o conteúdo)
 *   [x] nenhum erro crítico de pesquisa em aberto
 *   [x] completude registrada
 *
 * ZERO ACHADOS é um resultado legítimo: com os três eixos em
 * `RESEARCHED_NO_FINDINGS`, inspeção executada e evidência válida persistida,
 * o benchmark É analisado com novidade medida igual a zero. O que continua
 * proibido é o atalho: `NO_VERIFIED_FINDING` só bloqueia quando os eixos NÃO
 * estão completamente pesquisados ou a evidência está ausente/inválida — ou
 * seja, ele nunca é o ÚNICO motivo de recusa de uma pesquisa suficiente.
 *
 * @returns {{satisfied: boolean, missing: string[], detail: object}}
 */
function evaluateAnalyzedCriterion({
  benchmark = null,
  inspections = {},
  axes = {},
  findings = [],
  evidence = [],
  errors = [],
  sourceDiscovery = null,
} = {}) {
  const missing = [];
  const verifiedFindings = (Array.isArray(findings) ? findings : []).filter((finding) => finding?.verified === true);
  const validEvidence = (Array.isArray(evidence) ? evidence : []).filter((row) => row && row.verified !== false);

  // Source discovery: um benchmark sem fonte inspecionável não foi pesquisado.
  const discovered = typeof sourceDiscovery === 'boolean'
    ? sourceDiscovery
    : (Array.isArray(sourceDiscovery) ? sourceDiscovery.length > 0 : true);
  if (!discovered) missing.push(SEMANTIC_CODES.INSPECTION_DOCUMENTATION_MISSING);

  if (inspections?.documentation !== true) missing.push(SEMANTIC_CODES.INSPECTION_DOCUMENTATION_MISSING);
  // API é obrigatória por padrão; `apiApplicable === false` precisa ser uma
  // declaração EXPLÍCITA e JUSTIFICADA do plano (documentada), nunca uma
  // omissão. Sem rationale, "não aplicável" é indistinguível de "não olhei".
  const apiRequired = benchmark?.apiApplicable !== false && inspections?.apiApplicable !== false;
  if (apiRequired && inspections?.api !== true) {
    missing.push(SEMANTIC_CODES.INSPECTION_API_MISSING);
  } else if (!apiRequired) {
    const rationale = inspections?.apiNotApplicableRationale || benchmark?.apiNotApplicableRationale;
    if (!isNonEmptyString(rationale)) missing.push(SEMANTIC_CODES.API_NOT_APPLICABLE_UNJUSTIFIED);
  }

  const completeness = buildAxisCompleteness({ axes });
  for (const axis of completeness.missing) {
    const state = axes?.[axis];
    missing.push(state === AXIS_STATES.BLOCKED ? SEMANTIC_CODES.AXIS_BLOCKED : AXIS_TO_MISSING_CODE[axis]);
  }

  if (validEvidence.length === 0) missing.push(SEMANTIC_CODES.NO_VALID_EVIDENCE);
  const evidenceHasHash = validEvidence.length > 0
    && validEvidence.some((row) => isNonEmptyString(row.contentHash || row.content_hash));
  if (validEvidence.length > 0 && !evidenceHasHash) {
    missing.push(SEMANTIC_CODES.EVIDENCE_HASH_MISSING);
  }
  const evidenceHasLocator = validEvidence.length > 0
    && validEvidence.some((row) => isNonEmptyString(row.locator));
  if (validEvidence.length > 0 && !evidenceHasLocator) {
    missing.push(SEMANTIC_CODES.EVIDENCE_LOCATOR_MISSING);
  }

  // T-B1 — ZERO ACHADOS não é bloqueio absoluto: `RESEARCHED_NO_FINDINGS` nos
  // três eixos + inspeção executada + evidência válida É análise ("pesquisei e
  // nada era novo" é medição, não ausência de trabalho). O bloqueio só existe
  // quando a ausência de achado convive com pesquisa INCOMPLETA ou evidência
  // inválida — nesses casos o código acompanha o bloqueio específico.
  const evidenceValid = validEvidence.length > 0 && evidenceHasHash && evidenceHasLocator;
  if (verifiedFindings.length === 0 && (!completeness.complete || !evidenceValid)) {
    missing.push(SEMANTIC_CODES.NO_VERIFIED_FINDING);
  }

  const criticalErrors = (Array.isArray(errors) ? errors : [])
    .filter((error) => error && error.severity !== 'INFO' && error.resolved !== true);
  if (criticalErrors.length > 0) missing.push(SEMANTIC_CODES.RESEARCH_ERROR_UNRESOLVED);

  const unique = [...new Set(missing)];
  return {
    satisfied: unique.length === 0,
    missing: unique,
    detail: {
      verifiedFindings: verifiedFindings.length,
      validEvidence: validEvidence.length,
      axisCompleteness: completeness,
      criticalErrors: criticalErrors.length,
    },
  };
}

module.exports = {
  NORMALIZATION_POLICY,
  RESEARCH_AXES,
  RESEARCH_AXIS_LIST,
  RESEARCHED_AXIS_STATES,
  AXIS_STATES,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  SYSTEM_TENANT_ALIASES,
  KIND_TO_AXIS,
  AXIS_TO_KIND,
  normalizeTerm,
  tokenize,
  canonicalResearchTenant,
  assertSystemTenant,
  isSubjectNameFinding,
  axisForKind,
  kindForAxis,
  isResearchedAxisState,
  buildAxisCompleteness,
  normalizeFindingName,
  resolveFindingOrigin,
  evaluateAnalyzedCriterion,
};
