const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const models = require('../../db/models');

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeErrorField(error, field, fallback = '') {
  let value;
  try {
    value = error?.[field];
  } catch (_) {
    value = null;
  }
  if (value !== null && value !== undefined) return safeString(value, fallback);
  return fallback;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const cleaned = s.replace(/[^a-z0-9._\\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 120) || 'audio';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getMediaRoot() {
  return process.env.PBX_MEDIA_DIR || path.resolve(__dirname, '../../data/pbx-media');
}

async function ffmpegConvertToWav({ inputPath, outputPath }) {
  // Converte para WAV 8kHz mono (compatível com Asterisk).
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ac', '1',
      '-ar', '8000',
      '-f', 'wav',
      outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString('utf8'); });
    p.on('error', (e) => reject(Object.assign(e, { code: 'ffmpeg_spawn_error' })));
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`ffmpeg failed (code=${code})`), { code: 'ffmpeg_failed', details: err.slice(-2000) }));
    });
  });
}

async function listAudioAssets({ tenantKey, kind = null }) {
  const Model = models.PbxAudioAsset();
  const where = { tenantKey };
  if (kind) where.kind = String(kind);
  const rows = await Model.findAll({ where, order: [['updatedAt', 'DESC']] });
  return rows.map(r => r.toJSON());
}

async function createAudioAssetFromUpload({
  tenantKey,
  kind,
  filename,
  mimeType,
  buffer,
  actorUserId = null,
}) {
  const Model = models.PbxAudioAsset();
  const k = String(kind || '').trim();
  if (!k) throw Object.assign(new Error('kind é obrigatório'), { code: 'audio_kind_required' });
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error('arquivo é obrigatório'), { code: 'audio_file_required' });
  }

  const mediaRoot = getMediaRoot();
  const baseName = safeSlug(path.parse(filename || 'audio').name);
  const id = makeId('pbx_audio');
  const tenantDir = path.join(mediaRoot, tenantKey, k);
  ensureDir(tenantDir);

  const rawExt = safeSlug(path.extname(filename || '').replace('.', '')) || 'bin';
  const rawPath = path.join(tenantDir, `${id}__${baseName}.${rawExt}`);
  fs.writeFileSync(rawPath, buffer);

  // Sempre tenta gerar WAV 8k mono (para Playback/Queue/URA).
  const wavPath = path.join(tenantDir, `${id}__${baseName}.wav`);
  let converted = false;
  let convertError = null;
  try {
    await ffmpegConvertToWav({ inputPath: rawPath, outputPath: wavPath });
    converted = true;
  } catch (err) {
    convertError = {
      code: safeErrorField(err, 'code', 'convert_error') || 'convert_error',
      message: safeErrorField(err, 'message', 'convert failed') || 'convert failed',
    };
  }

  const storage = {
    provider: 'local_volume',
    tenantKey,
    kind: k,
    raw: {
      path: rawPath,
      mimeType: mimeType || 'application/octet-stream',
      size: buffer.length,
    },
    wav: converted ? { path: wavPath, mimeType: 'audio/wav' } : null,
    convertError,
  };

  const row = await Model.create({
    id,
    tenantKey,
    kind: k,
    name: `${baseName}.wav`,
    storage,
  });

  void actorUserId;
  return row.toJSON();
}

function resolveAudioFilePath(assetRow) {
  const storage = assetRow?.storage || {};
  if (storage?.wav?.path) return storage.wav.path;
  if (storage?.raw?.path) return storage.raw.path;
  return null;
}

module.exports = {
  listAudioAssets,
  createAudioAssetFromUpload,
  resolveAudioFilePath,
};

