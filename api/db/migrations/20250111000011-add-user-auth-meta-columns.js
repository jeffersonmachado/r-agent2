/**
 * Migration: Add auth metadata columns to users table
 *
 * These columns existed in the legacy JSON agent objects and are required
 * by invitation/password reset flows.
 */

'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  const desc = await queryInterface.describeTable(tableName);
  return !!desc[columnName];
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'users', 'status'))) {
      await queryInterface.addColumn('users', 'status', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active',
      });
      await addIndexIfNotExists(queryInterface, 'users', ['status'], { name: 'users_status_idx' });
    }

    if (!(await columnExists(queryInterface, 'users', 'mfa_enabled'))) {
      await queryInterface.addColumn('users', 'mfa_enabled', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'invitation_token'))) {
      await queryInterface.addColumn('users', 'invitation_token', {
        type: Sequelize.STRING,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['invitation_token'], {
        name: 'users_invitation_token_idx',
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'invitation_expires_at'))) {
      await queryInterface.addColumn('users', 'invitation_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'password_reset_token'))) {
      await queryInterface.addColumn('users', 'password_reset_token', {
        type: Sequelize.STRING,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['password_reset_token'], {
        name: 'users_password_reset_token_idx',
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'password_reset_expires_at'))) {
      await queryInterface.addColumn('users', 'password_reset_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'users', 'last_login_at'))) {
      await queryInterface.addColumn('users', 'last_login_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['last_login_at'], {
        name: 'users_last_login_at_idx',
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('users', 'last_login_at'); } catch {}
    try { await queryInterface.removeColumn('users', 'password_reset_expires_at'); } catch {}
    try { await queryInterface.removeColumn('users', 'password_reset_token'); } catch {}
    try { await queryInterface.removeColumn('users', 'invitation_expires_at'); } catch {}
    try { await queryInterface.removeColumn('users', 'invitation_token'); } catch {}
    try { await queryInterface.removeColumn('users', 'mfa_enabled'); } catch {}
    try { await queryInterface.removeColumn('users', 'status'); } catch {}
  },
};

