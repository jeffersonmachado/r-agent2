const models = require('../../db/models');

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function listCdr({ tenantKey, filters = {} }) {
  const Model = models.PbxCdr();
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 2000);
  const Op = Model.sequelize.constructor.Op;

  const where = { tenantKey };
  if (filters.uniqueid) where.uniqueid = String(filters.uniqueid);
  if (filters.src) where.src = String(filters.src);
  if (filters.dst) where.dst = String(filters.dst);

  const from = toDateOrNull(filters.from);
  const to = toDateOrNull(filters.to);
  if (from || to) {
    where.calldate = {};
    if (from) where.calldate[Op.gte] = from;
    if (to) where.calldate[Op.lte] = to;
  }

  const rows = await Model.findAll({
    where,
    order: [['calldate', 'DESC']],
    limit,
  });
  return rows.map(r => r.toJSON());
}

module.exports = {
  listCdr,
};

