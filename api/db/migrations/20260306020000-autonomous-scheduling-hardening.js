'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return !!table?.[columnName];
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const hasMinGapDuration = await columnExists(queryInterface, 'autonomous_schedule_policies', 'min_gap_duration_minutes');
    if (!hasMinGapDuration) {
      await queryInterface.addColumn('autonomous_schedule_policies', 'min_gap_duration_minutes', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 30,
      });
    }

    const hasGapFingerprint = await columnExists(queryInterface, 'autonomous_gap_campaigns', 'gap_fingerprint');
    if (!hasGapFingerprint) {
      await queryInterface.addColumn('autonomous_gap_campaigns', 'gap_fingerprint', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }

    await addIndexIfNotExists(queryInterface, 'autonomous_gap_campaigns', ['tenant_key', 'gap_fingerprint'], {
      name: 'autonomous_gap_campaigns_tenant_fingerprint_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_gap_candidates', ['tenant_key', 'campaign_id', 'contact_id'], {
      name: 'autonomous_gap_candidates_tenant_campaign_contact_uidx',
      unique: true,
    });
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeColumn('autonomous_schedule_policies', 'min_gap_duration_minutes');
    } catch (_) {}
    try {
      await queryInterface.removeIndex('autonomous_gap_candidates', 'autonomous_gap_candidates_tenant_campaign_contact_uidx');
    } catch (_) {}
    try {
      await queryInterface.removeIndex('autonomous_gap_campaigns', 'autonomous_gap_campaigns_tenant_fingerprint_uidx');
    } catch (_) {}
    try {
      await queryInterface.removeColumn('autonomous_gap_campaigns', 'gap_fingerprint');
    } catch (_) {}
  },
};
