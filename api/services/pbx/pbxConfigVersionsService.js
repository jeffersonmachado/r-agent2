const crypto = require('crypto');
const models = require('../../db/models');

function makeId() {
  return `pbxv-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function nextVersion({ tenantKey }) {
  const PbxConfigVersion = models.PbxConfigVersion();
  const row = await PbxConfigVersion.findOne({
    where: { tenantKey },
    order: [['version', 'DESC']],
  });
  const cur = row && row.version != null ? Number(row.version) : 0;
  return (Number.isFinite(cur) ? cur : 0) + 1;
}

async function createVersion({
  tenantKey,
  status = 'draft',
  summary = {},
  createdByUserId = null,
}) {
  const PbxConfigVersion = models.PbxConfigVersion();
  const version = await nextVersion({ tenantKey });
  const row = await PbxConfigVersion.create({
    id: makeId(),
    tenantKey,
    version,
    status,
    summary: summary || {},
    createdByUserId,
  });
  return row.toJSON ? row.toJSON() : row;
}

async function listVersions({ tenantKey, limit = 20 }) {
  const PbxConfigVersion = models.PbxConfigVersion();
  const rows = await PbxConfigVersion.findAll({
    where: { tenantKey },
    order: [['version', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 20, 1), 200),
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function getVersionByNumber({ tenantKey, version }) {
  const PbxConfigVersion = models.PbxConfigVersion();
  const row = await PbxConfigVersion.findOne({
    where: { tenantKey, version: Number(version) },
  });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

module.exports = {
  createVersion,
  listVersions,
  getVersionByNumber,
};
