'use strict';

/**
 * Testes da prova de publicação pós-tag (P3 do seal):
 *
 *   Módulo governance/release-publication.js (keypair Ed25519 efêmero em
 *   tmpdir — nunca a chave real do release):
 *     A. receipt válido + assinatura válida → verify PASS
 *     B. envelopeSha256 alterado → FAIL
 *     C. gitCommit alterado → FAIL
 *     D. tagTarget alterado → FAIL
 *     E. assinatura adulterada → FAIL; signaturePurpose errado → FAIL
 *        (attestation reutilizada como receipt é rejeitada);
 *
 *   Verificador standalone scripts/verify-release-publication.js (fixture em
 *   tmpdir: envelope/payload/manifest fake + receipt assinado com o keypair
 *   efêmero + chave pública exportada):
 *     offline: hashes, campos git/tag, status e assinatura;
 *     online (lsRemoteRunner mockado): tag remota movida → FAIL
 *     RELEASE_TAG_TARGET_CHANGED; tag confirmada → PASS.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-pub-keys-'));
process.env.RAP_RELEASE_KEY_DIR = KEY_DIR;

const {
  generateKeyPair,
  signAttestation,
} = require('../../../governance/release-attestation');
const {
  SIGNATURE_PURPOSE,
  buildPublicationDocument,
  signPublicationReceipt,
  verifyPublicationReceipt,
} = require('../../../governance/release-publication');
const {
  resolveRemoteTagTarget,
  verifyReleasePublication,
} = require('../../../scripts/verify-release-publication');
const {
  createPublicationReceipt,
} = require('../../../scripts/governance/create-release-publication-receipt');

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const OTHER_COMMIT = 'c'.repeat(40);
const RELEASE = 'r-agent2-20260908-195018';

const FIELDS = {
  releaseId: RELEASE,
  envelopeSha256: 'd'.repeat(64),
  payloadSha256: 'e'.repeat(64),
  manifestSha256: 'f'.repeat(64),
  gitCommit: COMMIT,
  gitTree: TREE,
  releaseTag: RELEASE,
  tagTarget: COMMIT,
};

let pubPem;

beforeAll(() => {
  generateKeyPair({ force: true });
  pubPem = fs.readFileSync(path.join(KEY_DIR, 'release-attestation-public.pem'), 'utf8');
});

afterAll(() => {
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
});

describe('release-publication — buildPublicationDocument', () => {
  test('campo obrigatório ausente → release_publication_field_missing — <campo>', () => {
    const { envelopeSha256, ...without } = FIELDS;
    expect(() => buildPublicationDocument(without))
      .toThrow('release_publication_field_missing — envelopeSha256');
    expect(() => buildPublicationDocument({ ...FIELDS, tagTarget: null }))
      .toThrow('release_publication_field_missing — tagTarget');
  });
});

describe('release-publication — ciclo sign/verify (keypair efêmero)', () => {
  test('A: receipt válido + assinatura válida → verify PASS', () => {
    const sig = signPublicationReceipt(FIELDS);
    expect(sig.artifactType).toBe('release-publication-signature');
    expect(sig.algorithm).toBe('ed25519');
    expect(sig.signaturePurpose).toBe(SIGNATURE_PURPOSE);
    const result = verifyPublicationReceipt(FIELDS, sig, { publicKeyPem: pubPem });
    expect(result).toEqual({ ok: true, reason: null });
  });

  test('B: envelopeSha256 alterado → FAIL', () => {
    const sig = signPublicationReceipt(FIELDS);
    const result = verifyPublicationReceipt({ ...FIELDS, envelopeSha256: '0'.repeat(64) }, sig, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SIGNATURE_INVALID');
  });

  test('C: gitCommit alterado → FAIL', () => {
    const sig = signPublicationReceipt(FIELDS);
    const result = verifyPublicationReceipt({ ...FIELDS, gitCommit: OTHER_COMMIT }, sig, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
  });

  test('D: tagTarget alterado → FAIL', () => {
    const sig = signPublicationReceipt(FIELDS);
    const result = verifyPublicationReceipt({ ...FIELDS, tagTarget: OTHER_COMMIT }, sig, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
  });

  test('E1: assinatura adulterada → FAIL', () => {
    const sig = signPublicationReceipt(FIELDS);
    const tampered = { ...sig, signature: sig.signature.replace(/^../, sig.signature.startsWith('00') ? '01' : '00') };
    const result = verifyPublicationReceipt(FIELDS, tampered, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
  });

  test('E2: signaturePurpose errado → FAIL SIGNATURE_PURPOSE_MISMATCH', () => {
    const sig = signPublicationReceipt(FIELDS);
    const wrongPurpose = { ...sig, signaturePurpose: 'RAP_RELEASE_ATTESTATION' };
    const result = verifyPublicationReceipt(FIELDS, wrongPurpose, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SIGNATURE_PURPOSE_MISMATCH');
  });

  test('E3: attestation de release reutilizada como receipt → FAIL', () => {
    const attSig = signAttestation({
      releaseId: RELEASE,
      runId: 'rap-governed-test',
      sourceFingerprint: 'a'.repeat(64),
      gitCommit: COMMIT,
      gitTree: TREE,
      payloadSha256: FIELDS.payloadSha256,
      manifestSha256: FIELDS.manifestSha256,
      finalDecision: 'AUTONOMOUS_READY_GO',
    });
    const result = verifyPublicationReceipt(FIELDS, attSig, { publicKeyPem: pubPem });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/SIGNATURE_INVALID|SIGNATURE_PURPOSE_MISMATCH/);
  });
});

/**
 * Fixture do verificador standalone: dist/release fake + receipt + sig +
 * chave pública efêmera exportada.
 */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-pub-verify-'));
  const releaseDir = path.join(dir, 'dist', 'release');
  const govDir = path.join(dir, 'governance');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(govDir, { recursive: true });

  const envelopePath = path.join(releaseDir, `${RELEASE}.zip`);
  const payloadPath = path.join(releaseDir, `${RELEASE}.payload.zip`);
  const manifestPath = path.join(releaseDir, `${RELEASE}.manifest.json`);
  fs.writeFileSync(envelopePath, 'ENVELOPE-FAKE');
  fs.writeFileSync(payloadPath, 'PAYLOAD-FAKE');
  fs.writeFileSync(manifestPath, JSON.stringify({ git_commit: COMMIT, git_tree: TREE }, null, 2));

  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const fields = {
    releaseId: RELEASE,
    envelopeSha256: sha(envelopePath),
    payloadSha256: sha(payloadPath),
    manifestSha256: sha(manifestPath),
    gitCommit: COMMIT,
    gitTree: TREE,
    releaseTag: RELEASE,
    tagTarget: COMMIT,
  };
  const receipt = {
    artifactType: 'release-publication-receipt',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    ...fields,
    tagMatches: true,
    remoteCommitExists: true,
    remoteTreeMatches: true,
    status: 'PUBLISHED_VERIFIED',
  };
  const sig = signPublicationReceipt(fields);
  const receiptPath = path.join(govDir, 'release-publication-receipt.json');
  const signaturePath = path.join(govDir, 'release-publication-receipt.sig');
  const publicKeyPath = path.join(dir, 'release-attestation-public-key.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(signaturePath, JSON.stringify(sig, null, 2));
  fs.writeFileSync(publicKeyPath, JSON.stringify({ publicKey: pubPem }, null, 2));

  return {
    dir,
    releaseDir,
    receiptPath,
    signaturePath,
    publicKeyPath,
    receipt,
    sig,
    baseOptions: {
      release: RELEASE,
      releaseDir,
      receiptPath,
      signaturePath,
      publicKeyPath,
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function rewriteJson(filePath, mutate) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(data);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function failureCodes(result) {
  return result.checks.filter((c) => !c.ok).map((c) => c.code);
}

describe('verify-release-publication — offline (fixture tmpdir)', () => {
  test('fixture íntegra → PASS em todos os checks', () => {
    const fx = makeFixture();
    try {
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(true);
      expect(failureCodes(result)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test('B: envelopeSha256 do receipt alterado → FAIL PUBLICATION_RECEIPT_HASH_MISMATCH', () => {
    const fx = makeFixture();
    try {
      rewriteJson(fx.receiptPath, (r) => { r.envelopeSha256 = '0'.repeat(64); });
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('PUBLICATION_RECEIPT_HASH_MISMATCH');
    } finally {
      fx.cleanup();
    }
  });

  test('C: gitCommit do receipt alterado → FAIL (tag target + assinatura)', () => {
    const fx = makeFixture();
    try {
      rewriteJson(fx.receiptPath, (r) => { r.gitCommit = OTHER_COMMIT; });
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('RELEASE_TAG_TARGET_CHANGED');
      expect(failureCodes(result)).toContain('PUBLICATION_RECEIPT_SIGNATURE_INVALID');
    } finally {
      fx.cleanup();
    }
  });

  test('D: tagTarget do receipt alterado → FAIL RELEASE_TAG_TARGET_CHANGED', () => {
    const fx = makeFixture();
    try {
      rewriteJson(fx.receiptPath, (r) => { r.tagTarget = OTHER_COMMIT; });
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('RELEASE_TAG_TARGET_CHANGED');
    } finally {
      fx.cleanup();
    }
  });

  test('E: assinatura adulterada no .sig → FAIL PUBLICATION_RECEIPT_SIGNATURE_INVALID', () => {
    const fx = makeFixture();
    try {
      rewriteJson(fx.signaturePath, (s) => {
        s.signature = s.signature.replace(/^../, s.signature.startsWith('00') ? '01' : '00');
      });
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('PUBLICATION_RECEIPT_SIGNATURE_INVALID');
    } finally {
      fx.cleanup();
    }
  });

  test('status diferente de PUBLISHED_VERIFIED → FAIL PUBLICATION_RECEIPT_STATUS_INVALID', () => {
    const fx = makeFixture();
    try {
      rewriteJson(fx.receiptPath, (r) => { r.status = 'PUBLISHED_UNVERIFIED'; });
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('PUBLICATION_RECEIPT_STATUS_INVALID');
    } finally {
      fx.cleanup();
    }
  });

  test('artefato ausente → FAIL PUBLICATION_ARTIFACT_MISSING', () => {
    const fx = makeFixture();
    try {
      fs.rmSync(path.join(fx.releaseDir, `${RELEASE}.payload.zip`));
      const result = verifyReleasePublication(fx.baseOptions);
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('PUBLICATION_ARTIFACT_MISSING');
    } finally {
      fx.cleanup();
    }
  });
});

describe('verify-release-publication — online (lsRemoteRunner mockado)', () => {
  test('tag remota confirmada no tagTarget → PASS', () => {
    const fx = makeFixture();
    try {
      const runner = () => `${COMMIT}\trefs/tags/${RELEASE}\n`;
      const result = verifyReleasePublication({ ...fx.baseOptions, online: true }, { lsRemoteRunner: runner });
      expect(result.ok).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test('F: tag remota movida → FAIL RELEASE_TAG_TARGET_CHANGED', () => {
    const fx = makeFixture();
    try {
      const runner = () => `${OTHER_COMMIT}\trefs/tags/${RELEASE}\n`;
      const result = verifyReleasePublication({ ...fx.baseOptions, online: true }, { lsRemoteRunner: runner });
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('RELEASE_TAG_TARGET_CHANGED');
    } finally {
      fx.cleanup();
    }
  });

  test('tag remota inexistente → FAIL RELEASE_TAG_TARGET_CHANGED', () => {
    const fx = makeFixture();
    try {
      const runner = () => '';
      const result = verifyReleasePublication({ ...fx.baseOptions, online: true }, { lsRemoteRunner: runner });
      expect(result.ok).toBe(false);
      expect(failureCodes(result)).toContain('RELEASE_TAG_TARGET_CHANGED');
    } finally {
      fx.cleanup();
    }
  });

  test('sem --online, lsRemoteRunner nunca é chamado (zero rede)', () => {
    const fx = makeFixture();
    try {
      let called = 0;
      const runner = () => { called += 1; return ''; };
      const result = verifyReleasePublication(fx.baseOptions, { lsRemoteRunner: runner });
      expect(result.ok).toBe(true);
      expect(called).toBe(0);
    } finally {
      fx.cleanup();
    }
  });
});

describe('verify-release-publication — resolveRemoteTagTarget', () => {
  test('deref ^{} de tag anotada tem prioridade sobre o objeto da tag', () => {
    const out = `${'9'.repeat(40)}\trefs/tags/rel\n${COMMIT}\trefs/tags/rel^{}\n`;
    expect(resolveRemoteTagTarget(out, 'rel')).toBe(COMMIT);
  });

  test('tag leve (sem deref) resolve o próprio ref', () => {
    expect(resolveRemoteTagTarget(`${COMMIT}\trefs/tags/rel\n`, 'rel')).toBe(COMMIT);
    expect(resolveRemoteTagTarget('', 'rel')).toBe(null);
  });
});

describe('create-release-publication-receipt — integração com verify-remote-provenance (git fake)', () => {
  function makeFakeGit() {
    return (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'https://github.com/org/r-agent2.git';
      if (args[0] === 'ls-remote') {
        return [
          `${COMMIT}\trefs/heads/main`,
          `${'7'.repeat(40)}\trefs/tags/${RELEASE}`,
          `${COMMIT}\trefs/tags/${RELEASE}^{}`,
        ].join('\n');
      }
      if (args[0] === 'fetch') return '';
      if (args[0] === 'rev-parse' && args[1] === `${RELEASE}^{commit}`) return COMMIT;
      if (args[0] === 'rev-parse' && args[1] === `${COMMIT}^{tree}`) return TREE;
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    };
  }

  test('fluxo feliz: receipt PUBLISHED_VERIFIED + sig verificável com a pública efêmera', () => {
    const fx = makeFixture();
    try {
      const { receipt, sig, paths } = createPublicationReceipt(
        { release: RELEASE, tag: RELEASE, releaseDir: fx.releaseDir, outDir: path.join(fx.dir, 'out') },
        { gitRunner: makeFakeGit() },
      );
      expect(receipt.status).toBe('PUBLISHED_VERIFIED');
      expect(receipt.tagMatches).toBe(true);
      expect(receipt.remoteCommitExists).toBe(true);
      expect(receipt.remoteTreeMatches).toBe(true);
      expect(fs.existsSync(paths.receiptPath)).toBe(true);
      expect(fs.existsSync(paths.sigPath)).toBe(true);
      expect(verifyPublicationReceipt(receipt, sig, { publicKeyPem: pubPem }).ok).toBe(true);
      // Sem credenciais/tokens nos artefatos.
      expect(JSON.stringify(receipt)).not.toContain('token');
      expect(JSON.stringify(sig)).not.toContain('BEGIN PRIVATE KEY');
    } finally {
      fx.cleanup();
    }
  });

  test('tag apontando para outro commit → erro RELEASE_TAG_TARGET_CHANGED, sem receipt', () => {
    const fx = makeFixture();
    try {
      const runner = (args) => {
        if (args[0] === 'rev-parse' && args[1] === `${RELEASE}^{commit}`) return OTHER_COMMIT;
        return makeFakeGit()(args);
      };
      expect(() => createPublicationReceipt(
        { release: RELEASE, tag: RELEASE, releaseDir: fx.releaseDir, outDir: path.join(fx.dir, 'out2') },
        { gitRunner: runner },
      )).toThrow('RELEASE_TAG_TARGET_CHANGED');
      expect(fs.existsSync(path.join(fx.dir, 'out2', 'release-publication-receipt.json'))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
