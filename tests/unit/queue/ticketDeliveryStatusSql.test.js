'use strict';

/**
 * Regressão de `buildTicketDeliveryStatusUpdate` (SQL puro).
 *
 * Origem do defeito (medido 2026-10-21, stack prod-like real): o status terminal de
 * entrega (`failed`/`connection_not_found`) não chegava ao banco quando a cópia em
 * memória do ticket não existia — a mensagem ficava `pending` para sempre e o smoke
 * prod-like reprovava em `step_assert_whatsapp_delivery`.
 */

const {
  buildTicketDeliveryStatusUpdate,
  ticketIdValido,
  clientMessageIdValido,
} = require('../../../api/services/queue/ticketDeliveryStatusSql');

const PATCH = {
  deliveryStatus: 'failed',
  reasonCode: 'connection_not_found',
  lastError: 'connection_not_found',
  failedAt: '2026-10-21T16:00:00.000Z',
  attempts: 7,
};

describe('buildTicketDeliveryStatusUpdate', () => {
  test('monta UPDATE pontual com replacements (nunca interpola valores na query)', () => {
    const alvo = buildTicketDeliveryStatusUpdate({
      ticketId: 'support-1792600666019-ab12',
      clientMessageId: 'outq-1792600666010-0j5332q',
      patch: PATCH,
    });

    expect(alvo).not.toBeNull();
    expect(alvo.sql).toContain('UPDATE tickets AS t');
    expect(alvo.sql).toContain('jsonb_array_elements(t.messages) WITH ORDINALITY');
    // A atualização é do ELEMENTO da mensagem, não da linha inteira: campos fora de
    // `messages` não podem ser reescritos por aqui.
    expect(alvo.sql).not.toMatch(/SET\s+messages\s*=\s*:messages/i);
    expect(alvo.sql).toContain("(elem.value ->> 'clientMessageId') = :clientMessageId");
    expect(alvo.sql).toContain("(elem.value ->> 'sender') = 'agent'");
    expect(alvo.sql).toContain('CAST(:statusPatch AS jsonb)');
    // Guarda de existência: sem mensagem correspondente, nenhuma linha é tocada.
    expect(alvo.sql).toContain('AND EXISTS');
    // `RETURNING t.id` é a prova de quantas linhas mudaram (não depende de metadata do driver).
    expect(alvo.sql).toContain('RETURNING t.id');

    expect(alvo.replacements).toEqual({
      ticketId: 'support-1792600666019-ab12',
      clientMessageId: 'outq-1792600666010-0j5332q',
      statusPatch: JSON.stringify(PATCH),
    });
    // O patch viaja como parâmetro serializado — nunca concatenado no texto do SQL.
    expect(alvo.sql).not.toContain('connection_not_found');
    expect(alvo.sql).not.toContain('support-1792600666019-ab12');
  });

  test('ordem original das mensagens é preservada (ORDER BY ordinality)', () => {
    const alvo = buildTicketDeliveryStatusUpdate({
      ticketId: 'support-1',
      clientMessageId: 'outq-1',
      patch: PATCH,
    });
    expect(alvo.sql).toContain('ORDER BY elem.ordinality');
    expect(alvo.sql).toContain("'[]'::jsonb");
  });

  test.each([
    ['ticketId ausente', { ticketId: '', clientMessageId: 'outq-1', patch: PATCH }],
    ['ticketId com caractere inválido', { ticketId: 'support-1; DROP TABLE tickets', clientMessageId: 'outq-1', patch: PATCH }],
    ['clientMessageId ausente', { ticketId: 'support-1', clientMessageId: '   ', patch: PATCH }],
    ['patch ausente', { ticketId: 'support-1', clientMessageId: 'outq-1' }],
    ['patch em array', { ticketId: 'support-1', clientMessageId: 'outq-1', patch: [1, 2] }],
    ['patch nulo', { ticketId: 'support-1', clientMessageId: 'outq-1', patch: null }],
  ])('recusa %s sem montar query', (_rotulo, entrada) => {
    expect(buildTicketDeliveryStatusUpdate(entrada)).toBeNull();
  });

  test('sem entrada nenhuma devolve null (no-op auditável)', () => {
    expect(buildTicketDeliveryStatusUpdate()).toBeNull();
    expect(buildTicketDeliveryStatusUpdate({})).toBeNull();
  });

  test('validadores de identificador são explícitos', () => {
    expect(ticketIdValido('support-1792600666019-ab12')).toBe(true);
    expect(ticketIdValido('support 1')).toBe(false);
    expect(ticketIdValido('')).toBe(false);
    expect(clientMessageIdValido('outq-1')).toBe(true);
    expect(clientMessageIdValido('  ')).toBe(false);
  });
});
