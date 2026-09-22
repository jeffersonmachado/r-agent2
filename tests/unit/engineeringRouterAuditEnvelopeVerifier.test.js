'use strict';

/**
 * ER-V1-FINAL-010 (Self-Proving Audit Envelope) — testa o VERIFIER offline de forma
 * determinística, sem depender de `reports/` real no disco: constrói um envelope sintético
 * VÁLIDO em tmpdir (mesmo shape produzido por `generate-engineering-router-v1-audit-envelope.js`)
 * e corrompe uma dimensão de cada vez, provando que o verifier detecta cada classe de violação
 * exigida pela missão: hashes, references, runId, sourceFingerprint, requirement coverage,
 * runtime PASS, promotion exactness, pilot evidence.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { verifyEnvelope, REQUIRED_RUNTIME_IDS } = require('../../scripts/governance/verify-engineering-router-v1-audit-envelope');

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildValidEnvelope(dir) {
  const runId = 'sha-fixture-run-id';
  const head = 'a'.repeat(40);
  const treeHash = 'b'.repeat(40);
  const sourceFingerprint = 'c'.repeat(64);

  const runtimeItems = REQUIRED_RUNTIME_IDS.map((id) => ({
    id,
    testSuite: `tests/fixture/${id}.test.js`,
    testCaseId: `fixture-${id}`,
    pass: true,
    exitCode: 0,
    numPassedTests: 1,
    numFailedTests: 0,
  }));

  const artifacts = {
    'baseline.json': { artifactType: 'x', runId, head, treeHash, sourceFingerprint },
    'runtime-certification.json': { artifactType: 'x', runId, sourceFingerprint, status: 'RUNTIME_PASS', totalItems: runtimeItems.length, failedItems: 0, items: runtimeItems },
    'routing-evidence.json': { artifactType: 'x', runId, items: [] },
    'security-evidence.json': { artifactType: 'x', runId, items: [] },
    'regression-evidence.json': { artifactType: 'x', runId, items: [] },
    'governance-evidence.json': { artifactType: 'x', runId, items: [] },
    'promotion-evidence.json': { artifactType: 'x', runId, items: [{ id: 'CONTROLLED_PROMOTION', pass: true }, { id: 'EXACT_PATCH_PROMOTION', pass: true }] },
    'pilot-evidence.json': { artifactType: 'x', runId, pilotTaskId: `pilot-${runId}`, items: [{ id: 'RED_TO_FIX', pass: true }] },
    'release-closure-evidence.json': { artifactType: 'x', runId, backlogVersion: 'ER-V1-FINAL-1', blockers: [], allBlockersGreen: true, releaseStatus: 'ENGINEERING_ROUTER_V1_10_OF_10_GREEN' },
  };

  const hashes = {};
  for (const [name, payload] of Object.entries(artifacts)) {
    const filePath = path.join(dir, name);
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    hashes[name] = sha256Bytes(bytes);
  }
  fs.writeFileSync(path.join(dir, 'hashes.json'), `${JSON.stringify({ artifactType: 'x', runId, algorithm: 'sha256', hashes }, null, 2)}\n`);

  const manifest = {
    artifactType: 'engineering-router-v1-audit-manifest',
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    head,
    sourceFingerprint,
    treeHash,
    runId,
    artifactHashes: hashes,
    testSuiteHash: 'fixture-test-suite-hash',
    runtimeStatus: 'RUNTIME_PASS',
    promotionStatus: 'PROMOTION_VERIFIED',
    pilotTaskId: `pilot-${runId}`,
    releaseStatus: 'ENGINEERING_ROUTER_V1_10_OF_10_GREEN',
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { runId, head, treeHash, sourceFingerprint, artifacts, manifest };
}

describe('ER-V1-FINAL-010 — verifyEnvelope (offline, determinístico)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-envelope-verifier-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('envelope sintético válido → PASS em todos os checks', () => {
    buildValidEnvelope(tmpDir);
    const result = verifyEnvelope(tmpDir);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('diretório do envelope inexistente → FAIL imediato, nunca lança', () => {
    const result = verifyEnvelope(path.join(tmpDir, 'nao-existe'));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ENVELOPE_DIR_EXISTS').ok).toBe(false);
  });

  test('artifact alterado após a geração (hash não bate) → FAIL no hash e na referência do manifest', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'pilot-evidence.json');
    const tampered = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    tampered.items[0].pass = false;
    fs.writeFileSync(filePath, `${JSON.stringify(tampered, null, 2)}\n`);

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ARTIFACT_HASH_MATCHES_pilot-evidence.json').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'MANIFEST_REFERENCES_pilot-evidence.json').ok).toBe(false);
  });

  test('item de requirement coverage ausente em runtime-certification.json → FAIL específico do ID ausente', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'runtime-certification.json');
    const cert = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cert.items = cert.items.filter((i) => i.id !== 'SHELL_INJECTION_REJECTED');
    fs.writeFileSync(filePath, `${JSON.stringify(cert, null, 2)}\n`);
    // Recalcula hash real do arquivo alterado, mas NÃO atualiza hashes.json/manifest — o
    // teste anterior já cobre detecção de hash; aqui queremos isolar a checagem de coverage,
    // então também sincroniza o hash para não misturar os dois tipos de falha no mesmo teste.
    const bytes = fs.readFileSync(filePath);
    const newHash = sha256Bytes(bytes);
    const hashesPath = path.join(tmpDir, 'hashes.json');
    const hashesDoc = JSON.parse(fs.readFileSync(hashesPath, 'utf8'));
    hashesDoc.hashes['runtime-certification.json'] = newHash;
    fs.writeFileSync(hashesPath, `${JSON.stringify(hashesDoc, null, 2)}\n`);
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifestDoc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifestDoc.artifactHashes['runtime-certification.json'] = newHash;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifestDoc, null, 2)}\n`);

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'REQUIREMENT_COVERAGE_SHELL_INJECTION_REJECTED').ok).toBe(false);
  });

  test('runId divergente entre um artifact e o manifest → FAIL de consistência de run', () => {
    const built = buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'security-evidence.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.runId = 'um-run-id-completamente-diferente';
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['security-evidence.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'RUN_ID_CONSISTENT_security-evidence.json').ok).toBe(false);
    expect(built.runId).not.toBe('um-run-id-completamente-diferente');
  });

  test('sourceFingerprint divergente entre baseline.json e manifest.json → FAIL', () => {
    buildValidEnvelope(tmpDir);
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.sourceFingerprint = 'd'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'SOURCE_FINGERPRINT_CONSISTENT').ok).toBe(false);
  });

  test('item de promoção com pass:false → FAIL específico do item, mesmo com hashes íntegros', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'promotion-evidence.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.items[0].pass = false;
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['promotion-evidence.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === `PROMOTION_ITEM_PASS_${payload.items[0].id}`).ok).toBe(false);
  });

  test('pilot-evidence.json ausente do envelope → FAIL explícito de artifact ausente', () => {
    buildValidEnvelope(tmpDir);
    fs.rmSync(path.join(tmpDir, 'pilot-evidence.json'));

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ARTIFACT_PRESENT_pilot-evidence.json').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'PILOT_EVIDENCE_PRESENT').ok).toBe(false);
  });

  test('manifest.json ausente ou corrompido (não é JSON válido) → FAIL imediato, sem lançar exceção', () => {
    buildValidEnvelope(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '{ isso não é json válido');

    expect(() => verifyEnvelope(tmpDir)).not.toThrow();
    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'MANIFEST_PARSEABLE').ok).toBe(false);
  });
});
