const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const models = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { getRecordingPolicy } = require('./pbxRecordingPolicyService');
const { resolveRuntimePath } = require('../../utils/runtimePaths');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function getRecordingsRoot() {
  return process.env.PBX_RECORDINGS_DIR || resolveRuntimePath('pbx', 'recordings');
}

function parseRecordingFilename(fileName) {
  // esperado: <tenantKey>__<uniqueid>.wav
  const m = String(fileName).match(/^([a-zA-Z0-9_-]+)__([0-9.]+)\.wav$/);
  if (!m) return null;
  return { tenantKey: m[1], uniqueid: m[2] };
}

async function scanAndUpsertRecordings({ tenantKey }) {
  const Model = models.PbxRecording();
  const root = getRecordingsRoot();
  if (!fs.existsSync(root)) return { ok: true, scanned: 0, upserted: 0 };

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const wavs = entries.filter(e => e.isFile() && e.name.endsWith('.wav'));
  let upserted = 0;

  for (const e of wavs) {
    const parsed = parseRecordingFilename(e.name);
    if (!parsed) continue;
    if (parsed.tenantKey !== tenantKey) continue;

    const filePath = path.join(root, e.name);
    const stat = fs.statSync(filePath);
    const id = `rec-${tenantKey}-${parsed.uniqueid}`;

    const storage = {
      provider: 'local_volume',
      path: filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };

    const existing = await Model.findOne({ where: { id, tenantKey } });
    if (!existing) {
      await Model.create({
        id,
        tenantKey,
        uniqueid: parsed.uniqueid,
        direction: null,
        src: null,
        dst: null,
        storage,
        startedAt: null,
        endedAt: null,
      });
      upserted += 1;
    } else {
      await existing.update({ storage });
      upserted += 1;
    }
  }

  return { ok: true, scanned: wavs.length, upserted };
}

async function listRecordings({ tenantKey, limit = 200 }) {
  const Model = models.PbxRecording();
  const sequelize = getSequelize();
  const Op = sequelize ? sequelize.constructor.Op : null;
  const policyOut = await getRecordingPolicy({ tenantKey });
  if (!policyOut?.ok) {
    const err = new Error('recording_policy_unavailable');
    err.code = 'recording_policy_unavailable';
    throw err;
  }
  const policy = policyOut.policy || {};
  const rows = await Model.findAll({
    where: {
      tenantKey,
      ...(Op && Number(policy.retentionDays) > 0 ? {
        createdAt: { [Op.gte]: new Date(Date.now() - (Number(policy.retentionDays) * 24 * 60 * 60 * 1000)) },
      } : {}),
    },
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
  });
  return rows.map((r) => {
    const json = r.toJSON();
    if (policy.maskPhoneNumbers) {
      json.src = maskPhone(json.src);
      json.dst = maskPhone(json.dst);
    }
    return json;
  });
}

async function getRecordingFilePath({ tenantKey, id }) {
  const Model = models.PbxRecording();
  const policyOut = await getRecordingPolicy({ tenantKey });
  if (!policyOut?.ok) {
    const err = new Error('recording_policy_unavailable');
    err.code = 'recording_policy_unavailable';
    throw err;
  }
  const policy = policyOut.policy || {};
  if (!policy.enabled) {
    const err = new Error('recording_access_disabled');
    err.code = 'recording_access_disabled';
    throw err;
  }
  const row = await Model.findOne({ where: { id: String(id), tenantKey } });
  if (!row) return null;
  if (Number(policy.retentionDays) > 0) {
    const createdAtMs = new Date(row.createdAt).getTime();
    const cutoffMs = Date.now() - (Number(policy.retentionDays) * 24 * 60 * 60 * 1000);
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
      return null;
    }
  }
  const storage = row.storage || {};
  return storage.path || null;
}

async function registerRecordingFromPath({ tenantKey, filePath, uniqueid = null }) {
  const Model = models.PbxRecording();
  if (!filePath) throw Object.assign(new Error('filePath obrigatório'), { code: 'recording_file_required' });
  const stat = fs.statSync(filePath);
  const id = makeId('rec');
  const storage = { provider: 'local_volume', path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
  const row = await Model.create({
    id,
    tenantKey,
    uniqueid: uniqueid ? String(uniqueid).slice(0, 80) : null,
    direction: null,
    src: null,
    dst: null,
    storage,
    startedAt: null,
    endedAt: null,
  });
  return row.toJSON();
}

module.exports = {
  scanAndUpsertRecordings,
  listRecordings,
  getRecordingFilePath,
  registerRecordingFromPath,
};

function maskPhone(value) {
  const raw = value == null ? '' : String(value);
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return value;
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const keep = digits.slice(-4);
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${keep}`;
}
