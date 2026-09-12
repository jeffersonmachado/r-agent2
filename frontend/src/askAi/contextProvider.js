/**
 * Contexto de tela do "Perguntar à IA".
 *
 * O widget precisa saber ONDE o usuário está (rota, módulo, tipo de página) e,
 * quando a tela estiver sobre uma entidade concreta, QUAL entidade é — sem
 * nunca enviar DOM, HTML ou campos sensíveis.
 *
 * Contrato (espelhado em `api/services/askAi/contextContract.js`):
 *   { route, module, pageType, actionContext?, entityType?, entityId?,
 *     workspaceEntityId? }
 *
 * IMPORTANTE: este contexto é uma DICA, nunca autoridade. O backend revalida
 * posse/permissão de `entityId` a cada turno; uma entidade de outro tenant é
 * negada mesmo que a tela informe o id.
 */

import { resolveScreen } from './screenRegistry';

const ENTITY_TYPES = Object.freeze({
  FITNESS_STUDENT: 'FITNESS_STUDENT',
  CUSTOMER: 'CUSTOMER',
  CASE: 'CASE',
  CONVERSATION: 'CONVERSATION',
  CAMPAIGN: 'CAMPAIGN',
  TICKET: 'TICKET',
  ORDER: 'ORDER',
  BOOKING: 'BOOKING',
});

const EMPTY_CONTEXT = Object.freeze({});

let currentEntityContext = EMPTY_CONTEXT;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * Declara a entidade em uso na tela atual. Deve ser chamado por páginas de
 * detalhe (ex.: ficha do aluno) e limpo no unmount.
 *
 * `workspaceEntityId` é a entidade do Workspace (cliente 360) quando a tela
 * opera sobre ela — distinta da entidade de domínio. Nunca enviamos DOM, HTML
 * ou campos do formulário.
 *
 * @param {{entityType: string, entityId: string, workspaceEntityId?: string, actionContext?: string}|null} context
 */
export function setAskAiEntityContext(context) {
  if (!context || !context.entityType || !context.entityId) {
    currentEntityContext = EMPTY_CONTEXT;
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(ENTITY_TYPES, context.entityType)) {
    currentEntityContext = EMPTY_CONTEXT;
    return;
  }
  const entityId = String(context.entityId);
  if (!SAFE_ID_PATTERN.test(entityId)) {
    currentEntityContext = EMPTY_CONTEXT;
    return;
  }
  const workspaceEntityId = context.workspaceEntityId === undefined || context.workspaceEntityId === null
    ? null
    : String(context.workspaceEntityId);
  if (workspaceEntityId !== null && !SAFE_ID_PATTERN.test(workspaceEntityId)) {
    currentEntityContext = EMPTY_CONTEXT;
    return;
  }
  currentEntityContext = {
    entityType: context.entityType,
    entityId,
    ...(workspaceEntityId ? { workspaceEntityId } : {}),
    ...(context.actionContext ? { actionContext: String(context.actionContext) } : {}),
  };
}

export function getAskAiEntityContext() {
  return currentEntityContext;
}

export function clearAskAiEntityContext() {
  currentEntityContext = EMPTY_CONTEXT;
}

/**
 * Deriva rota/módulo/tipo de página da URL atual — sem tocar no DOM.
 *
 * O módulo e o tipo de página vêm do registro de TELAS (derivado da navegação
 * canônica), não de uma heurística de string.
 *
 * @param {string} [pathname]
 * @returns {{route: string, module: string, pageType: string}}
 */
export function deriveScreenContext(pathname) {
  const raw = String(pathname || (typeof window !== 'undefined' ? window.location.pathname : '') || '/');
  const resolved = resolveScreen(raw);
  return {
    route: resolved.route.slice(0, 200),
    module: resolved.module || 'root',
    pageType: resolved.pageType || 'index',
  };
}

/**
 * Assina as mudanças de rota do SPA e devolve o unsubscribe.
 *
 * `router:change` é o evento que o router da aplicação dispara em navegação
 * client-side (`navigate()`); `popstate` cobre voltar/avançar e `hashchange`
 * cobre âncora. Ouvir apenas `popstate` deixava o contexto preso na tela
 * anterior depois de um clique no menu.
 *
 * @param {(route: string) => void} handler
 * @returns {() => void}
 */
export function subscribeToRouteChanges(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return () => {};
  }
  const notify = () => handler(window.location.pathname);
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  window.addEventListener('router:change', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('hashchange', notify);
    window.removeEventListener('router:change', notify);
  };
}

/**
 * Contexto completo pronto para envio ao backend.
 *
 * @param {string} [pathname]
 * @returns {Object}
 */
export function buildAskAiContext(pathname) {
  const screen = deriveScreenContext(pathname);
  const entity = getAskAiEntityContext();
  return { ...screen, ...entity };
}

/**
 * Rótulo amigável do contexto, sem expor IDs técnicos ao usuário final.
 *
 * @param {Object} context
 * @returns {string|null}
 */
export function describeAskAiContext(context) {
  if (!context) return null;
  switch (context.entityType) {
    case ENTITY_TYPES.FITNESS_STUDENT:
      return 'Considerando o aluno atual';
    case ENTITY_TYPES.CUSTOMER:
      return 'Considerando o cliente atual';
    case ENTITY_TYPES.CASE:
    case ENTITY_TYPES.TICKET:
      return 'Considerando o atendimento atual';
    case ENTITY_TYPES.CONVERSATION:
      return 'Considerando a conversa atual';
    case ENTITY_TYPES.CAMPAIGN:
      return 'Considerando a campanha atual';
    case ENTITY_TYPES.ORDER:
      return 'Considerando o pedido atual';
    case ENTITY_TYPES.BOOKING:
      return 'Considerando o agendamento atual';
    default:
      return null;
  }
}

export { ENTITY_TYPES };
