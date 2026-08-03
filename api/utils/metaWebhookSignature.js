'use strict';

const crypto = require('crypto');

/**
 * Verifica a assinatura X-Hub-Signature-256 enviada pela Meta nos webhooks
 * (Instagram / Messenger). Formato do header: "sha256=<hex>".
 *
 * Nunca lança exceção: qualquer entrada ausente ou malformada retorna false.
 *
 * @param {Object} params
 * @param {string} params.rawBody - Corpo bruto exato da requisição.
 * @param {string} [params.signatureHeader] - Valor do header X-Hub-Signature-256.
 * @param {string} [params.appSecret] - App Secret do app Meta.
 * @returns {boolean}
 */
function verifyMetaSignature({ rawBody, signatureHeader, appSecret }) {
  try {
    const secret = String(appSecret || '');
    if (!secret) return false;

    const header = String(signatureHeader || '');
    const PREFIX = 'sha256=';
    if (!header.startsWith(PREFIX)) return false;

    const providedHex = header.slice(PREFIX.length).trim();
    if (!/^[0-9a-fA-F]{64}$/.test(providedHex)) return false;

    const expected = crypto.createHmac('sha256', secret).update(String(rawBody ?? ''), 'utf8').digest();
    const provided = Buffer.from(providedHex, 'hex');
    if (provided.length !== expected.length) return false;

    return crypto.timingSafeEqual(provided, expected);
  } catch (_) {
    return false;
  }
}

module.exports = {
  verifyMetaSignature,
};
