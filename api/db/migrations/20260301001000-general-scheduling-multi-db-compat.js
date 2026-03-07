'use strict';

const { tableExists, addIndexIfNotExists } = require('../migrations-helper');

async function hasColumn(queryInterface, tableName, columnName) {
  try {
    const desc = await queryInterface.describeTable(tableName);
    return !!desc?.[columnName];
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'operational_schedules')) {
      if (await hasColumn(queryInterface, 'operational_schedules', 'metadata')) {
        await queryInterface.changeColumn('operational_schedules', 'metadata', {
          type: Sequelize.TEXT,
          allowNull: false,
          defaultValue: '{}',
        });
      }

      await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'context_type', 'context_id'], {
        name: 'operational_schedules_tenant_context_idx',
      });
      await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'team_id', 'start_at'], {
        name: 'operational_schedules_tenant_team_start_idx',
      });
      await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'owner_id', 'start_at'], {
        name: 'operational_schedules_tenant_owner_start_idx',
      });
      await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'idempotency_key'], {
        name: 'operational_schedules_tenant_idempotency_uq',
        unique: true,
      });
    }

    if (await tableExists(queryInterface, 'schedule_working_hours')) {
      if (await hasColumn(queryInterface, 'schedule_working_hours', 'metadata')) {
        await queryInterface.changeColumn('schedule_working_hours', 'metadata', {
          type: Sequelize.TEXT,
          allowNull: false,
          defaultValue: '{}',
        });
      }
    }

    if (await tableExists(queryInterface, 'schedule_blocks')) {
      if (await hasColumn(queryInterface, 'schedule_blocks', 'metadata')) {
        await queryInterface.changeColumn('schedule_blocks', 'metadata', {
          type: Sequelize.TEXT,
          allowNull: false,
          defaultValue: '{}',
        });
      }
    }

    if (await tableExists(queryInterface, 'schedule_reminders')) {
      if (await hasColumn(queryInterface, 'schedule_reminders', 'payload')) {
        await queryInterface.changeColumn('schedule_reminders', 'payload', {
          type: Sequelize.TEXT,
          allowNull: false,
          defaultValue: '{}',
        });
      }

      if (!(await hasColumn(queryInterface, 'schedule_reminders', 'processing_started_at'))) {
        await queryInterface.addColumn('schedule_reminders', 'processing_started_at', {
          type: Sequelize.DATE,
          allowNull: true,
        });
      }

      await addIndexIfNotExists(queryInterface, 'schedule_reminders', ['tenant_key', 'execute_at', 'status'], {
        name: 'schedule_reminders_tenant_execute_status_idx',
      });
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'schedule_reminders')) {
      if (await hasColumn(queryInterface, 'schedule_reminders', 'processing_started_at')) {
        await queryInterface.removeColumn('schedule_reminders', 'processing_started_at');
      }
    }
  },
};
