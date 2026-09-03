'use strict';

/**
 * Testes do release-attestation (Ed25519) — autenticação real do release.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-att-keys-'));
process.env.RAP_RELEASE_KEY_DIR = KEY_DIR;

const {
  generateKeyPair,
  signAttestation,
  verifyAttestation,
  canonicalJson,
  publicKeyFingerprint,
} = require('../../../governance/release-attestation');

const FIELDS = {
  releaseId: '20260101-000000',
  runId: 'rap-governed-test',
  sourceFingerprint: 'a'.repeat(64),
  gitCommit: 'b'.repeat(40),
  gitTree: 'c'.repeat(40),
  payloadSha256: 'd'.repeat(64),
  manifestSha256: 'e'.repeat(64),
  finalDecision: 'AUTONOMOUS_READY_GO',
};

describe('release-attestation — canonicalJson', () => {
  test('ordem de chaves é determinística e recursiva', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ z: [1, { b: 2, a: 1 }] })).toBe('{"z":[1,{"a":1,"b":2}]}');
  });
});

describe('release-attestation — ciclo sign/verify', () => {
  beforeAll(() => { generateKeyPair({ force: true }); });
  afterAll(() => { fs.rmSync(KEY_DIR, { recursive: true, force: true }); });

  test('keygen cria par no runtime root (privada 0600), nunca no pacote', () => {
    const priv = path.join(KEY_DIR, 'release-attestation-private.pem');
    const pub = path.join(KEY_DIR, 'release-attestation-public.pem');
    expect(fs.existsSync(priv)).toBe(true);
    expect(fs.existsSync(pub)).toBe(true);
    expect((fs.statSync(priv).mode & 0o777)).toBe(0o600);
  });

  test('assinatura válida verifica', () => {
    const sig = signAttestation(FIELDS);
    expect(sig.algorithm).toBe('ed25519');
    expect(verifyAttestation(sig).ok).toBe(true);
  });

  test('modificar qualquer campo coberto invalida a assinatura', () => {
    const sig = signAttestation(FIELDS);
    for (const field of Object.keys(FIELDS)) {
      const tampered = {
        ...sig,
        attestation: { ...sig.attestation, [field]: 'x'.repeat(40) },
      };
      tampered.canonicalPayload = canonicalJson(tampered.attestation);
      const result = verifyAttestation(tampered);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('SIGNATURE');
    }
  });

  test('canonicalPayload adulterado sem recompute é rejeitado', () => {
    const sig = signAttestation(FIELDS);
    const tampered = { ...sig, canonicalPayload: sig.canonicalPayload.replace('GO', 'NO') };
    expect(verifyAttestation(tampered).ok).toBe(false);
  });

  test('publicKeyFingerprint divergente é rejeitado', () => {
    const sig = signAttestation(FIELDS);
    const tampered = { ...sig, publicKeyFingerprint: '0'.repeat(64) };
    const result = verifyAttestation(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SIGNATURE_KEY_MISMATCH');
  });

  test('campo obrigatório ausente no atestado → erro explícito', () => {
    expect(() => signAttestation({ ...FIELDS, runId: null })).toThrow('release_attestation_field_missing');
  });

  test('fingerprint da pública é estável', () => {
    const pub = fs.readFileSync(path.join(KEY_DIR, 'release-attestation-public.pem'), 'utf8');
    expect(publicKeyFingerprint(pub)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('release-attestation — chave via env (secret store/CI)', () => {
  const {
    loadPrivateKey,
    loadPublicKey,
    exportResolvedPublicKey,
  } = require('../../../governance/release-attestation');

  const ENV_KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-att-env-'));
  let privPem;
  let pubPem;

  beforeAll(() => {
    const crypto = require('crypto');
    const pair = crypto.generateKeyPairSync('ed25519');
    privPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    pubPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(path.join(ENV_KEY_DIR, 'priv.pem'), privPem);
    fs.writeFileSync(path.join(ENV_KEY_DIR, 'pub.pem'), pubPem);
  });
  afterAll(() => {
    delete process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY;
    delete process.env.RAP_RELEASE_ATTESTATION_PUBLIC_KEY;
    fs.rmSync(ENV_KEY_DIR, { recursive: true, force: true });
  });

  test('PEM cru via env é aceito', () => {
    process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY = privPem;
    process.env.RAP_RELEASE_ATTESTATION_PUBLIC_KEY = pubPem;
    expect(loadPrivateKey()).toContain('BEGIN PRIVATE KEY');
    expect(loadPublicKey()).toContain('BEGIN PUBLIC KEY');
  });

  test('PEM base64 via env é aceito (canal de CI secret)', () => {
    process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY = Buffer.from(privPem, 'utf8').toString('base64');
    process.env.RAP_RELEASE_ATTESTATION_PUBLIC_KEY = Buffer.from(pubPem, 'utf8').toString('base64');
    expect(loadPrivateKey()).toContain('BEGIN PRIVATE KEY');
    expect(loadPublicKey()).toContain('BEGIN PUBLIC KEY');
  });

  test('sign/verify funciona apenas com chaves de env (sem keyDir)', () => {
    const keyDirBackup = process.env.RAP_RELEASE_KEY_DIR;
    process.env.RAP_RELEASE_KEY_DIR = path.join(os.tmpdir(), 'rap-att-nonexistent-dir');
    process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY = privPem;
    process.env.RAP_RELEASE_ATTESTATION_PUBLIC_KEY = pubPem;
    try {
      const sig = signAttestation(FIELDS);
      expect(verifyAttestation(sig).ok).toBe(true);
      const out = path.join(ENV_KEY_DIR, 'exported-public.json');
      const exported = exportResolvedPublicKey(out);
      expect(exported.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(JSON.parse(fs.readFileSync(out, 'utf8')).publicKeyFingerprint).toBe(publicKeyFingerprint(pubPem));
    } finally {
      process.env.RAP_RELEASE_KEY_DIR = keyDirBackup;
    }
  });

  test('env com conteúdo inválido falha explícito', () => {
    process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY = '!!!not-a-key!!!';
    expect(() => loadPrivateKey()).toThrow('release_attestation_env_key_invalid');
  });
});
