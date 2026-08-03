'use strict';

/**
 * Testes unitários do util verifyMetaSignature (X-Hub-Signature-256 da Meta).
 * Formato do header: "sha256=<hex HMAC-SHA256 do raw body com o appSecret>".
 * O util nunca lança exceção: qualquer entrada inválida retorna false.
 */

const crypto = require('crypto');
const { verifyMetaSignature } = require('../../api/utils/metaWebhookSignature');

const SECRET = 'app-secret-de-teste';
const RAW = JSON.stringify({ object: 'instagram', entry: [{ id: 'page-1' }] });

function sign(raw, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  test('assinatura válida é aceita', () => {
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: sign(RAW, SECRET), appSecret: SECRET })).toBe(true);
  });

  test('hex válido mas de outro corpo é rejeitado', () => {
    const other = sign('{"object":"instagram","entry":[]}', SECRET);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: other, appSecret: SECRET })).toBe(false);
  });

  test('hex válido mas com secret errado é rejeitado', () => {
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: sign(RAW, 'outro-secret'), appSecret: SECRET })).toBe(false);
  });

  test('header ausente é rejeitado', () => {
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: undefined, appSecret: SECRET })).toBe(false);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: '', appSecret: SECRET })).toBe(false);
  });

  test('prefixo sha256= ausente é rejeitado', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(RAW, 'utf8').digest('hex');
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: hex, appSecret: SECRET })).toBe(false);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: `sha1=${hex}`, appSecret: SECRET })).toBe(false);
  });

  test('hex com tamanho diferente é rejeitado (guard de length)', () => {
    const short = `sha256=${'a'.repeat(32)}`;
    const long = `sha256=${'a'.repeat(128)}`;
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: short, appSecret: SECRET })).toBe(false);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: long, appSecret: SECRET })).toBe(false);
  });

  test('payload não-hex é rejeitado sem lançar', () => {
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: 'sha256=zzzz-nao-eh-hex', appSecret: SECRET })).toBe(false);
  });

  test('secret ausente/vazio é rejeitado', () => {
    const header = sign(RAW, SECRET);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: header, appSecret: '' })).toBe(false);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: header, appSecret: undefined })).toBe(false);
    expect(verifyMetaSignature({ rawBody: RAW, signatureHeader: header, appSecret: null })).toBe(false);
  });

  test('rawBody vazio com assinatura correspondente é aceito', () => {
    expect(verifyMetaSignature({ rawBody: '', signatureHeader: sign('', SECRET), appSecret: SECRET })).toBe(true);
  });
});
