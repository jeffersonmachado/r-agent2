const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/crypto');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}
const { getSequelize } = require('../db/sequelize');
const { User: UserGetter } = require('../db/models');

const MFA_STEP_SECONDS = 30;
const MFA_DIGITS = 6;
const MFA_WINDOW = 1;
const RECOVERY_CODES_COUNT = 8;

function dbAvailable() {
  return !!getSequelize();
}

function getUserModel() {
  return typeof UserGetter === 'function' ? UserGetter() : UserGetter;
}

function hashCode(value) {
  return crypto.createHash('sha256').update(safeToString(value), 'utf8').digest('hex');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      const index = (value >> (bits - 5)) & 31;
      output += BASE32_ALPHABET[index];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = safeToString(input || '').replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const ch of clean) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateSecret() {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

function buildOtpAuthUrl({ secret, label, issuer }) {
  const safeIssuer = issuer ? safeTrim(issuer) : 'ChatPro';
  const safeLabel = label ? safeTrim(label) : 'Conta';
  const encodedLabel = encodeURIComponent(`${safeIssuer}:${safeLabel}`);
  const encodedIssuer = encodeURIComponent(safeIssuer);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${MFA_DIGITS}&period=${MFA_STEP_SECONDS}`;
}

function generateTotp(secret, timestamp = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / MFA_STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % 10 ** MFA_DIGITS;
  return String(otp).padStart(MFA_DIGITS, '0');
}

function verifyTotp(token, secret) {
  const clean = safeToString(token || '').replace(/\s+/g, '');
  if (!clean) return false;
  const now = Date.now();
  for (let w = -MFA_WINDOW; w <= MFA_WINDOW; w += 1) {
    const ts = now + w * MFA_STEP_SECONDS * 1000;
    if (generateTotp(secret, ts) === clean) return true;
  }
  return false;
}

function generateRecoveryCode() {
  const raw = crypto.randomBytes(6).toString('hex').slice(0, 10).toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODES_COUNT; i += 1) {
    codes.push(generateRecoveryCode());
  }
  return codes;
}

async function setupMfa({ agentId, issuer, label }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const UserModel = getUserModel();
  const user = await UserModel.findByPk(agentId);
  if (!user) return { ok: false, error: 'user_not_found' };

  if (user.mfa_enabled) return { ok: false, error: 'mfa_already_enabled' };

  const secret = generateSecret();
  const otpauthUrl = buildOtpAuthUrl({ secret, label: label || user.email || user.username || 'Conta', issuer });
  const recoveryCodes = generateRecoveryCodes();
  const recoveryPayload = recoveryCodes.map((code) => ({
    hash: hashCode(code),
    used: false,
    usedAt: null,
  }));

  const tempExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await user.update({
    mfa_temp_secret_encrypted: encrypt(secret),
    mfa_temp_expires_at: tempExpiresAt,
    mfa_recovery_codes: recoveryPayload,
  });

  return {
    ok: true,
    secret,
    otpauthUrl,
    recoveryCodes,
    expiresAt: tempExpiresAt.toISOString(),
  };
}

async function verifyMfa({ agentId, token }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const UserModel = getUserModel();
  const user = await UserModel.findByPk(agentId);
  if (!user) return { ok: false, error: 'user_not_found' };

  if (!user.mfa_temp_secret_encrypted) return { ok: false, error: 'mfa_setup_required' };
  if (user.mfa_temp_expires_at && new Date(user.mfa_temp_expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'mfa_setup_expired' };
  }

  let secret;
  try {
    secret = decrypt(user.mfa_temp_secret_encrypted);
  } catch (err) {
    return { ok: false, error: 'mfa_secret_invalid' };
  }

  if (!verifyTotp(token, secret)) {
    return { ok: false, error: 'mfa_invalid_token' };
  }

  await user.update({
    mfa_enabled: true,
    mfa_secret_encrypted: user.mfa_temp_secret_encrypted,
    mfa_temp_secret_encrypted: null,
    mfa_temp_expires_at: null,
  });

  return { ok: true };
}

function validateRecoveryCode(code, payload) {
  const list = Array.isArray(payload) ? payload : [];
  const hash = hashCode(code);
  const entry = list.find((item) => item && item.hash === hash);
  return { entry, list };
}

async function consumeRecoveryCode({ agentId, code }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const UserModel = getUserModel();
  const user = await UserModel.findByPk(agentId);
  if (!user) return { ok: false, error: 'user_not_found' };
  if (!user.mfa_enabled || !user.mfa_recovery_codes) return { ok: false, error: 'mfa_not_enabled' };

  const { entry, list } = validateRecoveryCode(code, user.mfa_recovery_codes);
  if (!entry || entry.used) return { ok: false, error: 'recovery_invalid' };

  entry.used = true;
  entry.usedAt = new Date().toISOString();

  await user.update({ mfa_recovery_codes: list });

  const remaining = list.filter((item) => item && !item.used).length;
  return { ok: true, remaining };
}

async function disableMfa({ agentId, token, recoveryCode }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const UserModel = getUserModel();
  const user = await UserModel.findByPk(agentId);
  if (!user) return { ok: false, error: 'user_not_found' };

  if (!user.mfa_enabled || !user.mfa_secret_encrypted) return { ok: false, error: 'mfa_not_enabled' };

  let allowed = false;
  if (token) {
    try {
      const secret = decrypt(user.mfa_secret_encrypted);
      allowed = verifyTotp(token, secret);
    } catch (err) {
      allowed = false;
    }
  }

  if (!allowed && recoveryCode) {
    const { entry } = validateRecoveryCode(recoveryCode, user.mfa_recovery_codes);
    if (entry && !entry.used) {
      entry.used = true;
      entry.usedAt = new Date().toISOString();
      allowed = true;
      await user.update({ mfa_recovery_codes: user.mfa_recovery_codes });
    }
  }

  if (!allowed) return { ok: false, error: 'mfa_invalid_token' };

  await user.update({
    mfa_enabled: false,
    mfa_secret_encrypted: null,
    mfa_temp_secret_encrypted: null,
    mfa_temp_expires_at: null,
    mfa_recovery_codes: null,
  });

  return { ok: true };
}

module.exports = {
  setupMfa,
  verifyMfa,
  disableMfa,
  consumeRecoveryCode,
};
