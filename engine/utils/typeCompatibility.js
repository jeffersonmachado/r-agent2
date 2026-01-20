/**
 * Regras de compatibilidade de tipos entre nós do fluxo.
 *
 * Este módulo define quais tipos de nós podem ser conectados entre si.
 * É usado tanto no backend (validação) quanto no frontend (validação preventiva).
 *
 * Módulo compartilhado: pode ser usado tanto no backend (CommonJS) quanto no frontend (ES modules).
 *
 * Decisão importante:
 * - Mantemos um mapa explícito de "de -> [para]" por tipo.
 * - Isso garante consistência entre o que o usuário pode desenhar no editor
 *   e o que a engine aceita na validação.
 */

/**
 * Mapa de compatibilidade de tipos de nós.
 * 
 * Chave: tipo do nó de origem
 * Valor: array de tipos de nós que podem ser conectados como destino
 * 
 * @type {Record<string, string[]>}
 */
const SYSTEM_NODES = [
  'get_flow_info',
  'get_queue_status',
  'get_config_value',
  'list_flows',
  'get_current_time',
  'generate_uuid',
  'delay',
  'format_date',
  'random_number',
  'get_user_info',
];

// Nós interativos/externos que fazem parte do schema e da engine
const EXTRA_NODES = [
  'fallback',
  'api',
  'options',
];

const TYPE_COMPATIBILITY = {
  start: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'options', 'api', 'end', ...SYSTEM_NODES],
  message: ['user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  user_input: ['router', 'schedule_router', 'message', 'set_variable', 'handoff', 'ai', 'ai_task', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  options: ['router', 'schedule_router', 'message', 'set_variable', 'handoff', 'ai', 'ai_task', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  api: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'options', 'fallback', 'end', ...SYSTEM_NODES],
  router: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  schedule_router: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  set_variable: ['message', 'user_input', 'router', 'schedule_router', 'handoff', 'ai', 'ai_task', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  ai: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  ai_task: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'options', 'api', 'fallback', 'end', ...SYSTEM_NODES],
  handoff: ['end'],
  fallback: ['message', 'handoff', 'end'],
  get_flow_info: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_queue_status: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_config_value: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  list_flows: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_current_time: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  generate_uuid: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  delay: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  format_date: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  random_number: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_user_info: ['message', 'user_input', 'router', 'schedule_router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  end: [],
};

// Exportação CommonJS (para Node.js/backend)
// O Vite pode importar CommonJS normalmente, então não precisamos de export ES module explícito
module.exports = {
  TYPE_COMPATIBILITY,
};

