'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ensureLocalSecrets,
  isValidEncryptionKey,
  isValidInternalToken,
  readEnvValue,
} = require('../../scripts/bootstrap/ensure-local-secrets');

describe('bootstrap local secrets', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-bootstrap-secrets-'));
    fs.mkdirSync(path.join(root, 'rag-service'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('gera chaves fortes e sincroniza o token do rag-service sem expor valores', () => {
    fs.writeFileSync(path.join(root, '.env'), 'ENCRYPTION_KEY=\n# RAG_INTERNAL_TOKEN=placeholder\n');

    const result = ensureLocalSecrets(root);
    const rootContent = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const ragContent = fs.readFileSync(path.join(root, 'rag-service', '.env'), 'utf8');
    const encryptionKey = readEnvValue(rootContent, 'ENCRYPTION_KEY');
    const ragToken = readEnvValue(rootContent, 'RAG_INTERNAL_TOKEN');
    const replaySigningKey = readEnvValue(rootContent, 'REPLAY_SIGNING_KEY');

    expect(result).toEqual({
      encryptionGenerated: true,
      ragTokenGenerated: true,
      ragTokenSynchronized: true,
      replaySigningKeyGenerated: true,
    });
    expect(isValidEncryptionKey(encryptionKey)).toBe(true);
    expect(isValidInternalToken(ragToken)).toBe(true);
    expect(isValidInternalToken(replaySigningKey)).toBe(true);
    // separação de chaves: a de assinatura de replay NÃO é a de criptografia
    expect(replaySigningKey).not.toBe(encryptionKey);
    expect(readEnvValue(ragContent, 'RAG_INTERNAL_TOKEN')).toBe(ragToken);
    expect(JSON.stringify(result)).not.toContain(encryptionKey);
    expect(JSON.stringify(result)).not.toContain(ragToken);
    expect(JSON.stringify(result)).not.toContain(replaySigningKey);
  });

  test('preserva valores válidos e é idempotente', () => {
    const encryptionKey = 'a'.repeat(64);
    const ragToken = 'b'.repeat(64);
    const replaySigningKey = 'c'.repeat(64);
    fs.writeFileSync(path.join(root, '.env'), `ENCRYPTION_KEY=${encryptionKey}\nRAG_INTERNAL_TOKEN=${ragToken}\nREPLAY_SIGNING_KEY=${replaySigningKey}\n`);
    fs.writeFileSync(path.join(root, 'rag-service', '.env'), `RAG_INTERNAL_TOKEN=${ragToken}\n`);

    expect(ensureLocalSecrets(root)).toEqual({
      encryptionGenerated: false,
      ragTokenGenerated: false,
      ragTokenSynchronized: false,
      replaySigningKeyGenerated: false,
    });
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'ENCRYPTION_KEY')).toBe(encryptionKey);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'RAG_INTERNAL_TOKEN')).toBe(ragToken);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'REPLAY_SIGNING_KEY')).toBe(replaySigningKey);
  });
});
