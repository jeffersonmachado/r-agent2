/**
 * Regras de compatibilidade de tipos entre nós do fluxo.
 * 
 * Este arquivo é uma cópia sincronizada de engine/typeCompatibility.js
 * para uso no frontend TypeScript.
 * 
 * IMPORTANTE: Mantenha este arquivo sincronizado com engine/typeCompatibility.js
 * Se você modificar as regras, atualize ambos os arquivos.
 */

/**
 * Mapa de compatibilidade de tipos de nós.
 * 
 * Chave: tipo do nó de origem
 * Valor: array de tipos de nós que podem ser conectados como destino
 */
export const TYPE_COMPATIBILITY: Record<string, string[]> = {
  start: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  message: ['user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  user_input: ['router', 'message', 'set_variable', 'handoff', 'ai', 'end'],
  router: ['message', 'user_input', 'set_variable', 'handoff', 'ai', 'end'],
  set_variable: ['message', 'user_input', 'router', 'handoff', 'ai', 'end'],
  ai: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end'],
  handoff: ['end'],
  end: [],
};

