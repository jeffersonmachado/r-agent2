'use strict';

const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { Ticket: TicketGetter } = require('../../db/models');
const { safeErrorMessage } = require('../../utils/defensiveCoercion');

function dbAvailable() {
  return !!getSequelize();
}

async function upsertTicketToDb(ticket, toDbPayload) {
  if (!dbAvailable()) return;
  const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
  const payload = toDbPayload(ticket);
  const now = new Date();

  const existing = await TicketModel.findByPk(ticket.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await TicketModel.create({ ...payload, created_at: now, updated_at: now });
  }
}

async function deleteTicketFromDb(ticketId) {
  if (!dbAvailable()) return;
  const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
  await TicketModel.destroy({ where: { id: ticketId } });
}

function persistTicketBestEffort(ticket, toDbPayload) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertTicketToDb(ticket, toDbPayload).catch((err) => {
      logger.warn('[QueueService] Falha ao persistir ticket no PostgreSQL', {
        ticketId: ticket.id,
        error: safeErrorMessage(err),
      });
    });
  });
}

function deleteTicketBestEffort(ticketId) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteTicketFromDb(ticketId).catch((err) => {
      logger.warn('[QueueService] Falha ao remover ticket no PostgreSQL', {
        ticketId,
        error: safeErrorMessage(err),
      });
    });
  });
}

async function initializeRuntimeCache({ tickets, queues, fromDbRow, addTicketToQueueIndex }) {
  if (!dbAvailable()) return;
  try {
    const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
    const rows = await TicketModel.findAll();

    tickets.clear();
    queues.clear();

    for (const row of rows) {
      const ticket = fromDbRow(row);
      tickets.set(ticket.id, ticket);
      addTicketToQueueIndex({ queues, queueName: ticket.queue, ticketId: ticket.id });
    }

    logger.info('[QueueService] Cache inicializado do PostgreSQL', {
      tickets: tickets.size,
      queues: queues.size,
    });
  } catch (err) {
    logger.warn('[QueueService] Falha ao inicializar cache do PostgreSQL', {
      error: safeErrorMessage(err),
    });
  }
}

module.exports = {
  persistTicketBestEffort,
  deleteTicketBestEffort,
  initializeRuntimeCache,
};