'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function tableExists(queryInterface, tableName) {
  try {
    await queryInterface.describeTable(tableName);
    return true;
  } catch (_) {
    return false;
  }
}

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return !!table?.[columnName];
  } catch (_) {
    return false;
  }
}

async function addColumnIfMissing(queryInterface, tableName, columnName, spec) {
  if (!(await tableExists(queryInterface, tableName))) return;
  if (await columnExists(queryInterface, tableName, columnName)) return;
  await queryInterface.addColumn(tableName, columnName, spec);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'marketing_leads', 'location_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfMissing(queryInterface, 'marketing_form_submissions', 'location_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    if (await tableExists(queryInterface, 'marketing_leads')) {
      await queryInterface.sequelize.query(`
        UPDATE marketing_leads
        SET location_id = COALESCE(
          NULLIF(attributes->>'locationId', ''),
          NULLIF(attributes->>'location_id', ''),
          NULLIF(attributes->'context'->>'locationId', ''),
          NULLIF(attributes->'context'->>'location_id', '')
        )
        WHERE location_id IS NULL
      `).catch(() => {});

      await addIndexIfNotExists(queryInterface, 'marketing_leads', ['tenant_key', 'location_id'], {
        name: 'marketing_leads_tenant_location_id_idx',
      });
    }

    if (await tableExists(queryInterface, 'marketing_form_submissions')) {
      await queryInterface.sequelize.query(`
        UPDATE marketing_form_submissions AS mfs
        SET location_id = COALESCE(
          NULLIF(mfs.data->>'locationId', ''),
          NULLIF(mfs.data->>'location_id', ''),
          NULLIF(mfs.data->'context'->>'locationId', ''),
          NULLIF(mfs.data->'context'->>'location_id', ''),
          NULLIF(mf.settings->>'locationId', ''),
          NULLIF(mf.settings->>'location_id', '')
        )
        FROM marketing_forms AS mf
        WHERE mf.id = mfs.form_id
          AND mf.tenant_key = mfs.tenant_key
          AND mfs.location_id IS NULL
      `).catch(() => {});

      await addIndexIfNotExists(queryInterface, 'marketing_form_submissions', ['tenant_key', 'location_id'], {
        name: 'marketing_form_submissions_tenant_location_id_idx',
      });
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'marketing_form_submissions')) {
      await queryInterface.removeIndex('marketing_form_submissions', 'marketing_form_submissions_tenant_location_id_idx').catch(() => {});
      if (await columnExists(queryInterface, 'marketing_form_submissions', 'location_id')) {
        await queryInterface.removeColumn('marketing_form_submissions', 'location_id').catch(() => {});
      }
    }

    if (await tableExists(queryInterface, 'marketing_leads')) {
      await queryInterface.removeIndex('marketing_leads', 'marketing_leads_tenant_location_id_idx').catch(() => {});
      if (await columnExists(queryInterface, 'marketing_leads', 'location_id')) {
        await queryInterface.removeColumn('marketing_leads', 'location_id').catch(() => {});
      }
    }
  },
};