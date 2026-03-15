const {
  AccessSubject,
  AccessMembership,
  AccessCredential,
  AccessPolicy,
  AccessDevice,
  AccessDecision,
  AccessEvent,
} = require('../../db/models');

function toJson(row) {
  return row && row.toJSON ? row.toJSON() : row;
}

async function listRows(factory, { tenantId, where = {}, order = [['created_at', 'DESC']], limit = 200 } = {}) {
  const Model = factory();
  const rows = await Model.findAll({
    where: {
      tenant_key: tenantId,
      ...where,
    },
    order,
    limit,
  });
  return rows.map(toJson);
}

async function findOne(factory, { tenantId, where = {} } = {}) {
  const Model = factory();
  const row = await Model.findOne({
    where: {
      tenant_key: tenantId,
      ...where,
    },
  });
  return toJson(row);
}

async function createRow(factory, payload) {
  const Model = factory();
  const row = await Model.create(payload);
  return toJson(row);
}

async function patchRow(factory, { tenantId, id, values }) {
  const Model = factory();
  const row = await Model.findOne({
    where: {
      tenant_key: tenantId,
      id: String(id),
    },
  });
  if (!row) return null;
  await row.update(values);
  return toJson(row);
}

module.exports = {
  listSubjects: (args) => listRows(AccessSubject, args),
  findSubject: (args) => findOne(AccessSubject, args),
  createSubject: (payload) => createRow(AccessSubject, payload),
  patchSubject: (args) => patchRow(AccessSubject, args),
  listMemberships: (args) => listRows(AccessMembership, args),
  findMembership: (args) => findOne(AccessMembership, args),
  createMembership: (payload) => createRow(AccessMembership, payload),
  patchMembership: (args) => patchRow(AccessMembership, args),
  listCredentials: (args) => listRows(AccessCredential, args),
  findCredential: (args) => findOne(AccessCredential, args),
  createCredential: (payload) => createRow(AccessCredential, payload),
  patchCredential: (args) => patchRow(AccessCredential, args),
  listPolicies: (args) => listRows(AccessPolicy, args),
  findPolicy: (args) => findOne(AccessPolicy, args),
  createPolicy: (payload) => createRow(AccessPolicy, payload),
  patchPolicy: (args) => patchRow(AccessPolicy, args),
  listDevices: (args) => listRows(AccessDevice, args),
  findDevice: (args) => findOne(AccessDevice, args),
  createDevice: (payload) => createRow(AccessDevice, payload),
  patchDevice: (args) => patchRow(AccessDevice, args),
  listDecisions: (args) => listRows(AccessDecision, args),
  findDecision: (args) => findOne(AccessDecision, args),
  createDecision: (payload) => createRow(AccessDecision, payload),
  patchDecision: (args) => patchRow(AccessDecision, args),
  listEvents: (args) => listRows(AccessEvent, args),
  findEvent: (args) => findOne(AccessEvent, args),
  createEvent: (payload) => createRow(AccessEvent, payload),
  patchEvent: (args) => patchRow(AccessEvent, args),
};
