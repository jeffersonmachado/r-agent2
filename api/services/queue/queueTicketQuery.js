'use strict';

const {
  safeToString,
  safeTrim,
  safeTrimLower,
} = require('../../utils/defensiveCoercion');

function buildListAllTicketsResponse(ticketSource = [], options = {}) {
  let ticketList = Array.isArray(ticketSource) ? ticketSource.slice() : [];

  if (options.tenantId) {
    ticketList = ticketList.filter((t) => t.tenantId === options.tenantId);
  }

  if (options.status) {
    const statusList = safeTrimLower(options.status)
      .split(',')
      .map((s) => safeTrim(s))
      .filter((s) => s);
    if (statusList.length > 0) {
      ticketList = ticketList.filter((t) => statusList.includes(t.status));
    }
  }

  if (options.queue) {
    ticketList = ticketList.filter((t) => t.queue === options.queue);
  }

  if (options.q) {
    const query = safeTrimLower(options.q);
    ticketList = ticketList.filter((t) => {
      const id = safeTrimLower(safeToString(t.id || ''));
      const contact = safeTrimLower(safeToString(t.contact || ''));
      const phone = safeTrimLower(safeToString(t.phone || ''));
      const firstName = safeTrimLower(safeToString(t.firstName || ''));
      const lastName = safeTrimLower(safeToString(t.lastName || ''));
      const queue = safeTrimLower(safeToString(t.queue || ''));

      return (
        id.includes(query)
        || contact.includes(query)
        || phone.includes(query)
        || firstName.includes(query)
        || lastName.includes(query)
        || queue.includes(query)
      );
    });
  }

  // ORDENAÇÃO SEM ALOCAÇÃO POR COMPARAÇÃO.
  //
  // DEFEITO REAL medido em 2026-10-02: a versão anterior era
  // `ticketList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))`, que constrói DOIS
  // objetos `Date` em CADA comparação — ~2·n·log n alocações por chamada (~70 mil com os 2963
  // tickets em `waiting` deste runtime). Como `listAllTickets` é chamado pelos dashboards
  // (`analyticsService`, `supervisorService`), pelo worker de assignment (`setInterval`) e pela
  // trilha de evidência, o custo saturava o event loop da API e requisições HTTP passavam a falhar
  // em nível de rede durante as waves do mesh — o mesmo efeito já documentado em
  // `tests/unit/assignmentWorkerEfficiency.test.js` ("~174 listAllTickets/s contínuos e requests
  // HTTP falhando em nível de rede durante waves RPA"). Sintoma observado: a página /support
  // falhava ao carregar tickets sob carga e o mesh reprovava 1 cenário por execução, em cenários
  // DIFERENTES a cada rodada (o que estivesse executando no instante da falha).
  //
  // A chave é calculada UMA vez por item. A ordem resultante é idêntica: `getTime()` devolve `NaN`
  // para data inválida e `NaN` subtraído propaga `NaN`, exatamente como a subtração de `Date`
  // fazia — sem alterar o critério nem o desempate.
  const decorated = ticketList.map((ticket) => ({
    ticket,
    ts: new Date(ticket.createdAt).getTime(),
  }));
  decorated.sort((a, b) => b.ts - a.ts);
  ticketList = decorated.map((entry) => entry.ticket);

  const total = ticketList.length;
  const limit = Math.min(
    Math.max(1, parseInt(options.limit, 10) || 1000),
    10000,
  );

  let offset = 0;
  if (options.cursor) {
    offset = Math.max(0, parseInt(options.cursor, 10) || 0);
  } else if (options.offset !== undefined) {
    offset = Math.max(0, parseInt(options.offset, 10) || 0);
  }

  const paginatedTickets = ticketList.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  const nextCursor = hasMore ? safeToString(nextOffset) : null;

  return {
    items: paginatedTickets,
    tickets: paginatedTickets,
    total,
    limit,
    offset,
    nextCursor,
    hasMore,
  };
}

module.exports = {
  buildListAllTicketsResponse,
};