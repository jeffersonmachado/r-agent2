const crypto = require('crypto');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function stableJson(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashCredential(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlToString(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getDecisionSecret() {
  return String(process.env.ACCESS_CONTROL_DECISION_SECRET || process.env.PUBLIC_ACCESS_TOKEN_SECRET || 'r-agent2-access-control-secret');
}

function signPayload(payload) {
  const encoded = base64url(stableJson(payload));
  const signature = crypto
    .createHmac('sha256', getDecisionSecret())
    .update(encoded)
    .digest('hex');
  return `${encoded}.${signature}`;
}

function verifySignedPayload(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) {
    const err = new Error('invalid_signed_payload');
    err.code = 'invalid_signed_payload';
    throw err;
  }
  const expected = crypto
    .createHmac('sha256', getDecisionSecret())
    .update(encoded)
    .digest('hex');
  if (expected !== signature) {
    const err = new Error('invalid_signed_payload_signature');
    err.code = 'invalid_signed_payload_signature';
    throw err;
  }
  const payload = JSON.parse(base64urlToString(encoded));
  return payload;
}

function minutesFromTimeString(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function weekdayToken(date = new Date()) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}

function nowIso() {
  return new Date().toISOString();
}

function buildPseudoQrSvg(text) {
  const safeText = String(text || '').slice(0, 240);
  const bytes = crypto.createHash('sha256').update(safeText).digest();
  const size = 21;
  const cell = 6;
  const quiet = 4;
  const blocks = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size) + x;
      const on = ((bytes[idx % bytes.length] >> (idx % 8)) & 1) === 1;
      if (!on) continue;
      blocks.push(`<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}" fill="#111827" />`);
    }
  }
  const total = (size + (quiet * 2)) * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" role="img" aria-label="Access QR"><rect width="${total}" height="${total}" fill="#ffffff" />${blocks.join('')}</svg>`;
}

module.exports = {
  makeId,
  hashCredential,
  signPayload,
  verifySignedPayload,
  minutesFromTimeString,
  weekdayToken,
  nowIso,
  buildPseudoQrSvg,
};
