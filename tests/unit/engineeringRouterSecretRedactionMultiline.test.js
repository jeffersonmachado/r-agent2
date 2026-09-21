'use strict';

/**
 * ERV1-CLOSE-003 — SecretRedaction não detectava blocos multiline.
 *
 * Bug real: `redactContent` fazia `content.split('\n')` e aplicava os padrões de segredo LINHA
 * A LINHA. O padrão de chave privada (`-----BEGIN...[\s\S]*?...-----END...`) é multiline por
 * natureza — mas aplicado a uma única linha isolada, nenhuma linha contém "-----BEGIN" e
 * "-----END" ao mesmo tempo, então o padrão nunca casava nada. Uma chave privada colada inline
 * num arquivo de contexto (ex.: um runbook `.md`) passava intacta para o prompt do CODER/
 * REVIEWER.
 *
 * Corrigido: blocos multiline agora são redigidos sobre o CONTEÚDO INTEIRO antes do split em
 * linhas (ver `redactBlockSecrets` em secretRedaction.js).
 */

const { redactContent, redactText } = require('../../engine/engineeringRouter/secretRedaction');

const PEM_GENERIC = [
  'hello',
  '-----BEGIN PRIVATE KEY-----',
  'ABCDEF123456',
  'SECONDLINE789',
  '-----END PRIVATE KEY-----',
  'bye',
].join('\n');

const RSA_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEpQIBAAKCAQEA1234567890abcdef',
  'ANOTHERLINEOFBASE64DATA==',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

const OPENSSH_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==',
  '-----END OPENSSH PRIVATE KEY-----',
].join('\n');

describe('ERV1-CLOSE-003 — redação multiline de chaves privadas', () => {
  test('PEM genérico multiline é redigido, conteúdo ao redor preservado', () => {
    const { content, redactedLineCount } = redactContent(PEM_GENERIC);
    expect(content).toContain('[REDACTED:PRIVATE_KEY_BLOCK]');
    expect(content).not.toContain('ABCDEF123456');
    expect(content).not.toContain('SECONDLINE789');
    expect(content).not.toContain('-----BEGIN PRIVATE KEY-----');
    expect(content).toContain('hello');
    expect(content).toContain('bye');
    expect(redactedLineCount).toBeGreaterThan(0);
  });

  test('RSA private key multiline é redigida', () => {
    const { content } = redactContent(RSA_KEY);
    expect(content).toContain('[REDACTED:PRIVATE_KEY_BLOCK]');
    expect(content).not.toContain('MIIEpQIBAAKCAQEA1234567890abcdef');
    expect(content).not.toContain('ANOTHERLINEOFBASE64DATA==');
  });

  test('OpenSSH private key multiline é redigida', () => {
    const { content } = redactContent(OPENSSH_KEY);
    expect(content).toContain('[REDACTED:PRIVATE_KEY_BLOCK]');
    expect(content).not.toContain('b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==');
  });

  test('múltiplos blocos no mesmo conteúdo são todos redigidos', () => {
    const both = `${PEM_GENERIC}\n\n${RSA_KEY}`;
    const { content } = redactContent(both);
    expect((content.match(/\[REDACTED:PRIVATE_KEY_BLOCK\]/g) || []).length).toBe(2);
    expect(content).not.toContain('ABCDEF123456');
    expect(content).not.toContain('MIIEpQIBAAKCAQEA1234567890abcdef');
  });

  test('secrets de uma linha só (key=value) continuam redigidos junto com blocos multiline', () => {
    const mixed = `${PEM_GENERIC}\nSSH_PASSWORD=SenhaSuperSecreta123`;
    const { content } = redactContent(mixed);
    expect(content).toContain('[REDACTED:PRIVATE_KEY_BLOCK]');
    expect(content).toContain('[REDACTED:possible_secret]');
    expect(content).not.toContain('SenhaSuperSecreta123');
  });

  test('conteúdo normal sem segredo permanece idêntico (idempotência/sem falso positivo)', () => {
    const normal = 'function foo() {\n  return "hello world";\n}';
    const { content, redactedLineCount } = redactContent(normal);
    expect(content).toBe(normal);
    expect(redactedLineCount).toBe(0);
  });

  test('redação é idempotente (rodar duas vezes não muda o resultado)', () => {
    const once = redactContent(PEM_GENERIC).content;
    const twice = redactContent(once).content;
    expect(twice).toBe(once);
  });

  test('redactText (usado no output de subprocess) aplica a mesma redação multiline', () => {
    const out = redactText(RSA_KEY);
    expect(out).toContain('[REDACTED:PRIVATE_KEY_BLOCK]');
    expect(out).not.toContain('MIIEpQIBAAKCAQEA1234567890abcdef');
  });

  test('bearer token de uma linha só é redigido', () => {
    const { content } = redactContent('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
    expect(content).toContain('[REDACTED:BEARER_TOKEN]');
    expect(content).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });
});
