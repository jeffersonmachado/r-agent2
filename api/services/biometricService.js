const crypto = require('crypto');

// -----------------------------------------------------------------------------
// BiometricRef v1
//
// Formato: "v1.<payloadB64Url>.<sigHex>"
// - payload: JSON UTF-8, base64url sem padding
// - sigHex: HMAC-SHA256(secret, payloadB64Url) em hex
//
// Payload mínimo esperado:
// {
//   v: 1,
//   ts: 1730000000000,          // epoch ms
//   nonce: "random-hex",        // evita replay imediato
//   tokenId: "pat-...",         // binding ao public token (id, não o token string)
//   locationId: "loja-1"|null,  // binding ao local (quando houver)
//   mode: "identify-1n" | "verify-1to1" | "dedupe-only",
//   subjectId: "cust:..." | "bio:..." | "anon:..."
// }
// -----------------------------------------------------------------------------

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecodeToString(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function timingSafeEqHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), 'hex');
    const b = Buffer.from(String(bHex), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function computeSigHex({ secret, payloadB64Url }) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(String(payloadB64Url))
    .digest('hex');
}

function signBiometricRef({ secret, payload }) {
  const payloadJson = JSON.stringify(payload || {});
  const payloadB64Url = base64urlEncode(payloadJson);
  const sigHex = computeSigHex({ secret, payloadB64Url });
  return `v1.${payloadB64Url}.${sigHex}`;
}

function parseBiometricRef(ref) {
  const s = String(ref || '');
  const parts = s.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    const err = new Error('invalid_biometric_ref_format');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_format';
    throw err;
  }
  return { v: 1, payloadB64Url: parts[1], sigHex: parts[2] };
}

function verifyBiometricRef({
  secret,
  ref,
  expectedTokenId,
  expectedLocationId = null,
  allowedModes = ['identify-1n', 'verify-1to1', 'dedupe-only'],
  maxAgeSec = 120,
}) {
  if (!secret) {
    const err = new Error('biometric_secret_missing');
    // @ts-ignore
    err.code = 'biometric_secret_missing';
    throw err;
  }

  const { payloadB64Url, sigHex } = parseBiometricRef(ref);
  const expectedSig = computeSigHex({ secret, payloadB64Url });
  if (!timingSafeEqHex(sigHex, expectedSig)) {
    const err = new Error('invalid_biometric_ref_signature');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_signature';
    throw err;
  }

  let payload = null;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64Url));
  } catch {
    const err = new Error('invalid_biometric_ref_payload');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_payload';
    throw err;
  }

  if (!payload || typeof payload !== 'object') {
    const err = new Error('invalid_biometric_ref_payload');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_payload';
    throw err;
  }

  if (payload.v !== 1) {
    const err = new Error('invalid_biometric_ref_version');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_version';
    throw err;
  }

  const ts = Number(payload.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    const err = new Error('invalid_biometric_ref_ts');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_ts';
    throw err;
  }

  const nonce = payload.nonce ? String(payload.nonce) : '';
  if (!nonce || nonce.length < 6) {
    const err = new Error('invalid_biometric_ref_nonce');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_nonce';
    throw err;
  }

  const tokenId = payload.tokenId ? String(payload.tokenId) : '';
  if (!tokenId || tokenId !== String(expectedTokenId || '')) {
    const err = new Error('invalid_biometric_ref_binding');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_binding';
    throw err;
  }

  const locationId = payload.locationId != null ? String(payload.locationId) : null;
  if (expectedLocationId != null && String(expectedLocationId) !== String(locationId)) {
    const err = new Error('invalid_biometric_ref_location');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_location';
    throw err;
  }

  const mode = payload.mode ? String(payload.mode) : '';
  if (!allowedModes.includes(mode)) {
    const err = new Error('invalid_biometric_ref_mode');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_mode';
    throw err;
  }

  const subjectId = payload.subjectId ? String(payload.subjectId) : '';
  if (!subjectId) {
    const err = new Error('invalid_biometric_ref_subject');
    // @ts-ignore
    err.code = 'invalid_biometric_ref_subject';
    throw err;
  }

  const now = Date.now();
  const ageMs = now - ts;
  if (ageMs < -30_000 || ageMs > maxAgeSec * 1000) {
    const err = new Error('biometric_ref_expired');
    // @ts-ignore
    err.code = 'biometric_ref_expired';
    throw err;
  }

  return {
    v: 1,
    ts,
    nonce,
    tokenId,
    locationId,
    mode,
    subjectId,
    raw: payload,
  };
}

module.exports = {
  signBiometricRef,
  verifyBiometricRef,
  _internal: {
    parseBiometricRef,
    computeSigHex,
  },
};

