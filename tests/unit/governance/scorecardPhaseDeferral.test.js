'use strict';

/**
 * Defeito real (convergência do run rap-governed-20260911113009846): o
 * scorecard tratava o `DEFERRED` do artefato canônico do pacote como falha real
 * em RAP-052/RAP-054, tornando `master_scorecard = FAIL` em PRE_PACKAGE — fase
 * em que o pacote comprovadamente ainda não existe. Isso derrubava a decisão
 * para NO_GO, que era projetado nos relatórios auto-referentes, reprovando as
 * outras 27 dimensões: deadlock cuja única falha real era "o pacote ainda não
 * foi construído".
 *
 * Estes testes fixam as duas metades da correção: a deferral de fase é
 * reconhecida, e o gate de selagem NÃO herda a tolerância (no selo o pacote
 * existe e precisa PASSAR).
 */

const {
  isPrePackageDeferredDimension,
  isDeferredPackageRequirement,
  classifyBelow10Dimensions,
  PRE_PACKAGE_DEFERRED_ARTIFACTS,
} = require('../../../scripts/governance/scorecard-phase-deferral');
const { evaluateSealState, DELIVERED_PHASE_DIMS } = require('../../../scripts/governance/seal-time-gate');

function requirement(overrides = {}) {
  return {
    id: 'runtime-validated',
    category: 'RUNTIME_VALIDATED',
    mandatory: true,
    status: 'FAIL',
    code: 'ARTIFACT_DID_NOT_PASS',
    validator: ['governance/package-validation-report.json'],
    reason: 'Artifact não aprovou: governance/package-validation-report.json (DEFERRED)',
    evidence: [{ code: 'ARTIFACT_DID_NOT_PASS', path: 'governance/package-validation-report.json', reason: 'Artifact não aprovou (DEFERRED)' }],
    ...overrides,
  };
}

function dimension(overrides = {}) {
  return {
    id: 'RAP-052',
    score: 6,
    requirements: [
      { id: 'implemented', category: 'IMPLEMENTED', mandatory: true, status: 'PASS' },
      { id: 'governed', category: 'GOVERNED', mandatory: true, status: 'PASS' },
      requirement(),
      { id: 'no-known-gap', category: 'NO_KNOWN_GAP', mandatory: true, status: 'FAIL' },
    ],
    ...overrides,
  };
}

describe('deferral de fase do pacote em PRE_PACKAGE', () => {
  it('reconhece o requisito cuja falha é o artefato do pacote DEFERRED', () => {
    expect(isDeferredPackageRequirement(requirement())).toBe(true);
  });

  it('NÃO reconhece quando o artefato do pacote reprovou de verdade', () => {
    const failed = requirement({
      reason: 'Artifact não aprovou: governance/package-validation-report.json (FAIL)',
      evidence: [{ code: 'ARTIFACT_DID_NOT_PASS', path: 'governance/package-validation-report.json', reason: 'Artifact não aprovou (FAIL)' }],
    });
    expect(isDeferredPackageRequirement(failed)).toBe(false);
  });

  it('NÃO reconhece falha em outro artefato só porque está DEFERRED', () => {
    const otherArtifact = requirement({
      validator: ['reports/page-surface-report.json'],
      evidence: [{ code: 'ARTIFACT_DID_NOT_PASS', path: 'reports/page-surface-report.json', reason: '(DEFERRED)' }],
    });
    expect(isDeferredPackageRequirement(otherArtifact)).toBe(false);
  });

  it('reconhece a dimensão cuja única falha substantiva é a deferral do pacote', () => {
    expect(isPrePackageDeferredDimension(dimension())).toBe(true);
  });

  it('NÃO reconhece a dimensão que falha também fora do pacote', () => {
    const withRealFailure = dimension({
      requirements: [
        ...dimension().requirements,
        { id: 'runtime-validated-2', category: 'RUNTIME_VALIDATED', mandatory: true, status: 'FAIL', code: 'ARTIFACT_MISSING', validator: ['reports/page-surface-report.json'], reason: 'Artifact ausente' },
      ],
    });
    expect(isPrePackageDeferredDimension(withRealFailure)).toBe(false);
  });

  it('NÃO reconhece a dimensão cujo artefato do pacote foi REPROVADO', () => {
    const failed = dimension({
      requirements: [
        { id: 'implemented', category: 'IMPLEMENTED', mandatory: true, status: 'PASS' },
        requirement({
          reason: 'Artifact não aprovou (FAIL)',
          evidence: [{ code: 'ARTIFACT_DID_NOT_PASS', path: 'governance/package-validation-report.json', reason: '(FAIL)' }],
        }),
      ],
    });
    expect(isPrePackageDeferredDimension(failed)).toBe(false);
  });

  it('o artefato tolerado é exatamente o relatório do pacote', () => {
    expect(PRE_PACKAGE_DEFERRED_ARTIFACTS).toEqual(['governance/package-validation-report.json']);
  });
});

describe('status do gate de scorecard em PRE_PACKAGE', () => {
  const circular = () => true;

  it('10/10 é PASS', () => {
    const result = classifyBelow10Dimensions([{ id: 'RAP-001', score: 10, requirements: [] }], { isCircularOnly: circular });
    expect(result.status).toBe('PASS');
  });

  it('só dimensões deferidas/circulares é DEFERRED (nunca PASS)', () => {
    const result = classifyBelow10Dimensions(
      [dimension(), dimension({ id: 'RAP-054' }), dimension({ id: 'RAP-055' })],
      { deliveredPhaseDimensions: new Set(['RAP-055']), isCircularOnly: () => false },
    );
    expect(result.status).toBe('DEFERRED');
    expect(result.realFailures).toEqual([]);
    expect(result.classified.map((entry) => entry.kind)).toEqual(['PRE_PACKAGE_DEFERRED', 'PRE_PACKAGE_DEFERRED', 'DELIVERED_PHASE']);
  });

  it('uma falha real torna o gate FAIL', () => {
    const real = dimension({
      id: 'RAP-061',
      requirements: [
        { id: 'runtime-validated', category: 'RUNTIME_VALIDATED', mandatory: true, status: 'FAIL', code: 'ARTIFACT_DID_NOT_PASS', validator: ['reports/api-surface-report.json'], reason: 'Artifact não aprovou: reports/api-surface-report.json (FAIL)' },
      ],
    });
    const result = classifyBelow10Dimensions([dimension(), real], { isCircularOnly: () => false });
    expect(result.status).toBe('FAIL');
    expect(result.realFailures.map((entry) => entry.id)).toEqual(['RAP-061']);
  });

  it('falha MISTA (pacote deferido + relatório circular) também é deferida, não real', () => {
    // Caso real RAP-054: falha no pacote DEFERRED *e* no final-proof-report
    // NO_GO (auto-referente). A decisão é por REQUISITO.
    const mixed = dimension({
      id: 'RAP-054',
      requirements: [
        { id: 'implemented', category: 'IMPLEMENTED', mandatory: true, status: 'PASS' },
        requirement(),
        {
          id: 'governed',
          category: 'GOVERNED',
          mandatory: true,
          status: 'NO_GO',
          code: 'MANDATORY_GATE_NO_GO',
          validator: ['governance/final-proof-report.json'],
          reason: 'Artifact reporta NO_GO: governance/final-proof-report.json',
          evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: 'governance/final-proof-report.json', reason: 'Artifact reporta NO_GO' }],
        },
      ],
    });
    const result = classifyBelow10Dimensions([mixed], {
      isCircularOnly: () => false,
      isCircularRequirement: (r) => r.code === 'MANDATORY_GATE_NO_GO'
        && (r.validator || []).includes('governance/final-proof-report.json'),
    });
    expect(result.status).toBe('DEFERRED');
    expect(result.realFailures).toEqual([]);
    expect(result.classified[0].kind).toContain('PRE_PACKAGE_DEFERRED');
    expect(result.classified[0].kind).toContain('CIRCULAR_PROJECTION');
  });

  it('falha mista com um requisito REAL continua sendo falha real', () => {
    const mixedWithReal = dimension({
      id: 'RAP-099',
      requirements: [
        requirement(),
        {
          id: 'runtime-validated-2',
          category: 'RUNTIME_VALIDATED',
          mandatory: true,
          status: 'FAIL',
          code: 'ARTIFACT_MISSING',
          validator: ['reports/page-surface-report.json'],
          reason: 'Artifact ausente: reports/page-surface-report.json',
          evidence: [{ code: 'ARTIFACT_MISSING', path: 'reports/page-surface-report.json', reason: 'Artifact ausente' }],
        },
      ],
    });
    const result = classifyBelow10Dimensions([mixedWithReal], {
      isCircularOnly: () => false,
      // Predicado realista: só relatórios projetados são auto-referentes.
      isCircularRequirement: (r) => r.code === 'MANDATORY_GATE_NO_GO'
        && (r.validator || []).some((p) => p.startsWith('governance/final-')),
    });
    expect(result.status).toBe('FAIL');
    expect(result.realFailures.map((entry) => entry.id)).toEqual(['RAP-099']);
  });
});

describe('o gate de selagem NÃO herda a tolerância de fase', () => {
  it('RAP-052/054 não estão na lista de dimensões toleradas no selo', () => {
    expect(DELIVERED_PHASE_DIMS.has('RAP-052')).toBe(false);
    expect(DELIVERED_PHASE_DIMS.has('RAP-054')).toBe(false);
    expect([...DELIVERED_PHASE_DIMS].sort()).toEqual(['RAP-055', 'RAP-056']);
  });

  it('no selo, below10 contendo RAP-052 derruba o estado para SEAL_NO_GO', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-gate-'));
    fs.mkdirSync(path.join(rootDir, 'governance'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'governance', 'rap-master-scorecard.json'),
      JSON.stringify({
        dimensions: [
          { id: 'RAP-001', score: 10 },
          { id: 'RAP-052', score: 6 },
        ],
      }),
    );

    const state = evaluateSealState(rootDir);
    const scorecardFailure = (state.failures || []).find((failure) => failure.includes('MASTER_SCORECARD_NOT_10_OF_10'));
    expect(scorecardFailure).toBeDefined();
    expect(scorecardFailure).toContain('RAP-052');
    expect(state.decision).toBe('SEAL_NO_GO');
  });
});
