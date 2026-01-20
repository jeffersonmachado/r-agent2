'use strict';

/**
 * Migration: create ticket_events (Blip-like ticket timeline)
 *
 * Colunas:
 * - tenant_key (multi-tenant)
 * - ticket_id
 * - type (handover/sla/etc.)
 * - payload (JSONB)
 * - created_by (agentId/system)
 */

async function tableExists(queryInterface, tableName) {
  try {
    const results = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '${tableName.replace(/'/g, "''")}'
      ) AS "exists"`,
      { type: queryInterface.sequelize.constructor.QueryTypes.SELECT }
    );
    const row = Array.isArray(results) ? results[0] : results;
    const exists = row?.exists ?? row?.['exists'];
    return exists === true || exists === 't' || exists === 'true';
  } catch (err) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await tableExists(queryInterface, 'ticket_events');
    if (exists) {
      // eslint-disable-next-line no-console
      console.log('[Migration] Tabela ticket_events já existe, pulando');
      return;
    }

    await queryInterface.createTable('ticket_events', {
      id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('ticket_events', ['tenant_key', 'ticket_id', 'created_at'], {
      name: 'ticket_events_tenant_ticket_created_idx',
    });
    await queryInterface.addIndex('ticket_events', ['tenant_key', 'type', 'created_at'], {
      name: 'ticket_events_tenant_type_created_idx',
    });
  },

  async down(queryInterface) {
    const exists = await tableExists(queryInterface, 'ticket_events');
    if (!exists) return;
    await queryInterface.dropTable('ticket_events');
  },
};

