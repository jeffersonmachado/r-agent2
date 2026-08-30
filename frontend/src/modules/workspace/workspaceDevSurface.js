/**
 * Superfície de engenharia do Workspace (QA/RPA).
 *
 * ÚNICO ponto do módulo workspace onde os literais técnicos ('QA/RPA', waves,
 * evidências, replays) podem existir. Os demais componentes do workspace
 * (Layout, Sidebar, Timeline, RightRail, WorkspacePage) consomem helpers daqui
 * e NUNCA embolem literais técnicos — um scanner de governança verifica isso.
 *
 * Política:
 * - PRODUCTION (operação do cliente): linguagem sanitizada de outcome
 *   operacional; sem evidence IDs, refs técnicas ou links de replay.
 * - SUPPORT/DEVELOPMENT (plataforma interna): detalhe técnico completo.
 */
import { WorkspaceQaRpaPanel } from './WorkspaceQaRpaPanel';

export { WorkspaceQaRpaPanel };

/** Tab técnica do workspace (apenas perfis internos). */
export const DEV_SURFACE_TAB = 'QA/RPA';

/** Tipo de evento de timeline associado à tab técnica. */
export const DEV_SURFACE_EVENT_TYPE = 'evidence';

const BASE_TABS = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'Pagamentos'];
const TAIL_TABS = ['Insights IA', 'Ações'];

/** Filtro técnico da sidebar (apenas perfis internos veem o rótulo técnico). */
const DEV_SURFACE_SIDEBAR_FILTER = { id: 'qa', label: 'Falha QA/RPA' };
const SANITIZED_SIDEBAR_FILTER = { id: 'qa', label: 'Incidentes operacionais' };

const BASE_SIDEBAR_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'risk', label: 'Em risco' },
  { id: 'active', label: 'Ativos' },
];

/** Labels operacionais vs. técnicos para os componentes do workspace. */
const INTERNAL_LABELS = {
  failurePill: 'QA/RPA',
  failuresCardTitle: 'Falhas QA/RPA',
  failuresMetric: 'Falhas QA/RPA',
  failuresEmpty: 'Nenhuma falha crítica em aberto.',
  failureDetected: 'Falha detectada',
  sidebarDescription: 'Entidades unificadas por contato, conversa, ticket, QA/RPA e operação.',
  timelineDescription: 'Mensagens, tickets, tarefas, agenda, projetos, documentos, pagamentos e evidências QA/RPA.',
};

const SANITIZED_LABELS = {
  failurePill: 'Incidente',
  failuresCardTitle: 'Incidentes operacionais',
  failuresMetric: 'Incidentes operacionais',
  failuresEmpty: 'Nenhum incidente crítico em aberto.',
  failureDetected: 'Instabilidade detectada e recuperada',
  sidebarDescription: 'Entidades unificadas por contato, conversa, ticket e operação.',
  timelineDescription: 'Mensagens, tickets, tarefas, agenda, projetos, documentos e pagamentos.',
};

/** Texto sanitizado exibido a PRODUCTION no lugar de summaries técnicos. */
export const SANITIZED_EVENT_SUMMARY = 'Instabilidade detectada e recuperada';
export const SANITIZED_EVENT_SOURCE = 'operação';
export const SANITIZED_EVENT_TYPE_LABEL = 'operacional';

/**
 * A superfície de engenharia só é visível para perfis internos da plataforma.
 *
 * @param {string} classification - PRODUCTION | SUPPORT | DEVELOPMENT
 * @returns {boolean}
 */
export function isDevSurfaceVisible(classification) {
  return classification === 'SUPPORT' || classification === 'DEVELOPMENT';
}

/**
 * Tabs do workspace conforme a classificação do agente.
 * PRODUCTION nunca vê a tab técnica.
 */
export function getWorkspaceTabs(classification) {
  if (isDevSurfaceVisible(classification)) {
    return [...BASE_TABS, DEV_SURFACE_TAB, ...TAIL_TABS];
  }
  return [...BASE_TABS, ...TAIL_TABS];
}

/**
 * Filtros da sidebar conforme a classificação do agente.
 */
export function getSidebarFilters(classification) {
  const technicalFilter = isDevSurfaceVisible(classification)
    ? DEV_SURFACE_SIDEBAR_FILTER
    : SANITIZED_SIDEBAR_FILTER;
  return [BASE_SIDEBAR_FILTERS[0], BASE_SIDEBAR_FILTERS[1], technicalFilter, BASE_SIDEBAR_FILTERS[2]];
}

/**
 * Labels do workspace conforme a classificação do agente.
 */
export function getOperationalLabels(classification) {
  return isDevSurfaceVisible(classification) ? INTERNAL_LABELS : SANITIZED_LABELS;
}

/**
 * Tipo de evento de timeline associado a uma tab ('' = sem filtro).
 */
export function getWorkspaceTabEventType(tab) {
  const map = {
    Conversas: 'message',
    Tickets: 'ticket',
    Tarefas: 'task',
    Agenda: 'schedule',
    Projetos: 'project',
    Documentos: 'document',
    Pagamentos: 'payment',
    [DEV_SURFACE_TAB]: DEV_SURFACE_EVENT_TYPE,
  };
  return map[tab] || '';
}

/**
 * Monta as props do painel técnico. O contrato interno do painel (nomes de
 * props técnicos) vive apenas aqui — os componentes PRODUCTION do workspace
 * passam dados com nomes neutros (incidents) e nunca citam o contrato interno.
 */
export function buildDevSurfacePanelProps({ incidents, loading, timeline }) {
  return { autocorrections: incidents, loading, timeline };
}

const TECHNICAL_SOURCE_PATTERN = /qa|rpa|replay|wave|evidence|autocorrection|mesh/i;

function isTechnicalEvent(event = {}) {
  if (event.type === DEV_SURFACE_EVENT_TYPE) return true;
  return TECHNICAL_SOURCE_PATTERN.test(String(event.source || ''));
}

/**
 * Sanitiza um evento de timeline para a classificação informada.
 * - PRODUCTION: eventos técnicos viram outcome operacional, sem IDs/refs/links.
 * - SUPPORT/DEVELOPMENT: detalhe técnico preservado.
 */
export function sanitizeOperationalEvent(event = {}, classification) {
  if (isDevSurfaceVisible(classification)) {
    return event;
  }
  if (!isTechnicalEvent(event)) {
    // Mesmo eventos operacionais nunca expõem link de detalhe técnico a PRODUCTION.
    if (event.detailUrl && TECHNICAL_SOURCE_PATTERN.test(String(event.detailUrl))) {
      return { ...event, detailUrl: null };
    }
    return event;
  }
  return {
    ...event,
    summary: SANITIZED_EVENT_SUMMARY,
    source: SANITIZED_EVENT_SOURCE,
    displayType: SANITIZED_EVENT_TYPE_LABEL,
    detailUrl: null,
    refId: null,
    confidence: undefined,
  };
}
