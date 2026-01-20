/**
 * Migration: Add auth columns to users table
 *
 * Adds columns used by the application auth/RBAC layer:
 * - username (unique, nullable to preserve existing rows)
 * - role (string, default 'admin')
 * - is_active (boolean, default true)
 * - tenant_key (string, nullable; must be provided by the app)
 *
 * NOTE: We keep is_superadmin as the canonical superadmin flag.
 */
 
'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const desc = await queryInterface.describeTable(tableName);
    return !!desc[columnName];
  } catch (err) {
    // If describeTable fails, fall back to information_schema
    const [rows] = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :tableName
          AND column_name = :columnName
      ) AS "exists"`,
      {
        replacements: { tableName, columnName },
      }
    );
    const exists = Array.isArray(rows) && rows[0] ? rows[0].exists : false;
    return exists === true || exists === 't' || exists === 'true';
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // username
    if (!(await columnExists(queryInterface, 'users', 'username'))) {
      await queryInterface.addColumn('users', 'username', {
        type: Sequelize.STRING,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['username'], {
        unique: true,
        name: 'users_username_unique',
      });
    }

    // role (rbacService expects string roles like owner/admin/manager/operator/auditor/readonly/super_admin)
    if (!(await columnExists(queryInterface, 'users', 'role'))) {
      await queryInterface.addColumn('users', 'role', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'admin',
      });
      await addIndexIfNotExists(queryInterface, 'users', ['role'], {
        name: 'users_role_idx',
      });
    }

    // is_active
    if (!(await columnExists(queryInterface, 'users', 'is_active'))) {
      await queryInterface.addColumn('users', 'is_active', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['is_active'], {
        name: 'users_is_active_idx',
      });
    }

    // tenant_key
    if (!(await columnExists(queryInterface, 'users', 'tenant_key'))) {
      await queryInterface.addColumn('users', 'tenant_key', {
        type: Sequelize.STRING,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'users', ['tenant_key'], {
        name: 'users_tenant_key_idx',
      });
    }
  },

  async down(queryInterface) {
    // Down migrations are best-effort here (safe drops).
    try { await queryInterface.removeColumn('users', 'tenant_key'); } catch {}
    try { await queryInterface.removeColumn('users', 'is_active'); } catch {}
    try { await queryInterface.removeColumn('users', 'role'); } catch {}
    try { await queryInterface.removeColumn('users', 'username'); } catch {}
  },
};

