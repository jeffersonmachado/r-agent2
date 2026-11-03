'use strict';

/**
 * api/services/queue/ticketDeliveryStatusSql.js
 *
 * SQL PURO (sem I/O) da atualização de status de entrega de UMA mensagem do ticket.
 *
 * POR QUE ESTE MÓDULO EXISTE (medido 2026-10-21, stack prod-like real):
 * o worker de outbound atualizava o status de entrega apenas pela cópia do ticket em
 * memória (`queueService.updateOutboundMessageMeta`, que faz `tickets.get(ticketId)`).
 * Quando a mensagem do agente nasce por um caminho que NÃO populou essa cópia — ou
 * quando uma persistência integral posterior do ticket regrava `messages` — o status
 * terminal (`failed`/`connection_not_found`) nunca chegava ao banco e a mensagem
 * ficava `pending` para sempre. Efeito observável: o smoke prod-like reprovava em
 * `step_assert_whatsapp_delivery` com `support_delivery_status_not_terminal` mesmo com
 * a fila de outbound já em `failed`.
 *
 * A atualização abaixo é DELIBERADAMENTE pontual (JSONB da coluna `messages`, apenas o
 * elemento cujo `clientMessageId` casa e cujo `sender` é `agent`): nada mais da linha do
 * ticket é reescrito, então ela não pode ressuscitar estado velho nem competir com uma
 * escrita integral de outros campos.
 */

const IDENTIFICADOR_TICKET = /^[A-Za-z0-9._:-]+$/;

function ticketIdValido(ticketId) {
  const valor = String(ticketId || '').trim();
  if (!valor) return false;
  // O id do ticket vem do banco/roteador; nunca é interpolado na query (usa replacements),
  // mas recusar formatos inesperados evita atualizar linha errada por engano de chamador.
  return IDENTIFICADOR_TICKET.test(valor);
}

function clientMessageIdValido(clientMessageId) {
  return Boolean(String(clientMessageId || '').trim());
}

/**
 * Monta a query que aplica o patch de status de entrega em UMA mensagem do ticket.
 *
 * @param {{ticketId: string, clientMessageId: string, patch: object}} entrada
 * @returns {{sql: string, replacements: object}|null} `null` quando os identificadores
 *          não são utilizáveis (o chamador trata como no-op auditável, nunca como sucesso).
 */
function buildTicketDeliveryStatusUpdate({ ticketId, clientMessageId, patch } = {}) {
  if (!ticketIdValido(ticketId)) return null;
  if (!clientMessageIdValido(clientMessageId)) return null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;

  const sql = `
    UPDATE tickets AS t
       SET messages = COALESCE(
             (
               SELECT jsonb_agg(
                        CASE
                          WHEN (elem.value ->> 'clientMessageId') = :clientMessageId
                           AND (elem.value ->> 'sender') = 'agent'
                          THEN elem.value || CAST(:statusPatch AS jsonb)
                          ELSE elem.value
                        END
                        ORDER BY elem.ordinality
                      )
                 FROM jsonb_array_elements(t.messages) WITH ORDINALITY AS elem(value, ordinality)
             ),
             '[]'::jsonb
           ),
           updated_at = NOW()
     WHERE t.id = :ticketId
       AND jsonb_typeof(t.messages) = 'array'
       AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(t.messages) AS alvo(valor)
              WHERE (alvo.valor ->> 'clientMessageId') = :clientMessageId
                AND (alvo.valor ->> 'sender') = 'agent'
           )
    RETURNING t.id
  `;

  return {
    sql,
    replacements: {
      ticketId: String(ticketId).trim(),
      clientMessageId: String(clientMessageId).trim(),
      statusPatch: JSON.stringify(patch),
    },
  };
}

module.exports = {
  buildTicketDeliveryStatusUpdate,
  ticketIdValido,
  clientMessageIdValido,
};
