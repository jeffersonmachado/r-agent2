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

module.exports = {
  createVersion,
};

