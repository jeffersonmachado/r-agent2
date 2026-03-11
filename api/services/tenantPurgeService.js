const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const models = require('../db/models');

function getTenantModel() {
  const tenantFactory = models.Tenant || models.getTenant;
  return typeof tenantFactory === 'function' ? tenantFactory() : tenantFactory;
}

async function listTenantAwareColumns({ sequelize, transaction }) {
  const [rows] = await sequelize.query(
    `
    SELECT c.table_name, c.column_name, c.udt_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'tenants'
      AND c.column_name IN ('tenant_key', 'tenant_id')
    ORDER BY c.table_name, c.column_name
    `,
    { transaction }
  );
  return Array.isArray(rows) ? rows : [];
}

function groupColumnsByTable(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.table_name)) {
      grouped.set(row.table_name, []);
    }
    grouped.get(row.table_name).push(row);
  }
  return grouped;
}

function buildTenantDeletePredicate(columns, tenantKey, tenantUuid) {
  const clauses = [];
  const replacements = {};
  let idx = 0;

  for (const col of columns) {
    const isUuidColumn = String(col.udt_name || '').toLowerCase() === 'uuid';
    const tenantValue = isUuidColumn ? tenantUuid : tenantKey;
    if (!tenantValue) continue;
    const param = `tenant_${idx++}`;
    replacements[param] = String(tenantValue);
    clauses.push(`"${col.column_name}" = :${param}`);
  }

  return {
    whereSql: clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0] || null,
    replacements,
  };
}

async function purgeTenantData({ tenantKey, tenantRecord = null, transaction: externalTransaction = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('PostgreSQL não está disponível. O banco de dados é obrigatório.');
  }

  if (!tenantKey || typeof tenantKey !== 'string' || tenantKey.trim() === '') {
    throw new Error('tenantKey é obrigatório para purge de tenant');
  }

  const Tenant = getTenantModel();
  const ownTransaction = !externalTransaction;
  const transaction = externalTransaction || await sequelize.transaction();

  try {
    const tenant = tenantRecord || await Tenant.findOne({
      where: { tenant_key: tenantKey },
      transaction,
    });

    if (!tenant) {
      throw new Error('Tenant não encontrado');
    }

    const tenantUuid = tenant.id || tenant.dataValues?.id || null;
    const tenantColumns = await listTenantAwareColumns({ sequelize, transaction });
    const groupedTables = groupColumnsByTable(tenantColumns);

    for (const [tableName, columns] of groupedTables.entries()) {
      const { whereSql, replacements } = buildTenantDeletePredicate(columns, tenantKey, tenantUuid);
      if (!whereSql) continue;
      await sequelize.query(
        `DELETE FROM "${tableName}" WHERE ${whereSql}`,
        { replacements, transaction }
      );
    }

    await tenant.destroy({ transaction });

    if (ownTransaction) {
      await transaction.commit();
    }

    logger.info('[TenantPurgeService] Tenant purgado com sucesso', {
      tenantKey,
      tenantUuid,
      tablesTouched: groupedTables.size,
    });

    return {
      success: true,
      tenantKey,
      tenantUuid,
      tablesTouched: groupedTables.size,
    };
  } catch (err) {
    if (ownTransaction) {
      await transaction.rollback();
    }
    logger.error('[TenantPurgeService] Erro ao purgar tenant', {
      tenantKey,
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  purgeTenantData,
  _internal: {
    listTenantAwareColumns,
    groupColumnsByTable,
    buildTenantDeletePredicate,
  },
};
