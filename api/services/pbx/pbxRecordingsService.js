const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function getRecordingsRoot() {
  return process.env.PBX_RECORDINGS_DIR || path.resolve(__dirname, '../../data/pbx-recordings');
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
  const rows = await Model.findAll({
    where: { tenantKey },
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
  });
  return rows.map(r => r.toJSON());
}

async function getRecordingFilePath({ tenantKey, id }) {
  const Model = models.PbxRecording();
  const row = await Model.findOne({ where: { id: String(id), tenantKey } });
  if (!row) return null;
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

