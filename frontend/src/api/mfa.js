import { fetchJson } from './client';

export function mfaSetup({ issuer, label } = {}) {
  return fetchJson('/auth/mfa/setup', {
    method: 'POST',
    body: JSON.stringify({ issuer, label }),
  });
}

export function mfaVerify(token) {
  if (!token) {
    return Promise.reject(new Error('mfaVerify: token é obrigatório'));
  }
  return fetchJson('/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function mfaDisable({ token, recoveryCode } = {}) {
  if (!token && !recoveryCode) {
    return Promise.reject(new Error('mfaDisable: token ou recoveryCode é obrigatório'));
  }
  return fetchJson('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ token, recoveryCode }),
  });
}

export function mfaRecovery(code) {
  if (!code) {
    return Promise.reject(new Error('mfaRecovery: code é obrigatório'));
  }
  return fetchJson('/auth/mfa/recovery', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
