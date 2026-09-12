'use strict';

/**
 * Ask AI Tool Catalog — DECLARAÇÃO CANÔNICA das capabilities operacionais
 * consumidas pelo copiloto.
 *
 * CONTEXTO DO GAP (auditoria 2026-09-11): o "Perguntar à IA" mantinha
 * `api/services/askAi/toolRegistry.js` como um UNIVERSO INDEPENDENTE de tools —
 * definia ids, capabilities, permissões e políticas próprias, sem relação com o
 * Canonical Tool Registry usado pelo Cognitive Core, pelo MCP Server e pelo
 * Process Runtime. Resultado: a mesma capability podia existir duas vezes, com
 * políticas divergentes, e uma tool externa (MCP) nunca era considerada pelo
 * copiloto.
 *
 * Este catálogo é a DEFINIÇÃO ÚNICA. Ele é registrado no Canonical Tool
 * Registry (via `canonicalToolBridge`) e o Ask AI passa a enxergar apenas uma
 * PROJEÇÃO desse registry:
 *
 *   Ask AI → capability (ex.: `crm.read`)
 *     → Canonical Tool Registry
 *       → provider nativo (`askai.*`)
 *       → provider externo (`mcp.*` de uma conexão MCP governada)
 *
 * O copiloto NUNCA escolhe provider, endpoint ou host.
 *
 * Regras invariantes:
 *  - Todas as capabilities deste catálogo são READ-ONLY (`sideEffects: false`).
 *    Não existe entrada de mutação no catálogo do copiloto.
 *  - `rbac` é o RBAC de produto usado pela política do Ask AI
 *    (`hasPermission`); `permissions` é a permissão canônica exigida pelo
 *    Canonical Tool Registry. Ambos apontam para o MESMO direito.
 *  - O `id` canônico tem prefixo `askai.` (namespace do copiloto) e os ids
 *    legados ficam em `aliases` para compatibilidade de contrato.
 */

const ASK_AI_TOOLS = Object.freeze([
  Object.freeze({
    id: 'askai.fitness.membershipSummary',
    aliases: Object.freeze(['getFitnessStudentSummary']),
    capability: 'crm.read',
    kind: 'membership',
    label: 'Situação da matrícula',
    description: 'Matrícula, status financeiro efetivo e situação de acesso do aluno.',
    rbac: Object.freeze({ resource: 'crm', action: 'read' }),
    permissions: Object.freeze(['crm.read']),
    entityTypes: Object.freeze(['FITNESS_STUDENT', 'CUSTOMER']),
    entityIdField: 'id',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    executionMode: 'atomic',
    runner: 'fitnessStudentSummary',
  }),
  Object.freeze({
    id: 'askai.fitness.attendanceSummary',
    aliases: Object.freeze(['getAttendanceSummary']),
    capability: 'attendance.read',
    kind: 'attendance',
    label: 'Frequência',
    description: 'Última visita, frequência em 7 e 30 dias.',
    rbac: Object.freeze({ resource: 'crm', action: 'read' }),
    permissions: Object.freeze(['crm.read']),
    entityTypes: Object.freeze(['FITNESS_STUDENT', 'CUSTOMER']),
    entityIdField: 'id',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    executionMode: 'atomic',
    runner: 'fitnessAttendanceSummary',
  }),
  Object.freeze({
    id: 'askai.billing.membershipHistory',
    aliases: Object.freeze(['getBillingSummary']),
    capability: 'billing.read',
    kind: 'billing',
    label: 'Histórico financeiro',
    description: 'Eventos de cobrança da matrícula.',
    // Dado financeiro exige o teto de visibilidade financeira do RBAC
    // (`reports:read`). Um operador que só tem `crm:read` vê o aluno mas não
    // o financeiro — exatamente o cenário de field-level restriction.
    rbac: Object.freeze({ resource: 'reports', action: 'read' }),
    permissions: Object.freeze(['reports.read']),
    entityTypes: Object.freeze(['FITNESS_STUDENT', 'CUSTOMER', 'ORDER']),
    entityIdField: 'id',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    executionMode: 'atomic',
    runner: 'fitnessBillingSummary',
  }),
  Object.freeze({
    id: 'askai.churn.latestSignal',
    aliases: Object.freeze(['getChurnSignals']),
    capability: 'churn.read',
    kind: 'churn',
    label: 'Sinais de risco',
    description: 'Sinais de risco de churn modelados para o aluno.',
    rbac: Object.freeze({ resource: 'crm', action: 'read' }),
    permissions: Object.freeze(['crm.read']),
    entityTypes: Object.freeze(['FITNESS_STUDENT', 'CUSTOMER']),
    entityIdField: 'id',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    executionMode: 'atomic',
    runner: 'fitnessChurnSignal',
  }),
]);

/** Vocabulário fechado de entidades aceitas pelo contrato de contexto. */
const ENTITY = Object.freeze({
  FITNESS_STUDENT: 'FITNESS_STUDENT',
  CUSTOMER: 'CUSTOMER',
  CASE: 'CASE',
  CONVERSATION: 'CONVERSATION',
  CAMPAIGN: 'CAMPAIGN',
  TICKET: 'TICKET',
  ORDER: 'ORDER',
  BOOKING: 'BOOKING',
});

/** Vocabulário fechado de tipos de tool (usado pela orquestração). */
const TOOL_KINDS = Object.freeze({
  MEMBERSHIP: 'membership',
  ATTENDANCE: 'attendance',
  BILLING: 'billing',
  CHURN: 'churn',
  WORKSPACE_TIMELINE: 'workspace_timeline',
});

/** Provider nativo das tools declaradas neste catálogo. */
const NATIVE_PROVIDER = 'native';

const ASK_AI_TOOL_IDS = Object.freeze(ASK_AI_TOOLS.map((tool) => tool.id));

/** Resolve uma entrada do catálogo por id canônico ou alias legado. */
function findAskAiTool(id) {
  const value = String(id || '');
  return ASK_AI_TOOLS.find((tool) => tool.id === value || tool.aliases.includes(value)) || null;
}

/** Entradas do catálogo para uma capability canônica. */
function findAskAiToolsByCapability(capability) {
  const value = String(capability || '');
  return ASK_AI_TOOLS.filter((tool) => tool.capability === value);
}

module.exports = {
  ASK_AI_TOOLS,
  ASK_AI_TOOL_IDS,
  ENTITY,
  TOOL_KINDS,
  NATIVE_PROVIDER,
  findAskAiTool,
  findAskAiToolsByCapability,
};
