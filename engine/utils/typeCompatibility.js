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
const TYPE_COMPATIBILITY = {
  start: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  message: ['user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  user_input: ['router', 'message', 'set_variable', 'handoff', 'ai', 'ai_task', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  router: ['message', 'user_input', 'set_variable', 'handoff', 'ai', 'ai_task', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  set_variable: ['message', 'user_input', 'router', 'handoff', 'ai', 'ai_task', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  ai: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  ai_task: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end', 'get_flow_info', 'get_queue_status', 'get_config_value', 'list_flows'],
  handoff: ['end'],
  get_flow_info: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_queue_status: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  get_config_value: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  list_flows: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'ai_task', 'end'],
  end: [],
};

// Exportação CommonJS (para Node.js/backend)
// O Vite pode importar CommonJS normalmente, então não precisamos de export ES module explícito
module.exports = {
  TYPE_COMPATIBILITY,
};

