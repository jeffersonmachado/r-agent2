'use strict';

const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { Ticket: TicketGetter } = require('../../db/models');
const { safeErrorMessage } = require('../../utils/defensiveCoercion');

function dbAvailable() {
  return !!getSequelize();
}

function isUniqueViolation(error) {
  return error?.name === 'SequelizeUniqueConstraintError'
    || error?.original?.code === '23505'
    || error?.parent?.code === '23505';
}

async function upsertTicketToDb(ticket, toDbPayload) {
  if (!dbAvailable()) return;
  const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
  const payload = toDbPayload(ticket);
  const now = new Date();

  const existing = await TicketModel.findByPk(ticket.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
    return;
  }

  try {
    await TicketModel.create({ ...payload, created_at: now, updated_at: now });
  } catch (error) {
    // Corrida de idempotência: createTicket e autoAssignTicket disparam
    // persistBestEffort concorrentes para o mesmo ticket (mesmo id). Ambos
    // passam pelo findByPk e o segundo insert colide com tickets_pkey (23505).
    // Trata como upsert: re-fetch e update do registro já persistido.
    if (!isUniqueViolation(error)) throw error;
    const raced = await TicketModel.findByPk(ticket.id);
    if (raced) {
      await raced.update({ ...payload, updated_at: now });
      return;
    }
    throw error;
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
        errorName: err?.name || null,
        errorConstraint: err?.original?.constraint || err?.parent?.constraint || null,
        errorDetail: err?.original?.detail || null,
        errorFields: err?.fields || null,
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

// Alinhado ao auto-cleanup de tickets fechados (ticketMaxAgeDays = 7, queueTicketRetention).
const BOOT_CLOSED_TICKET_MAX_AGE_DAYS = 7;

async function initializeRuntimeCache({ tickets, queues, fromDbRow, addTicketToQueueIndex }) {
  if (!dbAvailable()) return;
  try {
    const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
    const sequelize = getSequelize();
    const Op = sequelize.constructor.Op;
    // Boot não carrega a tabela inteira: apenas tickets ativos + fechados dentro
    // da janela de retenção (7 dias). Tickets fechados mais antigos permanecem
    // apenas no PostgreSQL (fonte da verdade) e são removidos da memória pelo
    // auto-cleanup; leituras históricas devem consultar o DB.
    const closedCutoff = new Date(Date.now() - BOOT_CLOSED_TICKET_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const rows = await TicketModel.findAll({
      where: {
        [Op.or]: [
          { status: { [Op.ne]: 'closed' } },
          { status: 'closed', updated_at: { [Op.gte]: closedCutoff } },
        ],
      },
    });

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
  upsertTicketToDb,
};