/**
 * Módulo de replay de conversas.
 *
 * Objetivo:
 * - Dado um conjunto de eventos estruturados (EngineEvent[]),
 *   reconstruir uma visão de alto nível da conversa:
 *   - linha do tempo de mensagens
 *   - handoffs
 *   - nós percorridos
 *
 * Importante:
 * - Este módulo também é stateless: ele apenas consome um array
 *   de eventos, não guarda nada internamente.
 */

/**
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 */

/**
 * Reconstrói um "replay" simplificado da conversa.
 *
 * @param {EngineEvent[]} events
 * @returns {{
 *   sessionId: string|null,
 *   flowId: string|null,
 *   messages: Array<{ from: "user"|"bot"|"system", text: string, at: string }>,
 *   handoffs: Array<{ queue: string, at: string }>,
 *   nodesVisited: Array<{ nodeId: string|null, at: string }>,
 *   rawEvents: EngineEvent[]
 * }}
 */
function buildConversationReplay(events) {
  if (!Array.isArray(events)) {
    throw new Error('events must be an array');
  }

  // Ordena por timestamp para garantir ordem cronológica.
  const sorted = [...events].sort((a, b) => {
    if (a.timestamp < b.timestamp) return -1;
    if (a.timestamp > b.timestamp) return 1;
    return 0;
  });

  /** @type {string|null} */
  let sessionId = null;
  /** @type {string|null} */
  let flowId = null;

  const messages = [];
  const handoffs = [];
  const nodesVisited = [];

  for (const ev of sorted) {
    sessionId = sessionId || ev.sessionId || null;
    flowId = flowId || ev.flowId || null;

    if (ev.type === 'MESSAGE_OUT') {
      messages.push({
        from: 'bot',
        text: ev.payload && ev.payload.text ? String(ev.payload.text) : '',
        at: ev.timestamp,
      });
    } else if (ev.type === 'MESSAGE_IN') {
      messages.push({
        from: 'user',
        text: ev.payload && ev.payload.text ? String(ev.payload.text) : '',
        at: ev.timestamp,
      });
    } else if (ev.type === 'HANDOFF') {
      handoffs.push({
        queue: ev.payload && ev.payload.queue ? String(ev.payload.queue) : 'default',
        at: ev.timestamp,
      });
    }

    if (ev.type === 'NODE_ENTER') {
      nodesVisited.push({
        nodeId: ev.nodeId || null,
        at: ev.timestamp,
      });
    }
  }

  return {
    sessionId,
    flowId,
    messages,
    handoffs,
    nodesVisited,
    rawEvents: sorted,
  };
}

module.exports = {
  buildConversationReplay,
};


