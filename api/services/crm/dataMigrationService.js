'use strict';

/**
 * Data Migration Service
 * Handles bulk import/export of CRM data
 * Supports CSV, JSON, and other formats
 */

const { Parser } = require('json2csv');
const Papa = require('papaparse');

/**
 * Import data from CSV or JSON
 */
async function importData(sequelize, tenantKey, importType, fileContent, fileFormat = 'json') {
  const CrmAccount = sequelize.models.CrmAccount;
  const CrmContact = sequelize.models.CrmContact;
  const CrmLead = sequelize.models.CrmLead;
  const CrmOpportunity = sequelize.models.CrmOpportunity;

  let data = [];

  // Parse file content
  if (fileFormat === 'csv') {
    const parsed = Papa.parse(fileContent, { header: true });
    data = parsed.data.filter((row) => Object.values(row).some((val) => val)); // Filter empty rows
  } else if (fileFormat === 'json') {
    data = JSON.parse(fileContent);
  } else {
    throw new Error(`Unsupported format: ${fileFormat}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Data must be an array');
  }

  const results = {
    importType,
    totalRecords: data.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  // Import based on type
  switch (importType) {
    case 'accounts':
      for (let i = 0; i < data.length; i++) {
        try {
          const record = data[i];
          await CrmAccount.create({
            id: `crmacc-${Date.now()}-${i}`,
            tenant_key: tenantKey,
            external_id: record.external_id,
            name: record.name,
            owner_user_id: record.owner_user_id,
            status: record.status || 'active',
            attributes: record.attributes,
          });
          results.successful++;
        } catch (err) {
          results.failed++;
          results.errors.push({ row: i, error: err.message });
        }
      }
      break;

    case 'contacts':
      for (let i = 0; i < data.length; i++) {
        try {
          const record = data[i];
          await CrmContact.create({
            id: `crmctt-${Date.now()}-${i}`,
            tenant_key: tenantKey,
            account_id: record.account_id,
            external_id: record.external_id,
            name: record.name,
            email: record.email,
            phone: record.phone,
            role: record.role,
            owner_user_id: record.owner_user_id,
            status: record.status || 'active',
            attributes: record.attributes,
          });
          results.successful++;
        } catch (err) {
          results.failed++;
          results.errors.push({ row: i, error: err.message });
        }
      }
      break;

    case 'leads':
      for (let i = 0; i < data.length; i++) {
        try {
          const record = data[i];
          await CrmLead.create({
            id: `crmled-${Date.now()}-${i}`,
            tenant_key: tenantKey,
            account_id: record.account_id,
            contact_id: record.contact_id,
            external_id: record.external_id,
            source: record.source,
            owner_user_id: record.owner_user_id,
            status: record.status || 'new',
            score: Number(record.score) || 0,
            attributes: record.attributes,
          });
          results.successful++;
        } catch (err) {
          results.failed++;
          results.errors.push({ row: i, error: err.message });
        }
      }
      break;

    default:
      throw new Error(`Unsupported import type: ${importType}`);
  }

  return results;
}

/**
 * Export data to CSV or JSON
 */
async function exportData(sequelize, tenantKey, exportType, format = 'json') {
  const Models = {
    accounts: sequelize.models.CrmAccount,
    contacts: sequelize.models.CrmContact,
    leads: sequelize.models.CrmLead,
    opportunities: sequelize.models.CrmOpportunity,
  };

  const Model = Models[exportType];
  if (!Model) {
    throw new Error(`Unsupported export type: ${exportType}`);
  }

  const records = await Model.findAll({
    where: { tenant_key: tenantKey },
    limit: 10000, // Safety limit
  });

  const data = records.map((r) => (r.toJSON ? r.toJSON() : r));

  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  } else if (format === 'csv') {
    if (data.length === 0) {
      return '';
    }

    const parser = new Parser();
    return parser.parse(data);
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Bulk update data
 */
async function bulkUpdate(sequelize, tenantKey, updateType, updates) {
  const Models = {
    accounts: sequelize.models.CrmAccount,
    contacts: sequelize.models.CrmContact,
    leads: sequelize.models.CrmLead,
    opportunities: sequelize.models.CrmOpportunity,
  };

  const Model = Models[updateType];
  if (!Model) {
    throw new Error(`Unsupported update type: ${updateType}`);
  }

  if (!Array.isArray(updates)) {
    throw new Error('Updates must be an array');
  }

  const results = {
    updateType,
    totalRecords: updates.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < updates.length; i++) {
    try {
      const { id, ...updateData } = updates[i];

      if (!id) {
        throw new Error('Record must have id');
      }

      const record = await Model.findOne({
        where: { tenant_key: tenantKey, id },
      });

      if (!record) {
        throw new Error(`Record not found: ${id}`);
      }

      await record.update(updateData);
      results.successful++;
    } catch (err) {
      results.failed++;
      results.errors.push({ record: i, error: err.message });
    }
  }

  return results;
}

/**
 * Duplicate detection and merge
 */
async function detectDuplicates(sequelize, tenantKey, entityType, threshold = 0.8) {
  const Model = sequelize.models[`Crm${entityType.charAt(0).toUpperCase() + entityType.slice(1).toLowerCase()}`];

  if (!Model) {
    throw new Error(`Unsupported entity type: ${entityType}`);
  }

  const records = await Model.findAll({
    where: { tenant_key: tenantKey },
  });

  const duplicates = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const record1 = records[i].toJSON ? records[i].toJSON() : records[i];
      const record2 = records[j].toJSON ? records[j].toJSON() : records[j];

      const similarity = calculateSimilarity(record1, record2);

      if (similarity >= threshold) {
        duplicates.push({
          record1Id: record1.id,
          record2Id: record2.id,
          similarity: Math.round(similarity * 100),
          matchedFields: findMatchedFields(record1, record2),
        });
      }
    }
  }

  return {
    entityType,
    totalRecords: records.length,
    duplicatesFound: duplicates.length,
    duplicates,
  };
}

/**
 * Calculate similarity between two records
 */
function calculateSimilarity(record1, record2) {
  const normalizedFields = ['name', 'email', 'phone', 'title', 'external_id'];
  let matches = 0;
  let fields = 0;

  for (const field of normalizedFields) {
    if (record1[field] && record2[field]) {
      fields++;
      const v1 = String(record1[field]).toLowerCase().trim();
      const v2 = String(record2[field]).toLowerCase().trim();

      if (v1 === v2 || levenshteinDistance(v1, v2) <= 2) {
        matches++;
      }
    }
  }

  return fields > 0 ? matches / fields : 0;
}

/**
 * Find which fields match between two records
 */
function findMatchedFields(record1, record2) {
  const matchedFields = [];
  const fieldsToCheck = ['name', 'email', 'phone', 'external_id'];

  for (const field of fieldsToCheck) {
    if (record1[field] && record2[field]) {
      const v1 = String(record1[field]).toLowerCase().trim();
      const v2 = String(record2[field]).toLowerCase().trim();

      if (v1 === v2) {
        matchedFields.push(field);
      }
    }
  }

  return matchedFields;
}

/**
 * Levenshtein distance for string similarity
 */
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) track[0][i] = i;
  for (let j = 0; j <= str2.length; j++) track[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator,
      );
    }
  }

  return track[str2.length][str1.length];
}

module.exports = {
  importData,
  exportData,
  bulkUpdate,
  detectDuplicates,
};
