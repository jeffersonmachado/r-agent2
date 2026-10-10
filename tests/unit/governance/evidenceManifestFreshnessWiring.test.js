'use strict';

/**
 * Wiring do frescor no evidence-manifest (P1-12).
 *
 * O teste acima cobre a DECISÃO; este cobre a LIGAÇÃO. Um teste que só procura
 * `resolveProofStatus` no texto do arquivo passaria mesmo se o retorno do engine
 * voltasse a ignorá-lo — este chama `buildEvidenceManifestArtifact`, que é
 * literalmente o que o `map` de `buildFinalProofReport` executa para cada artefato.
 *
 * Dados de entrada são os REAIS medidos em 2026-10-10 no run
 * `rap-governed-20261010045617268` (ver AI_MEMORY/hardening-queue.json, item P1-12).
 */

const { buildEvidenceManifestArtifact, REQUIRED_ARTIFACT_SPECS } = require('../../../governance/proof-engine');

const DAY = 86400000;

/** Artefato resolvido com o formato que `resolveArtifact` produz. */
function artifact(overrides = {}) {
  const spec = REQUIRED_ARTIFACT_SPECS.find((s) => s.id === 'smoke_summary');
  return {
    id: spec.id, domain: spec.domain, path: spec.path,
    sourcePath: '/home/jmachado/.local/share/ragent2-runtime/qa/smoke-evidence.json',
    resolvedPath: '/home/jmachado/.local/share/ragent2-runtime/qa/smoke-evidence.json',
    exists: true, packageRequired: spec.packageRequired === true,
    size: 1234, sha256: 'a'.repeat(64),
    timestamp: new Date(Date.now() - 50.8 * DAY).toISOString(),
    json: null,
    ...overrides,
  };
}

describe('buildEvidenceManifestArtifact — o engine aplica o frescor de verdade', () => {
  test('o spec real do smoke_summary continua sendo prova exigida (o teste usa dado real)', () => {
    const spec = REQUIRED_ARTIFACT_SPECS.find((s) => s.id === 'smoke_summary');
    expect(spec).toBeDefined();
    expect(spec.domain).toBe('foundation');
    expect(spec.packageRequired).toBe(true);
  });

  test('evidência de 50,8 dias NÃO é valid e NÃO afirma a decisão final', () => {
    const entry = buildEvidenceManifestArtifact({ artifact: artifact(), semanticViolations: [] });
    expect(entry.proofStatus).toBe('stale');
    expect(entry.governanceLinkage).toEqual([]);
    expect(entry.freshness.status).toBe('STALE');
    expect(entry.freshness.reason).toContain('50');
  });

  test('a MESMA evidência fresca é valid e afirma a decisão final (o frescor é a única diferença)', () => {
    const entry = buildEvidenceManifestArtifact({
      artifact: artifact({ timestamp: new Date(Date.now() - 2 * DAY).toISOString() }),
      semanticViolations: [],
    });
    expect(entry.proofStatus).toBe('valid');
    expect(entry.governanceLinkage).toEqual(['final_decision']);
  });

  test('não-vacuidade: a evidência vencida seria valid no critério ANTIGO (presença + conteúdo)', () => {
    const entry = buildEvidenceManifestArtifact({ artifact: artifact(), semanticViolations: [] });
    const legacy = !entry.exists ? 'missing' : (entry.semanticViolations.length > 0 ? 'invalid' : 'valid');
    expect(legacy).toBe('valid');
    expect(entry.proofStatus).toBe('stale');
  });

  test('conteúdo semanticamente inválido vence sobre o frescor (invalid, não stale)', () => {
    const entry = buildEvidenceManifestArtifact({
      artifact: artifact(),
      semanticViolations: ['ok===false'],
    });
    expect(entry.proofStatus).toBe('invalid');
  });

  test('artefato ausente continua missing (o frescor não inventa prova)', () => {
    const entry = buildEvidenceManifestArtifact({
      artifact: artifact({ exists: false, timestamp: null }),
      semanticViolations: [],
    });
    expect(entry.proofStatus).toBe('missing');
  });

  test('domínio governance (fonte) fica fora do TTL de evidência e mantém seu vínculo próprio', () => {
    const spec = REQUIRED_ARTIFACT_SPECS.find((s) => s.domain === 'governance');
    expect(spec).toBeDefined();
    const entry = buildEvidenceManifestArtifact({
      artifact: artifact({ id: spec.id, domain: spec.domain, path: spec.path, timestamp: new Date(Date.now() - 400 * DAY).toISOString() }),
      semanticViolations: [],
    });
    expect(entry.freshness.exempt).toBe(true);
    expect(entry.proofStatus).toBe('valid');
    expect(entry.governanceLinkage).toEqual(['proof_based_governance']);
  });
});
