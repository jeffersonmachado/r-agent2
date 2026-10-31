'use strict';

/**
 * ENCRYPTION_KEY — HEX **E** BASE64 (regressão de defeito real de ambiente/contrato).
 *
 * DEFEITO MEDIDO (2026-10-21, run 39673283430, passo L0b do gate): o bootstrap canônico
 * (`scripts/bootstrap/ensure-local-secrets.js`) considera válida e GERA a chave como 64
 * caracteres HEXADECIMAIS (`crypto.randomBytes(32).toString('hex')`, aceita por
 * `isValidEncryptionKey` via `/^[a-f0-9]{64}$/`). `api/utils/crypto.js` só decodificava BASE64 —
 * uma chave hex de 64 caracteres decodificada como base64 produz 48 bytes, então TODA cifragem de
 * credencial morria com "ENCRYPTION_KEY deve ter exatamente 32 bytes": 33 testes de 11 suítes de
 * integração vermelhos num ambiente que o próprio bootstrap declarou pronto. A mensagem de erro do
 * utilitário já prometia as duas formas; o código implementava uma.
 *
 * Estes testes fixam o contrato nos DOIS formatos e provam que a recusa continua fail-closed.
 */

const cryptoNode = require('crypto');
const { encrypt, decrypt } = require('../../api/utils/crypto');

const HEX_32_BYTES = cryptoNode.randomBytes(32).toString('hex');
const BASE64_32_BYTES = cryptoNode.randomBytes(32).toString('base64');
const SEGREDO = 'sk-teste-roundtrip-1234567890';

describe('ENCRYPTION_KEY — formatos aceitos', () => {
  const original = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  test('chave em HEX de 64 caracteres (a que o bootstrap gera) cifra e decifra', () => {
    expect(HEX_32_BYTES).toHaveLength(64);
    process.env.ENCRYPTION_KEY = HEX_32_BYTES;
    expect(decrypt(encrypt(SEGREDO))).toBe(SEGREDO);
  });

  test('chave em BASE64 de 32 bytes (formato histórico) continua funcionando', () => {
    process.env.ENCRYPTION_KEY = BASE64_32_BYTES;
    expect(decrypt(encrypt(SEGREDO))).toBe(SEGREDO);
  });

  test('hex MAIÚSCULO também é aceito (mesma chave, mesma semântica)', () => {
    process.env.ENCRYPTION_KEY = HEX_32_BYTES.toUpperCase();
    expect(decrypt(encrypt(SEGREDO))).toBe(SEGREDO);
  });

  test('chave com tamanho errado é RECUSADA com mensagem acionável (fail-closed)', () => {
    process.env.ENCRYPTION_KEY = 'chave-curta-demais';
    expect(() => encrypt(SEGREDO)).toThrow(/ENCRYPTION_KEY deve ter exatamente 32 bytes/);
  });

  test('sem chave configurada a recusa nomeia o que falta (nunca cifra sem segredo)', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt(SEGREDO)).toThrow(/ENCRYPTION_KEY não configurada/);
  });
});
