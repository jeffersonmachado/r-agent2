/**
 * Hardening multi-tenant: users.tenant_key NOT NULL
 *
 * Regras:
 * - Não permite usuários sem tenant_key em runtime.
 * - Backfill apenas para super-admin (is_superadmin=true) -> 'system'
 * - Se ainda houver tenant_key NULL após backfill, falha a migration para evitar atribuição silenciosa.
 */
 
'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  const desc = await queryInterface.describeTable(tableName);
  return !!desc[columnName];
}

module.exports = {
  async up(queryInterface) {
    if (!(await columnExists(queryInterface, 'users', 'tenant_key'))) {
      // Nada a fazer (schema antigo)
      return;
    }

    // Backfill seguro: apenas super-admins sem tenant recebem 'system'
    await queryInterface.sequelize.query(
      `
      UPDATE users
      SET tenant_key = 'system'
      WHERE tenant_key IS NULL
        AND (is_superadmin = true)
      `
    );

    // Bloqueia se ainda existirem usuários sem tenant
    const [rows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE tenant_key IS NULL`
    );
    const missingCount = Array.isArray(rows) && rows[0] ? rows[0].count : 0;
    if (missingCount > 0) {
      throw new Error(
        `Migration hardening: existem ${missingCount} usuário(s) com tenant_key NULL. Corrija antes de aplicar NOT NULL.`
      );
    }

    // Aplica NOT NULL (idempotente)
    await queryInterface.sequelize.query(
      `ALTER TABLE users ALTER COLUMN tenant_key SET NOT NULL`
    );
  },

  async down(queryInterface) {
    try {
      if (await columnExists(queryInterface, 'users', 'tenant_key')) {
        await queryInterface.sequelize.query(
          `ALTER TABLE users ALTER COLUMN tenant_key DROP NOT NULL`
        );
      }
    } catch {
      // best-effort
    }
  },
};

