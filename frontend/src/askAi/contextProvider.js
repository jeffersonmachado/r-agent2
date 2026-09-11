/**
 * Contexto de tela do "Perguntar à IA".
 *
 * O widget precisa saber ONDE o usuário está (rota, módulo, tipo de página) e,
 * quando a tela estiver sobre uma entidade concreta, QUAL entidade é — sem
 * nunca enviar DOM, HTML ou campos sensíveis.
 *
 * Contrato (espelhado em `api/services/askAi/contextContract.js`):
 *   { route, module, pageType, actionContext?, entityType?, entityId? }
 *
 * IMPORTANTE: este contexto é uma DICA, nunca autoridade. O backend revalida
 * posse/permissão de `entityId` a cada turno; uma entidade de outro tenant é
 * negada mesmo que a tela informe o id.
 */

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

/**
 * Declara a entidade em uso na tela atual. Deve ser chamado por páginas de
 * detalhe (ex.: ficha do aluno) e limpo no unmount.
 *
 * @param {{entityType: string, entityId: string, actionContext?: string}|null} context
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
  currentEntityContext = {
    entityType: context.entityType,
    entityId: String(context.entityId),
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
 * @param {string} [pathname]
 * @returns {{route: string, module: string, pageType: string}}
 */
export function deriveScreenContext(pathname) {
  const raw = String(pathname || (typeof window !== 'undefined' ? window.location.pathname : '') || '/');
  const route = raw.startsWith('/') ? raw : `/${raw}`;
  const segments = route.split('/').filter(Boolean);
  const module = segments[0] ? segments[0].replace(/[^A-Za-z0-9._-]/g, '') || 'root' : 'root';
  let pageType = 'index';
  if (segments.length > 1) {
    pageType = segments.length === 2 ? 'detail' : 'nested';
  }
  return { route: route.slice(0, 200), module, pageType };
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
