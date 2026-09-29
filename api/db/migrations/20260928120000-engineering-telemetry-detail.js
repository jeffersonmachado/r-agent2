/**
 * Migration: DETALHE ESTRUTURADO na telemetria do Engineering Router (2026-09-28).
 *
 * A telemetria só tinha colunas de chamada de modelo (tokens/latência/resultado). Eventos de
 * TIMEOUT, NO_PROGRESS, LEASE_LOST e STALE_WRITE_REJECTED precisam carregar o registro completo
 * exigido pela arquitetura de timeouts (tipo, escopo, operação, fase, provider, deadline, elapsed,
 * último heartbeat, último progresso, retry, fallback, outcome) — sem isso o evento vira "TIMEOUT"
 * genérico, exatamente o que a política proíbe.
 *
 * `event_type` separa os eventos de liveness/deadline das chamadas de modelo sem reinterpretar
 * `role` (que continua CODER/REVIEWER nas linhas históricas).
 */

'use strict';

const TABLE = 'engineering_telemetry_events';

async function addColumnIfMissing(queryInterface, column, definition) {
  const description = await queryInterface.describeTable(TABLE);
  if (description[column]) return false;
  await queryInterface.addColumn(TABLE, column, definition);
  return true;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'event_type', {
      type: Sequelize.STRING(48),
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'detail', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    for (const column of ['detail', 'event_type']) {
      try {
        await queryInterface.removeColumn(TABLE, column);
      } catch (_) {
        /* coluna já ausente */
      }
    }
  },
};
