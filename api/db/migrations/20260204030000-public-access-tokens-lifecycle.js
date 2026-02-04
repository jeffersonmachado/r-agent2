/**
 * Migration: Extend public_access_tokens lifecycle
 *
 * Adds:
 * - expires_at: optional expiration
 * - revoked_at: explicit revocation timestamp
 * - last_used_at: best-effort usage tracking
 * - rotated_from_id: link to previous token id when rotated
 */
 
'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    // Columns (safe, idempotent)
    await queryInterface.sequelize.query(
      'ALTER TABLE public_access_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE public_access_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE public_access_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NULL;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE public_access_tokens ADD COLUMN IF NOT EXISTS rotated_from_id VARCHAR(255) NULL;'
    );

    // Indexes (safe)
    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['tenant_key', 'kind', 'active'], {
      name: 'public_access_tokens_tenant_kind_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['expires_at'], {
      name: 'public_access_tokens_expires_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['last_used_at'], {
      name: 'public_access_tokens_last_used_at_idx',
    });
  },

  async down(queryInterface) {
    // Drop columns (safe)
    await queryInterface.sequelize.query('ALTER TABLE public_access_tokens DROP COLUMN IF EXISTS rotated_from_id;');
    await queryInterface.sequelize.query('ALTER TABLE public_access_tokens DROP COLUMN IF EXISTS last_used_at;');
    await queryInterface.sequelize.query('ALTER TABLE public_access_tokens DROP COLUMN IF EXISTS revoked_at;');
    await queryInterface.sequelize.query('ALTER TABLE public_access_tokens DROP COLUMN IF EXISTS expires_at;');

    // Indexes will be dropped automatically with columns in most cases, but avoid failing if they don't exist.
    try { await queryInterface.removeIndex('public_access_tokens', 'public_access_tokens_tenant_kind_active_idx'); } catch (_) {}
    try { await queryInterface.removeIndex('public_access_tokens', 'public_access_tokens_expires_at_idx'); } catch (_) {}
    try { await queryInterface.removeIndex('public_access_tokens', 'public_access_tokens_last_used_at_idx'); } catch (_) {}
  },
};

