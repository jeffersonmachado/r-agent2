'use strict';

/**
 * engine/engineeringMission/enrichmentBuilder.js — o Mission Enricher determinístico.
 *
 * O texto livre da missão NÃO é a fonte de verdade do enriquecimento: cada requisito derivado
 * nasce de uma REGRA DECLARATIVA aplicada a FATOS DE CONTEXTO coletados do repositório/banco/
 * políticas. Isso torna o enriquecimento auditável (`source` + `reason` + `confidence`) e
 * determinístico — a mesma missão com os mesmos fatos produz o mesmo conjunto de requisitos,
 * o que é pré-requisito de idempotência e de replay.
 *
 * Um LLM pode participar da INTENÇÃO (tipo/objetivo/ambiguidade) via `intent`, mas nunca inventa
 * fatos: fatos vêm do coletor de contexto. Quando o modelo propõe algo, isso entra como
 * `MODEL_ENRICHMENT`/`INFERRED` com confiança declarada e revisável — jamais como fato.
 *
 * Módulo puro (sem I/O).
 */

const {
  MISSION_TYPES,
  ENRICHMENT_SOURCES,
} = require('./constants');

const ENRICHMENT_POLICY_VERSION = '1.0.0';

const RISK_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

/**
 * Regras declarativas de enriquecimento. Cada regra:
 *   id            — estável (entra no id do requisito derivado → determinismo/idempotência)
 *   when(facts)   — condição sobre fatos reais
 *   kind          — 'DERIVED' (inferido do contexto) | 'POLICY_REQUIRED' (obrigatório por política)
 *   source        — política/artefato que obriga (auditável)
 *   reason        — justificativa objetiva exibível (§8: nunca raciocínio interno de modelo)
 *   riskImpact    — LOW|MEDIUM|HIGH|CRITICAL
 *   requirement   — requisito derivado (aceitação) adicionado ao escopo
 *   testHint      — teste/validação exigida por esta regra
 *   blocksAutoApproval — quando verdadeiro, a presença desta regra impede autoaprovação (§11)
 */
const ENRICHMENT_RULES = Object.freeze([
  {
    id: 'TENANT_ISOLATION',
    when: (f) => f.touchesMultiTenant === true,
    kind: 'POLICY_REQUIRED',
    source: 'TENANCY_POLICY',
    reason: 'o subsistema afetado é multi-tenant — isolamento entre tenants é invariante de plataforma',
    riskImpact: 'HIGH',
    requirement: 'validar isolamento de tenant em todos os caminhos alterados (nenhum dado cruza tenant)',
    testHint: 'teste de isolamento de tenant (leitura/escrita cruzada deve falhar)',
    blocksAutoApproval: true,
  },
  {
    id: 'DATABASE_MIGRATION',
    when: (f) => f.touchesSchema === true || f.touchesDatabase === true,
    kind: 'DERIVED',
    source: 'DATABASE_POLICY',
    reason: 'a mudança toca persistência/schema — migration versionada é o único caminho suportado',
    riskImpact: 'HIGH',
    requirement: 'incluir migration idempotente e reversível para toda alteração de schema',
    testHint: 'validação do schema contra Postgres real (tier estático + live)',
    blocksAutoApproval: false,
  },
  {
    id: 'INCOMPATIBLE_SCHEMA_SAFETY',
    when: (f) => f.touchesSchema === true && f.incompatibleSchemaChange === true,
    kind: 'POLICY_REQUIRED',
    source: 'DATABASE_POLICY',
    reason: 'mudança de schema incompatível exige estratégia segura (expand/contract) antes de aplicar',
    riskImpact: 'CRITICAL',
    requirement: 'aplicar estratégia expand/contract (nunca alteração incompatível direta) com rollback verificado',
    testHint: 'teste de migração com dados pré-existentes + rollback real',
    blocksAutoApproval: true,
  },
  {
    id: 'SECRET_HYGIENE',
    when: (f) => f.touchesSecrets === true || f.touchesCredentials === true,
    kind: 'POLICY_REQUIRED',
    source: 'SECURITY_POLICY',
    reason: 'a mudança toca credenciais/segredos — nenhum segredo pode ser versionado, logado ou empacotado',
    riskImpact: 'CRITICAL',
    requirement: 'provar ausência de segredo em código, fixture, log, resposta de API e artefato de release',
    testHint: 'teste de redação/varredura de segredo no diff e no artefato',
    blocksAutoApproval: true,
  },
  {
    id: 'RBAC_AND_CLASSIFICATION',
    when: (f) => f.touchesAuth === true || f.touchesRbac === true,
    kind: 'POLICY_REQUIRED',
    source: 'SECURITY_POLICY',
    reason: 'a mudança toca autorização — enforcement server-side é obrigatório e não pode ser relaxado',
    riskImpact: 'CRITICAL',
    requirement: 'manter/estender enforcement de autorização e classificação server-side (403/401 testados)',
    testHint: 'teste de negação real (anônimo, papel insuficiente, classificação insuficiente)',
    blocksAutoApproval: true,
  },
  {
    id: 'VISIBILITY_SEGREGATION',
    when: (f) => f.touchesFrontend === true,
    kind: 'POLICY_REQUIRED',
    source: 'VISIBILITY_POLICY',
    reason: 'superfícies PRODUCTION/SUPPORT/DEVELOPMENT têm segregação obrigatória; código de engenharia nunca vaza para PRODUCTION',
    riskImpact: 'HIGH',
    requirement: 'garantir que nenhuma superfície DEVELOPMENT/SUPPORT apareça em PRODUCTION (menu, rota e API)',
    testHint: 'validação de segregação de experiência (menu + acesso direto por URL + API)',
    blocksAutoApproval: false,
  },
  {
    id: 'REGRESSION_AND_RELEASE_GATES',
    when: (f) => f.isReleaseBlocker === true || f.touchesRelease === true,
    kind: 'DERIVED',
    source: 'RELEASE_POLICY',
    reason: 'a mudança é bloqueador de release — os gates de governança são a autoridade final, não o julgamento do agente',
    riskImpact: 'HIGH',
    requirement: 'executar e anexar evidência dos gates de governança aplicáveis antes de declarar conclusão',
    testHint: 'regressão completa + validação de artefato de release',
    blocksAutoApproval: false,
  },
  {
    id: 'DEPLOYMENT_LOCAL_BUILD',
    when: (f) => f.touchesDeployment === true,
    kind: 'DERIVED',
    source: 'ARCHITECTURE_POLICY',
    reason: 'imagens Docker são construídas localmente/CI e transferidas; build no host de produção é proibido',
    riskImpact: 'MEDIUM',
    requirement: 'garantir que o pipeline de deploy não executa build no host de produção',
    testHint: 'validação do caminho de deploy (dry-run) sem build remoto',
    blocksAutoApproval: false,
  },
  {
    id: 'PERFORMANCE_REGRESSION',
    when: (f) => f.touchesPerformanceSensitive === true,
    kind: 'DERIVED',
    source: 'QA_POLICY',
    reason: 'a área alterada é sensível a latência/throughput — regressão de performance precisa ser medida, não presumida',
    riskImpact: 'MEDIUM',
    requirement: 'medir latência/throughput antes e depois na mesma carga',
    testHint: 'medição comparativa com a mesma carga',
    blocksAutoApproval: false,
  },
  {
    id: 'DESTRUCTIVE_OPERATION_GUARD',
    when: (f) => f.destructiveOperation === true || f.irreversible === true,
    kind: 'POLICY_REQUIRED',
    source: 'RELEASE_POLICY',
    reason: 'a missão descreve operação destrutiva/irreversível — exige caminho de rollback verificado',
    riskImpact: 'CRITICAL',
    requirement: 'provar rollback/reversibilidade antes de qualquer execução destrutiva',
    testHint: 'teste de rollback real a partir de estado intermediário',
    blocksAutoApproval: true,
  },
  {
    id: 'PRODUCTION_DESTRUCTIVE_OPERATION',
    when: (f) => f.destructiveOperation === true && f.targetsProduction === true,
    kind: 'POLICY_REQUIRED',
    source: 'RELEASE_POLICY',
    reason: 'operação destrutiva contra produção nunca é autoaprovada',
    riskImpact: 'CRITICAL',
    requirement: 'exigir aprovação humana explícita para qualquer operação destrutiva em produção',
    testHint: 'teste de bloqueio de autoaprovação para operação destrutiva em produção',
    blocksAutoApproval: true,
  },
  {
    id: 'ENGINEERING_MEMORY_REUSE',
    when: (f) => Number(f.previousOccurrences) > 0,
    kind: 'INFERRED',
    source: 'ENGINEERING_MEMORY',
    reason: 'este problema já foi detectado antes nesta plataforma — reusar o diagnóstico/correção anteriores em vez de recomeçar do zero',
    riskImpact: 'MEDIUM',
    requirement: 'consultar e citar a correção anterior registrada na Engineering Memory antes de propor novo fix',
    testHint: 'teste de regressão do caso original (não pode reabrir)',
    blocksAutoApproval: false,
  },
]);

/** Estratégia de teste derivada do tipo de missão e dos fatos. */
const TEST_STRATEGY_BY_TYPE = Object.freeze({
  BUG_FIX: ['unit', 'integration', 'regression'],
  FEATURE: ['unit', 'integration', 'e2e'],
  ARCHITECTURE: ['unit', 'integration', 'architecture_invariants'],
  REFACTOR: ['unit', 'regression'],
  SECURITY: ['unit', 'security', 'adversarial'],
  DATABASE: ['unit', 'database', 'migration'],
  PERFORMANCE: ['unit', 'performance'],
  INTEGRATION: ['unit', 'integration', 'e2e'],
  MIGRATION: ['unit', 'migration', 'database'],
  RELEASE: ['regression', 'release_validation'],
  INVESTIGATION: ['unit'],
  TECH_DEBT: ['unit', 'regression'],
  QA_HARDENING: ['unit', 'regression', 'adversarial'],
});

/**
 * Ordem = PRIORIDADE. Correção (`BUG_FIX`) precede criação (`FEATURE`) porque "corrija X e
 * adicione testes" é uma correção; risco/segurança precedem ambos. O resultado é sempre um HINT
 * revisável no preview — nunca uma decisão oculta.
 */
const TYPE_KEYWORDS = Object.freeze([
  { type: 'SECURITY', re: /\b(vulnerabilidad\w*|seguran[çc]a|security|secret|credencial|rbac|exploit|inje[çc][ãa]o)\b/i },
  { type: 'PERFORMANCE', re: /\b(lentid[ãa]o|performance|lat[êe]ncia|throughput|gargalo)\b/i },
  { type: 'MIGRATION', re: /\b(migrar|migration|migra[çc][ãa]o)\b/i },
  { type: 'DATABASE', re: /\b(banco|database|schema|tabela|postgres|[íi]ndice|index)\b/i },
  { type: 'RELEASE', re: /\b(release|deploy|publica[çc][ãa]o|selagem|promo[çc][ãa]o)\b/i },
  { type: 'QA_HARDENING', re: /\b(qa|wave|mesh|cobertura|coverage|regress[ãa]o|flaky)\b/i },
  { type: 'REFACTOR', re: /\b(refactor|refatorar|reorganizar|limpeza|d[íi]vida t[ée]cnica)\b/i },
  { type: 'BUG_FIX', re: /\b(corrija|corrigir|consertar|fix|bug|defeito|falha|erro|quebrad\w*|n[ãa]o funciona)\b/i },
  { type: 'FEATURE', re: /\b(implemente|implementar|adicion\w+|crie|criar|inclu\w+|nova funcionalidade|feature|suporte a)\b/i },
  { type: 'ARCHITECTURE', re: /\b(arquitetura|architecture|camada|layer|acoplamento|design)\b/i },
  { type: 'INVESTIGATION', re: /\b(investigar|analisar|diagnosticar|descobrir causa|por que)\b/i },
]);

const CONTRADICTION_PATTERNS = Object.freeze([
  { re: /\b(sem|nenhuma|não)\s+(migration|migra[çc][ãa]o)\b/i, fact: 'touchesSchema', reason: 'missão pede explicitamente nenhuma migration, mas a mudança toca schema' },
  { re: /\b(sem|nenhum|não)\s+(teste|testes|test)\b/i, fact: null, reason: 'missão pede explicitamente nenhum teste — gates determinísticos não são negociáveis' },
  { re: /\b(não|nao)\s+(alterar|mexer)\s+(no\s+)?banco\b/i, fact: 'touchesDatabase', reason: 'missão proíbe alterar banco, mas a mudança toca persistência' },
  { re: /\b(remover|desligar|desativar)\s+(auth|autentica[çc][ãa]o|autoriza[çc][ãa]o|rbac)\b/i, fact: 'touchesAuth', reason: 'missão pede remover autenticação/autorização — proibido por política' },
]);

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function inferMissionType(originalMission, contextFacts = {}) {
  for (const { type, re } of TYPE_KEYWORDS) {
    if (re.test(originalMission)) return { missionType: type, inferred: true };
  }
  if (contextFacts.isReleaseBlocker) return { missionType: 'RELEASE', inferred: true };
  return { missionType: 'INVESTIGATION', inferred: true };
}

function detectAmbiguity(originalMission, contextFacts = {}) {
  const flags = [];
  const text = String(originalMission || '').trim();
  if (text.length < 15) flags.push('MISSION_TEXT_TOO_SHORT');
  if (!/[a-zà-ú]{3,}/i.test(text)) flags.push('MISSION_TEXT_UNREADABLE');
  const genericOnly = /^(melhore|melhorar|arrume|conserte|fa[çc]a)\s+(o|a|os|as)?\s*\w*\.?$/i.test(text);
  if (genericOnly) flags.push('GENERIC_SCOPE_STATEMENT');
  if (contextFacts.evidenceRefs && contextFacts.evidenceRefs.length === 0) flags.push('NO_CONTEXT_EVIDENCE');
  const material = flags.some((f) => ['MISSION_TEXT_TOO_SHORT', 'MISSION_TEXT_UNREADABLE', 'GENERIC_SCOPE_STATEMENT'].includes(f));
  return { flags, material };
}

function detectContradictions(originalMission, contextFacts = {}) {
  const found = [];
  for (const { re, fact, reason } of CONTRADICTION_PATTERNS) {
    if (!re.test(originalMission)) continue;
    if (fact && contextFacts[fact] !== true) continue;
    found.push({ reason, source: 'USER_INPUT' });
  }
  return found;
}

/**
 * Confiança do enriquecimento: quanto de fato observável sustenta a interpretação.
 * Nunca é um número decorativo — cada parcela tem origem declarada.
 */
function computeConfidence({ originalMission, contextFacts = {}, ambiguity, contradictions, rulesApplied }) {
  const evidenceRefs = Array.isArray(contextFacts.evidenceRefs) ? contextFacts.evidenceRefs : [];
  let score = 0.4;
  score += Math.min(0.3, evidenceRefs.length * 0.06); // contexto observado
  if (Array.isArray(contextFacts.subsystems) && contextFacts.subsystems.length > 0) score += 0.1;
  if (Number(contextFacts.previousOccurrences) > 0) score += 0.1; // histórico conhecido
  score += Math.min(0.1, rulesApplied.length * 0.02); // política aplicada
  if (ambiguity.material) score -= 0.3;
  if (contradictions.length > 0) score -= 0.25;
  if (String(originalMission || '').trim().length < 15) score -= 0.15;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function computeRisk({ contextFacts = {}, rulesApplied, missionType }) {
  let rank = 0;
  const escalate = (r) => { rank = Math.max(rank, RISK_RANK[r]); };
  for (const rule of rulesApplied) escalate(rule.riskImpact);
  if (contextFacts.touchesMultiTenant) escalate('HIGH');
  if (contextFacts.touchesSchema || contextFacts.touchesDatabase) escalate('HIGH');
  if (contextFacts.touchesAuth || contextFacts.touchesRbac) escalate('CRITICAL');
  if (contextFacts.touchesSecrets || contextFacts.touchesCredentials) escalate('CRITICAL');
  if (contextFacts.destructiveOperation || contextFacts.irreversible) escalate('CRITICAL');
  if (contextFacts.targetsProduction) escalate('HIGH');
  if (missionType === 'SECURITY') escalate('HIGH');
  if (missionType === 'RELEASE') escalate('HIGH');
  if (Array.isArray(contextFacts.subsystems) && contextFacts.subsystems.length >= 3) escalate('MEDIUM');
  const names = Object.keys(RISK_RANK);
  return names[rank];
}

/**
 * Constrói o enriquecimento completo a partir de fatos. Determinístico e idempotente.
 *
 * @param {Object} params
 * @param {string} params.missionId
 * @param {string} params.originalMission
 * @param {Object} [params.intent] — proposta do modelo (tipo/objetivo/subsistemas), sempre revisável
 * @param {Object} [params.contextFacts]
 * @param {Object} [params.memory]
 */
function buildEnrichment({ missionId, originalMission, intent = {}, contextFacts = {}, memory = {} }) {
  if (!missionId) throw new Error('enrichmentBuilder: missionId é obrigatório');
  if (!originalMission || !String(originalMission).trim()) throw new Error('enrichmentBuilder: originalMission é obrigatória');

  const facts = {
    ...contextFacts,
    previousOccurrences: Number(memory.previousOccurrences || contextFacts.previousOccurrences || 0),
  };

  const rulesApplied = ENRICHMENT_RULES.filter((r) => {
    try { return r.when(facts) === true; } catch { return false; }
  });

  const inferredType = inferMissionType(originalMission, facts);
  const missionType = (intent.missionType && MISSION_TYPES.includes(intent.missionType)) ? intent.missionType : inferredType.missionType;

  const ambiguity = detectAmbiguity(originalMission, facts);
  const contradictions = detectContradictions(originalMission, facts);

  const derivedRequirements = [];
  const provenance = [];

  for (const rule of rulesApplied) {
    const reqId = `DR-${rule.id}`;
    derivedRequirements.push({
      id: reqId,
      text: rule.requirement,
      source: rule.source,
      enrichmentType: rule.kind === 'POLICY_REQUIRED' ? 'POLICY_REQUIRED' : 'INFERRED',
      confidence: 1,
      riskImpact: rule.riskImpact,
      ruleId: rule.id,
      blocksAutoApproval: rule.blocksAutoApproval === true,
    });
    provenance.push({
      field: 'derivedRequirements',
      originalValue: null,
      enrichedValue: rule.requirement,
      enrichmentType: rule.kind === 'POLICY_REQUIRED' ? 'POLICY_REQUIRED' : 'INFERRED',
      reason: rule.reason,
      source: rule.source,
      confidence: 1,
      riskImpact: rule.riskImpact,
      ruleId: rule.id,
    });
  }

  const testStrategy = [...new Set([
    ...(TEST_STRATEGY_BY_TYPE[missionType] || ['unit']),
    ...rulesApplied.map((r) => r.testHint).filter(Boolean),
  ])];

  const acceptanceCriteria = derivedRequirements.map((r) => ({
    id: r.id,
    text: r.text,
    source: r.source,
    enrichmentType: r.enrichmentType,
    confidence: 1,
    riskImpact: r.riskImpact,
  }));

  const assumptions = [
    { text: 'a conclusão é determinada por gates executáveis, nunca por julgamento de modelo', source: 'RELEASE_POLICY' },
  ];
  if (contradictions.length > 0) {
    assumptions.push({ text: 'existe contradição entre a intenção declarada e as políticas de plataforma — resolução humana obrigatória', source: 'ARCHITECTURE_POLICY' });
  }

  const contextSources = [...new Set([
    ...(Array.isArray(facts.contextSources) ? facts.contextSources : []),
    ...rulesApplied.map((r) => r.source),
  ])];

  const subsystems = [...new Set([
    ...(Array.isArray(contextFacts.subsystems) ? contextFacts.subsystems : []),
    ...(Array.isArray(intent.subsystems) ? intent.subsystems : []),
  ])].filter(Boolean);

  const confidence = computeConfidence({ originalMission, contextFacts: facts, ambiguity, contradictions, rulesApplied });
  const risk = computeRisk({ contextFacts: facts, rulesApplied, missionType });

  // Campos "MODIFIED" (propostos pelo modelo ou pelo coletor) também ganham provenance.
  if (intent.objective) {
    provenance.push({
      field: 'objective',
      originalValue: originalMission,
      enrichedValue: intent.objective,
      enrichmentType: 'MODIFIED',
      reason: 'objetivo operacional derivado da intenção original pelo Mission Compiler',
      source: intent.source === 'model' ? 'MODEL_ENRICHMENT' : 'REPOSITORY_INSPECTION',
      confidence: intent.confidence === undefined ? null : intent.confidence,
      riskImpact: 'LOW',
      ruleId: null,
    });
  }
  for (const s of subsystems) {
    if (Array.isArray(contextFacts.subsystems) && contextFacts.subsystems.includes(s)) continue;
    provenance.push({
      field: 'subsystems',
      originalValue: null,
      enrichedValue: s,
      enrichmentType: 'INFERRED',
      reason: 'subsistema identificado a partir da intenção (proposta de modelo, revisável)',
      source: 'MODEL_ENRICHMENT',
      confidence: intent.confidence === undefined ? null : intent.confidence,
      riskImpact: 'LOW',
      ruleId: null,
    });
  }

  return {
    enrichmentPolicyVersion: ENRICHMENT_POLICY_VERSION,
    missionType,
    missionTypeInferred: !(intent.missionType && MISSION_TYPES.includes(intent.missionType)),
    objective: intent.objective || originalMission,
    derivedRequirements,
    acceptanceCriteria,
    testStrategy,
    assumptions,
    contextSources,
    subsystems,
    risk,
    confidence,
    ambiguity,
    contradictions,
    provenance,
    rulesApplied: rulesApplied.map((r) => r.id),
    factsUsed: Object.keys(facts).filter((k) => facts[k] !== undefined && facts[k] !== null).sort(),
  };
}

module.exports = {
  ENRICHMENT_POLICY_VERSION,
  ENRICHMENT_RULES,
  TEST_STRATEGY_BY_TYPE,
  inferMissionType,
  detectAmbiguity,
  detectContradictions,
  computeConfidence,
  computeRisk,
  buildEnrichment,
  slug,
};
