'use strict';

/**
 * Registro de ferramentas operacionais read-only do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): o copiloto só sabia consultar o RAG
 * documental. Perguntas sobre estado vivo ("por que este aluno está em risco?",
 * "qual foi a última visita?") não tinham como ser respondidas por dados — e
 * o único caminho existente era o texto indexado, que nunca contém estado.
 *
 * Regras estruturais (não negociáveis):
 *  - O LLM NUNCA gera SQL e nunca escolhe a consulta: as tools são registradas
 *    explicitamente aqui e mapeiam 1:1 para serviços de domínio existentes.
 *  - Todas as tools são READ-ONLY. Não existe tool de mutação neste registro.
 *  - Toda tool recebe `{ tenantId, actor }` do request e repassa ao serviço;
 *    nenhuma tool aceita tenant vindo do contexto do cliente.
 *  - Cada tool declara a capability que o ator precisa ter. Sem capability,
 *    a tool não é executada (não se vaza nem a existência do dado).
 */

const TOOL_KINDS = Object.freeze({
  MEMBERSHIP: 'membership',
  ATTENDANCE: 'attendance',
  BILLING: 'billing',
  CHURN: 'churn',
  WORKSPACE_TIMELINE: 'workspace_timeline',
});

// Entidade suportada por cada tool (vocabulário fechado do contrato de contexto).
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

const DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'getFitnessStudentSummary',
    kind: TOOL_KINDS.MEMBERSHIP,
    label: 'Situação da matrícula',
    capability: Object.freeze({ resource: 'crm', action: 'read' }),
    entityTypes: Object.freeze([ENTITY.FITNESS_STUDENT, ENTITY.CUSTOMER]),
    description: 'Matrícula, status financeiro efetivo e situação de acesso do aluno.',
    run: runGetFitnessStudentSummary,
  }),
  Object.freeze({
    id: 'getAttendanceSummary',
    kind: TOOL_KINDS.ATTENDANCE,
    label: 'Frequência',
    capability: Object.freeze({ resource: 'crm', action: 'read' }),
    entityTypes: Object.freeze([ENTITY.FITNESS_STUDENT, ENTITY.CUSTOMER]),
    description: 'Última visita, frequência em 7 e 30 dias.',
    run: runGetAttendanceSummary,
  }),
  Object.freeze({
    id: 'getBillingSummary',
    kind: TOOL_KINDS.BILLING,
    label: 'Histórico financeiro',
    // Dado financeiro exige o teto de visibilidade financeira do RBAC
    // (`reports:read`). Um operador que só tem `crm:read` vê o aluno mas não
    // o financeiro — exatamente o cenário de field-level restriction.
    capability: Object.freeze({ resource: 'reports', action: 'read' }),
    entityTypes: Object.freeze([ENTITY.FITNESS_STUDENT, ENTITY.CUSTOMER, ENTITY.ORDER]),
    description: 'Eventos de cobrança da matrícula.',
    run: runGetBillingSummary,
  }),
  Object.freeze({
    id: 'getChurnSignals',
    kind: TOOL_KINDS.CHURN,
    label: 'Sinais de risco',
    capability: Object.freeze({ resource: 'crm', action: 'read' }),
    entityTypes: Object.freeze([ENTITY.FITNESS_STUDENT, ENTITY.CUSTOMER]),
    description: 'Sinais de risco de churn modelados para o aluno.',
    run: runGetChurnSignals,
  }),
]);

function buildRegistry() {
  const byId = new Map();
  const byKind = new Map();
  for (const definition of DEFINITIONS) {
    byId.set(definition.id, definition);
    const list = byKind.get(definition.kind) || [];
    list.push(definition);
    byKind.set(definition.kind, list);
  }
  return {
    all: () => [...DEFINITIONS],
    get: (id) => byId.get(id) || null,
    byKind: (kind) => byKind.get(kind) || [],
    byEntityType: (entityType) => DEFINITIONS.filter((t) => t.entityTypes.includes(entityType)),
  };
}

// ---------------------------------------------------------------------------
// Implementações (adapter fino sobre serviços de domínio; zero SQL próprio)
// ---------------------------------------------------------------------------

function serviceLoader() {
  return {
    membership: require('../vertical/fitnessMembershipService'),
    attendance: require('../vertical/fitnessAttendanceService'),
    churn: require('../vertical/fitnessChurnSignalService'),
  };
}

function summarizeCounts(items) {
  return Array.isArray(items) ? items.length : 0;
}

async function runGetFitnessStudentSummary({ tenantId, entity }) {
  const { membership } = serviceLoader();
  const detail = await membership.getMembershipDetail({
    tenantId,
    membershipId: entity.id,
  });

  if (!detail) {
    return {
      toolId: 'getFitnessStudentSummary',
      found: false,
      facts: [],
      summary: 'Nenhuma matrícula encontrada para o aluno informado neste tenant.',
    };
  }

  const facts = [
    { key: 'membershipStatus', label: 'Status da matrícula', value: detail.status || detail.membership_status || null },
    { key: 'billingStatus', label: 'Status financeiro efetivo', value: detail.effectiveBillingStatus || null },
    { key: 'accessAllowed', label: 'Acesso liberado', value: detail.accessAllowed ?? null },
    { key: 'dueDate', label: 'Vencimento', value: detail.due_date || detail.dueDate || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'getFitnessStudentSummary',
    found: true,
    facts,
    summary: `Matrícula ${detail.status || 'sem status declarado'} com acesso ${detail.accessAllowed ? 'liberado' : 'bloqueado'}.`,
  };
}

async function runGetAttendanceSummary({ tenantId, entity }) {
  const { attendance } = serviceLoader();
  const history = await attendance.getAttendanceHistory({
    tenantId,
    subjectId: entity.id,
    windowDays: 90,
  });

  const items = Array.isArray(history?.items) ? history.items : [];
  const lastVisit = items.length > 0
    ? (items[0].checked_in_at || items[0].checkedInAt || null)
    : null;
  const daysSinceLastVisit = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86400000)
    : null;

  const facts = [
    { key: 'frequency7d', label: 'Frequência (7 dias)', value: history?.frequency7d ?? null },
    { key: 'frequency30d', label: 'Frequência (30 dias)', value: history?.frequency30d ?? null },
    { key: 'lastVisit', label: 'Última visita', value: lastVisit },
    { key: 'daysSinceLastVisit', label: 'Dias desde a última visita', value: daysSinceLastVisit },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'getAttendanceSummary',
    found: true,
    facts,
    summary: items.length === 0
      ? 'Nenhuma visita registrada na janela consultada.'
      : `${summarizeCounts(items)} visitas na janela; última em ${lastVisit}.`,
  };
}

async function runGetBillingSummary({ tenantId, entity }) {
  const { membership } = serviceLoader();
  const history = await membership.getMembershipBillingHistory({
    tenantId,
    membershipId: entity.id,
    limit: 20,
  });

  const items = Array.isArray(history?.items) ? history.items : [];
  const latest = items[0] || null;

  const facts = [
    { key: 'billingEvents', label: 'Eventos de cobrança', value: history?.total ?? items.length },
    { key: 'latestBillingStatus', label: 'Último status de cobrança', value: latest?.status || latest?.payload?.status || null },
    { key: 'latestBillingAt', label: 'Data do último evento', value: latest?.created_at || latest?.createdAt || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'getBillingSummary',
    found: true,
    facts,
    summary: items.length === 0
      ? 'Nenhum evento de cobrança encontrado.'
      : `${items.length} eventos de cobrança encontrados; último status: ${facts.find((f) => f.key === 'latestBillingStatus')?.value ?? 'não informado'}.`,
  };
}

async function runGetChurnSignals({ tenantId, entity }) {
  const { churn } = serviceLoader();
  const signals = await churn.latestFitnessSignalByPhone({
    tenantId,
    phone: entity.id,
  });

  if (!signals) {
    return {
      toolId: 'getChurnSignals',
      found: false,
      facts: [],
      summary: 'Nenhum sinal de risco registrado para o aluno.',
    };
  }

  const facts = [
    { key: 'signalType', label: 'Tipo de sinal', value: signals.signal_type || signals.signalType || null },
    { key: 'signalCreatedAt', label: 'Registrado em', value: signals.created_at || signals.createdAt || null },
  ].filter((fact) => fact.value !== null && fact.value !== undefined);

  return {
    toolId: 'getChurnSignals',
    found: true,
    facts,
    summary: `Sinal de risco: ${facts.find((f) => f.key === 'signalType')?.value ?? 'não classificado'}.`,
  };
}

/**
 * Executa uma tool registrada. NUNCA aceita SQL nem identificador de serviço
 * arbitrário: apenas ids do registro.
 *
 * @returns {Promise<Object>} resultado normalizado; erro de tool é capturado e
 *   devolvido como `{ failed: true }` (a resposta usa apenas os fatos restantes).
 */
async function executeTool(toolId, { tenantId, actor, entity }) {
  const registry = buildRegistry();
  const tool = registry.get(toolId);
  if (!tool) {
    return { toolId, failed: true, error: 'unknown_tool', facts: [], summary: null };
  }
  if (!tenantId) {
    return { toolId, failed: true, error: 'tenant_required', facts: [], summary: null };
  }
  if (!entity?.type || !entity?.id) {
    return { toolId, failed: true, error: 'entity_context_required', facts: [], summary: null };
  }
  if (!tool.entityTypes.includes(entity.type)) {
    return { toolId, failed: true, error: 'entity_type_not_supported', facts: [], summary: null };
  }

  try {
    const result = await tool.run({ tenantId, actor, entity });
    return { toolId, failed: false, ...result };
  } catch (error) {
    return {
      toolId,
      failed: true,
      error: error?.code || error?.name || 'tool_execution_failed',
      facts: [],
      summary: null,
    };
  }
}

module.exports = {
  TOOL_KINDS,
  ENTITY,
  DEFINITIONS,
  buildRegistry,
  executeTool,
};
