'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  const desc = await queryInterface.describeTable(tableName);
  return !!desc[columnName];
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'users', 'mfa_secret_encrypted'))) {
      await queryInterface.addColumn('users', 'mfa_secret_encrypted', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'mfa_temp_secret_encrypted'))) {
      await queryInterface.addColumn('users', 'mfa_temp_secret_encrypted', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'mfa_temp_expires_at'))) {
      await queryInterface.addColumn('users', 'mfa_temp_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'mfa_recovery_codes'))) {
      await queryInterface.addColumn('users', 'mfa_recovery_codes', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('users', 'mfa_recovery_codes'); } catch {}
    try { await queryInterface.removeColumn('users', 'mfa_temp_expires_at'); } catch {}
    try { await queryInterface.removeColumn('users', 'mfa_temp_secret_encrypted'); } catch {}
    try { await queryInterface.removeColumn('users', 'mfa_secret_encrypted'); } catch {}
  },
};
