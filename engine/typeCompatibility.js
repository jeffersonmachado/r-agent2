/**
 * Regras de compatibilidade de tipos entre nós do fluxo.
 *
 * Este módulo define quais tipos de nós podem ser conectados entre si.
 * É usado tanto no backend (validação) quanto no frontend (validação preventiva).
 *
 * IMPORTANTE: Mantenha este arquivo sincronizado com frontend/src/shared/typeCompatibility.ts
 * Se você modificar as regras, atualize ambos os arquivos.
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
  start: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  message: ['user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  user_input: ['router', 'message', 'set_variable', 'handoff', 'ai', 'end'],
  router: ['message', 'user_input', 'set_variable', 'handoff', 'ai', 'end'],
  set_variable: ['message', 'user_input', 'router', 'handoff', 'ai', 'end'],
  ai: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end'],
  handoff: ['end'],
  end: [],
};

module.exports = {
  TYPE_COMPATIBILITY,
};

