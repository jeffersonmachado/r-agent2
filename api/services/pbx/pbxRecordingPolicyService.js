const { getSetting, upsertSetting } = require('../tenantSettingsService');

const POLICY_KEY = 'pbx-recording-policy';

function intEnv(name, fallback) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return !!fallback;
}

function defaultPolicy() {
  return {
    enabled: boolEnv('PBX_RECORDING_ENABLED', false),
    retentionDays: intEnv('PBX_RECORDING_RETENTION_DAYS', 30),
    maskPhoneNumbers: boolEnv('PBX_RECORDING_MASK_PHONE_NUMBERS', true),
    requireConsent: boolEnv('PBX_RECORDING_REQUIRE_CONSENT', false),
  };
}

function normalizePolicy(input) {
  const base = defaultPolicy();
  const raw = input && typeof input === 'object' ? input : {};
  const retention = Number(raw.retentionDays);
  const retentionDays = Number.isFinite(retention)
    ? Math.min(Math.max(Math.floor(retention), 1), 3650)
    : base.retentionDays;
  return {
    enabled: raw.enabled != null ? !!raw.enabled : base.enabled,
    retentionDays,
    maskPhoneNumbers: raw.maskPhoneNumbers != null ? !!raw.maskPhoneNumbers : base.maskPhoneNumbers,
    requireConsent: raw.requireConsent != null ? !!raw.requireConsent : base.requireConsent,
  };
}

async function getRecordingPolicy({ tenantKey }) {
  const out = await getSetting({ tenantId: tenantKey, key: POLICY_KEY });
  if (!out || !out.ok) {
    return {
      ok: true,
      policy: defaultPolicy(),
      warning: out?.error || 'settings_unavailable',
      fallback: true,
    };
  }
  return { ok: true, policy: normalizePolicy(out.value || null) };
}

async function setRecordingPolicy({ tenantKey, policy }) {
  const nextPolicy = normalizePolicy(policy);
  const out = await upsertSetting({ tenantId: tenantKey, key: POLICY_KEY, value: nextPolicy });
  if (!out || !out.ok) return { ok: false, error: out?.error || 'settings_unavailable' };
  return { ok: true, policy: normalizePolicy(out.value || nextPolicy) };
}

module.exports = {
  POLICY_KEY,
  getRecordingPolicy,
  setRecordingPolicy,
  normalizePolicy,
};
