'use strict';

/**
 * Migration: create queue_assignment_states
 *
 * Objetivo:
 * - Persistir cursor do round-robin por tenant + queue_name (cluster-safe-ish).
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
    const exists = await tableExists(queryInterface, 'queue_assignment_states');
    if (exists) {
      // eslint-disable-next-line no-console
      console.log('[Migration] Tabela queue_assignment_states já existe, pulando');
      return;
    }

    await queryInterface.createTable('queue_assignment_states', {
      id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      queue_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      cursor: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      updated_by: {
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

    await queryInterface.addIndex('queue_assignment_states', ['tenant_key', 'queue_name'], {
      name: 'queue_assignment_states_tenant_queue_uq',
      unique: true,
    });
    await queryInterface.addIndex('queue_assignment_states', ['tenant_key', 'updated_at'], {
      name: 'queue_assignment_states_tenant_updated_idx',
    });
  },

  async down(queryInterface) {
    const exists = await tableExists(queryInterface, 'queue_assignment_states');
    if (!exists) return;
    await queryInterface.dropTable('queue_assignment_states');
  },
};

