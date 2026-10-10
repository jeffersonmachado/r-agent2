'use strict';

/**
 * Imutabilidade do evidence manifest no package-integrity-engine.
 *
 * Achado P0 (2026-10-10): o check de hash era VACUOSO — o baseline era lido de um
 * bloco (`packageImmutability`) que nenhum produtor criava, e a ausência virava
 * `pass: true` com a nota "No stored hash baseline to compare against". Ou seja:
 * o check não podia falhar, e um baseline de outro run era indistinguível de
 * ausência de baseline. Este teste prova as duas metades da correção: a decisão
 * (módulo puro) e a existência do produtor (senão a decisão nunca é exercitada
 * no pipeline real).
 */

const fs = require('fs');
const path = require('path');

const {
  CODES,
  evaluateEvidenceManifestHashBaseline,
} = require('../../../governance/lib/evidence-manifest-hash-baseline');

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const RUN = { runId: 'rap-governed-20261010045617268-19ce0cbd', sourceFingerprint: 'ee99' };
const BASELINE = { evidenceManifestHash: HASH, runId: RUN.runId, sourceFingerprint: RUN.sourceFingerprint };

describe('evidence manifest hash — baseline atestado', () => {
  test('hash confere e proveniência casa ⇒ PASS', () => {
    const verdict = evaluateEvidenceManifestHashBaseline({
      computed: HASH, baseline: BASELINE, currentRun: RUN,
    });
    expect(verdict).toMatchObject({ pass: true, severity: 'OK', code: CODES.OK, reason: null });
  });

  test('CONTROLE POSITIVO: ausência de baseline é FAIL (nunca PASS por falta de dado)', () => {
    for (const baseline of [null, {}, { evidenceManifestHash: '' }, { evidenceManifestHash: null }]) {
      const verdict = evaluateEvidenceManifestHashBaseline({ computed: HASH, baseline, currentRun: RUN });
      expect(verdict).toMatchObject({ pass: false, severity: 'HIGH', code: CODES.BASELINE_MISSING });
      expect(verdict.reason).toMatch(/ausente/);
    }
  });

  test('CONTROLE POSITIVO: hash divergente é FAIL (evidência alterada após atestação)', () => {
    const verdict = evaluateEvidenceManifestHashBaseline({
      computed: OTHER_HASH, baseline: BASELINE, currentRun: RUN,
    });
    expect(verdict).toMatchObject({ pass: false, code: CODES.DIVERGENT });
  });

  test('CONTROLE POSITIVO: baseline de OUTRO run é FAIL (evidência estrangeira)', () => {
    const verdict = evaluateEvidenceManifestHashBaseline({
      computed: HASH,
      baseline: { ...BASELINE, runId: 'rap-governed-20261007044956931-c1df8021' },
      currentRun: RUN,
    });
    expect(verdict).toMatchObject({ pass: false, code: CODES.FOREIGN_RUN });
    expect(verdict.reason).toMatch(/outro run/);
  });

  test('CONTROLE POSITIVO: baseline de outra árvore de código é FAIL (stale source)', () => {
    const verdict = evaluateEvidenceManifestHashBaseline({
      computed: HASH,
      baseline: { ...BASELINE, sourceFingerprint: 'a7b30219' },
      currentRun: RUN,
    });
    expect(verdict).toMatchObject({ pass: false, code: CODES.STALE_SOURCE });
  });

  test('manifest ausente/ilegível ⇒ FAIL (não há o que comparar)', () => {
    for (const computed of [null, undefined, '', '   ']) {
      const verdict = evaluateEvidenceManifestHashBaseline({ computed, baseline: BASELINE, currentRun: RUN });
      expect(verdict).toMatchObject({ pass: false, code: CODES.UNREADABLE });
    }
  });

  test('ausência de run corrente NÃO fabrica recusa (não inventa divergência)', () => {
    const verdict = evaluateEvidenceManifestHashBaseline({ computed: HASH, baseline: BASELINE, currentRun: null });
    expect(verdict.pass).toBe(true);
    // E o inverso: baseline sem proveniência, com run corrente presente, também
    // não é acusado de estrangeiro — só o hash é comparado.
    const semProveniencia = evaluateEvidenceManifestHashBaseline({
      computed: HASH, baseline: { evidenceManifestHash: HASH }, currentRun: RUN,
    });
    expect(semProveniencia.pass).toBe(true);
  });
});

describe('não-vacuidade: o pipeline real exercita a decisão', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../../../governance/package-integrity-engine.js'), 'utf8');
  const producerSrc = fs.readFileSync(path.join(__dirname, '../../../governance/update-package-binding.js'), 'utf8');

  test('o engine consome o módulo de decisão (e não tem mais PASS por ausência)', () => {
    expect(engineSrc).toMatch(/evaluateEvidenceManifestHashBaseline/);
    expect(engineSrc).not.toMatch(/sem baseline para comparar/);
    expect(engineSrc).not.toMatch(/No stored hash baseline to compare against/);
  });

  test('o produtor CRIA o baseline (antes só atualizava se já existisse)', () => {
    // Atribuição do bloco, não apenas `if (consistency.packageImmutability)`.
    expect(producerSrc).toMatch(/consistency\.packageImmutability\s*=\s*\{/);
    expect(producerSrc).toMatch(/evidenceManifestHash:\s*evHash/);
    expect(producerSrc).toMatch(/runId:\s+runContext\.runId/);
  });
});
