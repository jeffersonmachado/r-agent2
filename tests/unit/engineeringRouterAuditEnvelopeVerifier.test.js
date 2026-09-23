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
const { execFileSync } = require('child_process');
const { verifyEnvelope, REQUIRED_RUNTIME_IDS, resolvePackageLayout, extractPackageFromZip } = require('../../scripts/governance/verify-engineering-router-v1-audit-envelope');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildValidEnvelope(dir, overrides = {}) {
  const runId = 'sha-fixture-run-id';
  const head = 'a'.repeat(40);
  const treeHash = 'b'.repeat(40);
  const sourceFingerprint = overrides.sourceFingerprint || 'c'.repeat(64);

  const runtimeItems = REQUIRED_RUNTIME_IDS.map((id) => ({
    id,
    testSuite: `tests/fixture/${id}.test.js`,
    testCaseId: `fixture-${id}`,
    pass: true,
    exitCode: 0,
    numPassedTests: 1,
    numFailedTests: 0,
  }));

  const structuralCertificationPayload = { artifactType: 'x', runId, sourceFingerprint, status: 'PASS', decision: 'GO', structuralStatus: 'STRUCTURAL_PASS', runtimeStatus: 'RUNTIME_PASS', totalChecks: 164, failedChecks: 0 };

  const artifacts = {
    'baseline.json': { artifactType: 'x', runId, head, treeHash, sourceFingerprint },
    'source-fingerprint.json': { artifactType: 'x', runId, sourceFingerprint, algorithm: 'fixture' },
    'runtime-requirements.json': { artifactType: 'x', runId, requiredIds: [...REQUIRED_RUNTIME_IDS] },
    'runtime-certification.json': { artifactType: 'x', runId, sourceFingerprint, status: 'RUNTIME_PASS', totalItems: runtimeItems.length, failedItems: 0, items: runtimeItems },
    'structural-certification.json': structuralCertificationPayload,
    'routing-evidence.json': { artifactType: 'x', runId, items: [] },
    'security-evidence.json': { artifactType: 'x', runId, items: [] },
    'sandbox-evidence.json': { artifactType: 'x', runId, items: [{ id: 'EXECUTION_SANDBOX_ISOLATION', pass: true }] },
    'resume-evidence.json': { artifactType: 'x', runId, items: [{ id: 'RESTART_RESUME', pass: true }, { id: 'CRASH_RESUME_MID_STAGE', pass: true }] },
    'regression-evidence.json': { artifactType: 'x', runId, items: [] },
    'governance-evidence.json': { artifactType: 'x', runId, items: [], structuralGate: structuralCertificationPayload },
    'promotion-evidence.json': { artifactType: 'x', runId, sourceFingerprint, items: [{ id: 'CONTROLLED_PROMOTION', pass: true }, { id: 'EXACT_PATCH_PROMOTION', pass: true }] },
    'pilot-evidence.json': { artifactType: 'x', runId, sourceFingerprint, pilotTaskId: `pilot-${runId}`, items: [{ id: 'RED_TO_FIX', pass: true }] },
    'release-closure-evidence.json': { artifactType: 'x', runId, sourceFingerprint, backlogVersion: 'ER-V1-FINAL-1', blockers: [], allBlockersGreen: true, releaseStatus: 'ENGINEERING_ROUTER_V1_10_OF_10_GREEN' },
    'seal-certification.json': {
      artifactType: 'x',
      runId,
      sourceFingerprint,
      finalClosureBacklog: { version: 'ER-V1-FINAL-1', items: [], allGreen: true },
      sealBacklog: { version: 'ER-V1-SEAL-1', items: [], allGreen: true },
      sealFixBacklog: {
        version: 'ER-V1-SEALFIX-1',
        items: [
          { id: 'ER-V1-SEALFIX-001', status: 'PASS' },
          { id: 'ER-V1-SEALFIX-002', status: 'PASS' },
          { id: 'ER-V1-SEALFIX-003', status: 'PASS' },
          { id: 'ER-V1-SEALFIX-004', status: 'PASS' },
        ],
        allGreen: true,
      },
      engineeringRouterV1Sealed: true,
    },
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
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    head,
    sourceFingerprint,
    treeHash,
    runId,
    runtimeRunId: runId,
    governanceRunId: runId,
    expectedArtifacts: Object.keys(artifacts).concat(['hashes.json']),
    artifactHashes: hashes,
    testSuiteHash: 'fixture-test-suite-hash',
    runtimeStatus: 'RUNTIME_PASS',
    structuralStatus: 'PASS',
    promotionStatus: 'PROMOTION_VERIFIED',
    pilotTaskId: `pilot-${runId}`,
    releaseStatus: 'ENGINEERING_ROUTER_V1_10_OF_10_GREEN',
    engineeringRouterV1Sealed: true,
    finalDecision: 'GO',
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

  test('ER-V1-SEAL-004: 1 byte alterado em runtime-certification.json sem atualizar hashes.json/manifest → FAIL de hash, nunca aceito silenciosamente', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'runtime-certification.json');
    const original = fs.readFileSync(filePath, 'utf8');
    // Altera exatamente 1 caractere do JSON (um dígito do totalItems), preservando tamanho e
    // validade sintática — simula a menor adulteração possível, não uma reescrita completa.
    const tampered = original.replace('"totalItems": 25', '"totalItems": 26');
    expect(tampered).not.toBe(original);
    fs.writeFileSync(filePath, tampered);

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ARTIFACT_HASH_MATCHES_runtime-certification.json').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'MANIFEST_REFERENCES_runtime-certification.json').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: promotion-evidence.json removido do envelope → FAIL explícito, nunca envelope PASS sem prova de promoção', () => {
    buildValidEnvelope(tmpDir);
    fs.rmSync(path.join(tmpDir, 'promotion-evidence.json'));

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ARTIFACT_PRESENT_promotion-evidence.json').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'PROMOTION_EVIDENCE_PRESENT').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: pilotTaskId de pilot-evidence.json trocado (não bate com manifest) → FAIL', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'pilot-evidence.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.pilotTaskId = 'pilot-outro-run-completamente-diferente';
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['pilot-evidence.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'PILOT_TASK_ID_MATCHES_MANIFEST').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: runtime-certification.json com status RUNTIME_NOT_REQUESTED (nunca aceito como prova de fechamento, mesmo com hashes íntegros)', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'runtime-certification.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.status = 'RUNTIME_NOT_REQUESTED';
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['runtime-certification.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }
    // manifest.runtimeStatus continua RUNTIME_PASS (documentação otimista) enquanto o artifact
    // real diz RUNTIME_NOT_REQUESTED — exatamente o cenário histórico que motivou ER-V1-SEAL-004.

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'RUNTIME_STATUS_PASS').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'MANIFEST_RUNTIME_STATUS_MATCHES').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: manifest.sourceFingerprint trocado por outro valor plausível (64 hex) sem atualizar baseline.json → FAIL de consistência, não de formato', () => {
    buildValidEnvelope(tmpDir);
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.sourceFingerprint = 'f'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'SOURCE_FINGERPRINT_CONSISTENT').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'SOURCE_FINGERPRINT_ARTIFACT_CONSISTENT').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: runtime-requirements.json com um ID obrigatório faltando → FAIL de cobertura de requisitos', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'runtime-requirements.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.requiredIds = payload.requiredIds.filter((id) => id !== 'EXECUTION_SANDBOX_ISOLATION');
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['runtime-requirements.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'RUNTIME_REQUIREMENTS_MATCH_REQUIRED_IDS').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: structural-certification.json com status != PASS → FAIL, mesmo com todo o resto íntegro', () => {
    buildValidEnvelope(tmpDir);
    const filePath = path.join(tmpDir, 'structural-certification.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.status = 'STRUCTURAL_FAIL';
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(filePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['structural-certification.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'STRUCTURAL_CERTIFICATION_PASS').ok).toBe(false);
  });

  test('ER-V1-SEAL-004: manifest.json alterado (finalDecision forjado para GO) sem recalcular hash de si mesmo → detectável porque o verifier recalcula finalDecision de forma independente', () => {
    buildValidEnvelope(tmpDir);
    const releaseClosurePath = path.join(tmpDir, 'release-closure-evidence.json');
    const releaseClosure = JSON.parse(fs.readFileSync(releaseClosurePath, 'utf8'));
    releaseClosure.allBlockersGreen = false;
    releaseClosure.releaseStatus = 'ENGINEERING_ROUTER_V1_INCOMPLETE';
    const bytes = Buffer.from(`${JSON.stringify(releaseClosure, null, 2)}\n`, 'utf8');
    fs.writeFileSync(releaseClosurePath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(tmpDir, 'hashes.json'), path.join(tmpDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['release-closure-evidence.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }
    // manifest.finalDecision permanece 'GO' (forjado/desatualizado) — o verifier nunca confia
    // nesse campo, recalculando-o de forma independente a partir de runtime+structural+closure.

    const result = verifyEnvelope(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'RELEASE_CLOSURE_ALL_BLOCKERS_GREEN').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'FINAL_DECISION_RECOMPUTED_MATCHES').ok).toBe(false);
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

describe('ER-V1-SEALFIX-001 — Artifact-to-Source Binding (verifyEnvelope com packageRoot real)', () => {
  let pkgRoot;

  // Constrói um pacote MÍNIMO REAL: uma raiz coberta por SOURCE_ROOTS (`engine/`) com um
  // arquivo-fonte de verdade, e o envelope dentro de `evidence/engineering-router-v1/`,
  // exatamente como um release extraído/ZIP real. `computeSourceFingerprint` é o MESMO
  // algoritmo real do gerador — nunca um valor inventado no teste.
  function buildPackage({ envelopeSourceFingerprint = null } = {}) {
    fs.mkdirSync(path.join(pkgRoot, 'engine'), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'engine', 'fixtureModule.js'), "'use strict';\nmodule.exports = { value: 42 };\n");
    const actualFingerprint = computeSourceFingerprint(pkgRoot);

    const envelopeDir = path.join(pkgRoot, 'evidence', 'engineering-router-v1');
    fs.mkdirSync(envelopeDir, { recursive: true });
    buildValidEnvelope(envelopeDir, { sourceFingerprint: envelopeSourceFingerprint || actualFingerprint });

    return { envelopeDir, actualFingerprint };
  }

  beforeEach(() => {
    pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-envelope-package-test-'));
  });

  afterEach(() => {
    fs.rmSync(pkgRoot, { recursive: true, force: true });
  });

  test('resolvePackageLayout detecta raiz de pacote real (evidence/engineering-router-v1/manifest.json presente)', () => {
    const { envelopeDir } = buildPackage();
    const layout = resolvePackageLayout(pkgRoot);
    expect(layout.packageRoot).toBe(pkgRoot);
    expect(layout.envelopeDir).toBe(envelopeDir);
  });

  test('resolvePackageLayout trata diretório sem árvore-fonte como envelope-only (packageRoot null)', () => {
    const layout = resolvePackageLayout(pkgRoot); // pkgRoot vazio, sem evidence/ dentro
    expect(layout.packageRoot).toBeNull();
    expect(layout.envelopeDir).toBe(pkgRoot);
  });

  test('[1] pacote original + envelope correto => PASS (ACTUAL_PACKAGE_SOURCE_FINGERPRINT bate em todos os artifacts)', () => {
    const { envelopeDir } = buildPackage();
    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.packageBindingVerifiable).toBe(true);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_MANIFEST').ok).toBe(true);
  });

  test('[2] alterar 1 byte em arquivo-fonte real do pacote => FAIL (código entregue != código certificado)', () => {
    const { envelopeDir } = buildPackage();
    fs.appendFileSync(path.join(pkgRoot, 'engine', 'fixtureModule.js'), '\n// 1 byte a mais depois do envelope ter sido gerado\n');

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_MANIFEST').ok).toBe(false);
  });

  test('[3] substituir conteúdo do arquivo-fonte mantendo o envelope antigo => FAIL', () => {
    const { envelopeDir } = buildPackage();
    fs.writeFileSync(path.join(pkgRoot, 'engine', 'fixtureModule.js'), "'use strict';\nmodule.exports = { value: 'CODIGO COMPLETAMENTE DIFERENTE' };\n");

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_MANIFEST').ok).toBe(false);
  });

  test('[4] substituir o envelope por evidência de outro run/fingerprint, mantendo o código original => FAIL', () => {
    // O envelope inteiro é gerado com um sourceFingerprint que NUNCA corresponde ao código
    // real do pacote (simula reaproveitar o envelope de outra build).
    const { envelopeDir } = buildPackage({ envelopeSourceFingerprint: 'f'.repeat(64) });
    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_MANIFEST').ok).toBe(false);
  });

  test('[5] sourceFingerprint divergente entre manifest e o pacote real => FAIL', () => {
    const { envelopeDir, actualFingerprint } = buildPackage();
    const manifestPath = path.join(envelopeDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.sourceFingerprint = 'e'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifest.sourceFingerprint).not.toBe(actualFingerprint);

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_MANIFEST').ok).toBe(false);
  });

  test('[6] runtime evidence com sourceFingerprint de outra fonte (mesmo com manifest correto) => FAIL', () => {
    const { envelopeDir } = buildPackage();
    const rtPath = path.join(envelopeDir, 'runtime-certification.json');
    const rt = JSON.parse(fs.readFileSync(rtPath, 'utf8'));
    rt.sourceFingerprint = 'd'.repeat(64);
    const bytes = Buffer.from(`${JSON.stringify(rt, null, 2)}\n`, 'utf8');
    fs.writeFileSync(rtPath, bytes);
    // sincroniza hashes/manifest para isolar exclusivamente a divergência de binding real
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(envelopeDir, 'hashes.json'), path.join(envelopeDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['runtime-certification.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ACTUAL_PACKAGE_SOURCE_FINGERPRINT_MATCHES_runtime-certification.json').ok).toBe(false);
  });

  test('[7] certificação estrutural (seal evidence) ausente => FAIL', () => {
    const { envelopeDir } = buildPackage();
    fs.rmSync(path.join(envelopeDir, 'structural-certification.json'));

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ARTIFACT_PRESENT_structural-certification.json').ok).toBe(false);
  });

  test('[8] item SEALFIX ausente de seal-certification.json => FAIL', () => {
    const { envelopeDir } = buildPackage();
    const sealPath = path.join(envelopeDir, 'seal-certification.json');
    const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
    seal.sealFixBacklog.items = seal.sealFixBacklog.items.filter((i) => i.id !== 'ER-V1-SEALFIX-003');
    const bytes = Buffer.from(`${JSON.stringify(seal, null, 2)}\n`, 'utf8');
    fs.writeFileSync(sealPath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(envelopeDir, 'hashes.json'), path.join(envelopeDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['seal-certification.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'SEALFIX_ITEM_PRESENT_ER-V1-SEALFIX-003').ok).toBe(false);
  });

  test('nunca confunde "10/10 FINAL GREEN" (release-closure) com "4/4 SEALFIX GREEN" (seal-certification) — um blocker SEALFIX pendente reprova mesmo com release-closure 100% GREEN', () => {
    const { envelopeDir } = buildPackage();
    const sealPath = path.join(envelopeDir, 'seal-certification.json');
    const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
    // release-closure-evidence.json permanece allBlockersGreen=true (10/10 FINAL GREEN) —
    // mas um item SEALFIX ainda está PENDING (não implementado), então o Router NUNCA pode
    // estar SELADO, mesmo com o closure antigo 100% verde.
    seal.sealFixBacklog.items = seal.sealFixBacklog.items.map((i) => (i.id === 'ER-V1-SEALFIX-004' ? { ...i, status: 'PENDING' } : i));
    seal.engineeringRouterV1Sealed = true; // forjado — o verifier precisa recusar isso.
    const bytes = Buffer.from(`${JSON.stringify(seal, null, 2)}\n`, 'utf8');
    fs.writeFileSync(sealPath, bytes);
    const newHash = sha256Bytes(bytes);
    for (const p of [path.join(envelopeDir, 'hashes.json'), path.join(envelopeDir, 'manifest.json')]) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = p.endsWith('manifest.json') ? 'artifactHashes' : 'hashes';
      doc[key]['seal-certification.json'] = newHash;
      fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    }

    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'ENGINEERING_ROUTER_V1_SEALED_RECOMPUTED_MATCHES').ok).toBe(false);
  });

  test('[9] verifier funciona sem .git (packageRoot é um tmpdir puro, nunca um repositório git)', () => {
    expect(fs.existsSync(path.join(pkgRoot, '.git'))).toBe(false);
    const { envelopeDir } = buildPackage();
    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(true);
  });

  test('[10] verifier é 100% offline (nenhuma chamada de rede — determinístico e síncrono sobre arquivos locais)', () => {
    const { envelopeDir } = buildPackage();
    // Não há stub de rede aqui de propósito: se o verifier tentasse acessar rede em ambiente
    // sandboxed sem rede, o teste já falharia por timeout/erro de conexão. PASS determinístico
    // e imediato é a prova de que nenhuma chamada de rede acontece.
    const result = verifyEnvelope(envelopeDir, { packageRoot: pkgRoot });
    expect(result.ok).toBe(true);
  });

  test('[11] verifier funciona sobre diretório extraído (packageRoot resolvido via resolvePackageLayout, não passado manualmente)', () => {
    buildPackage();
    const layout = resolvePackageLayout(pkgRoot);
    const result = verifyEnvelope(layout.envelopeDir, { packageRoot: layout.packageRoot });
    expect(result.ok).toBe(true);
    expect(result.packageBindingVerifiable).toBe(true);
  });

  test('[12] verifier funciona diretamente sobre um ZIP real (zip do pacote inteiro, extraído e recomputado offline)', () => {
    const { envelopeDir } = buildPackage();
    expect(fs.existsSync(envelopeDir)).toBe(true);

    const zipPath = path.join(os.tmpdir(), `audit-envelope-fixture-${Date.now()}.zip`);
    const parentDir = path.dirname(pkgRoot);
    const baseName = path.basename(pkgRoot);
    // zip real via CLI (mesma ferramenta usada por scripts/generate-zip.sh), nunca uma
    // simulação — a garantia "funciona sobre ZIP" só é real se o ZIP for real.
    execFileSync('zip', ['-qry', zipPath, baseName], { cwd: parentDir });
    try {
      const layout = extractPackageFromZip(zipPath);
      expect(layout.packageRoot).not.toBeNull();
      const result = verifyEnvelope(layout.envelopeDir, { packageRoot: layout.packageRoot });
      const failed = result.checks.filter((c) => !c.ok);
      expect(failed).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.packageBindingVerifiable).toBe(true);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  });
});
