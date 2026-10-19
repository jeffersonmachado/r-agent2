'use strict';

/**
 * tests/unit/securityIntel/securityGateProvenance.test.js
 *
 * PROVA que a checagem de proveniência do Security Release Gate CONSEGUE FALHAR.
 *
 * CONTEXTO: a regra nasceu inline em `main()` de `validate-security-release-gate.js`.
 * Nessa forma ela era intestável — e um gate que não pode falhar é um defeito
 * conhecido deste repositório (a checagem existe, dá sensação de proteção e não
 * bloqueia nada). Extraída para `resolveSecurityProvenance`, cada código de recusa
 * passa a ter CONTROLE POSITIVO obrigatório: um cenário que o DISPARA.
 *
 * Sem os controles positivos deste arquivo, a implementação anterior havia
 * executado nos testes reais SEM acusar nada (verdadeiro negativo) — indistinguível
 * de código morto.
 */

const {
  resolveSecurityProvenance,
} = require('../../../scripts/governance/lib/security-gate-provenance');

/** Run governado corrente — a fonte de verdade temporal. */
const CURRENT_RUN = Object.freeze({
  runId: 'rap-governed-20261010045617268-19ce0cbd',
  sourceFingerprint: 'ee991914bddf1787c34fda9eff5cccbc96b55570390c8569102f431458a8ffbc',
  sourceCommit: '4e34287f23390648caf2101d2975c9d0500d0ed4',
  startedAt: '2026-10-10T04:56:17.406Z',
});

const LINEAGE_OK = Object.freeze({
  runId: CURRENT_RUN.runId,
  sourceFingerprint: CURRENT_RUN.sourceFingerprint,
  source: 'current-run-file',
});

const codesOf = (issues) => issues.map((item) => item.code);

describe('Security Gate — proveniência do veredito (fail-closed)', () => {
  test('VERDADEIRO NEGATIVO: SBOM do próprio run, posterior ao startedAt ⇒ nada a recusar', () => {
    const issues = resolveSecurityProvenance({
      lineage: LINEAGE_OK,
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: '2026-10-10T05:10:00.000Z', runId: CURRENT_RUN.runId },
    });
    // Sem recusa, a decisão do motor prevalece (pode ser GO).
    expect(issues).toEqual([]);
  });

  test('CONTROLE POSITIVO — SBOM ANTERIOR ao run ⇒ SECURITY_GATE_STALE_EVIDENCE', () => {
    const issues = resolveSecurityProvenance({
      lineage: LINEAGE_OK,
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: '2026-10-09T10:29:12.063Z', runId: CURRENT_RUN.runId },
    });
    expect(codesOf(issues)).toContain('SECURITY_GATE_STALE_EVIDENCE');
    expect(issues[0].message).toContain('ANTERIOR');
  });

  test('CONTROLE POSITIVO — SBOM de OUTRO run ⇒ SECURITY_GATE_FOREIGN_RUN', () => {
    const issues = resolveSecurityProvenance({
      lineage: LINEAGE_OK,
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: '2026-10-10T05:10:00.000Z', runId: 'rap-governed-20261008144342533-e3f691f1' },
    });
    expect(codesOf(issues)).toContain('SECURITY_GATE_FOREIGN_RUN');
  });

  test('CONTROLE POSITIVO — sem run governado ⇒ SECURITY_GATE_NO_GOVERNED_RUN', () => {
    const issues = resolveSecurityProvenance({
      lineage: { runId: null, sourceFingerprint: null, source: 'none' },
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: '2026-10-10T05:10:00.000Z' },
    });
    expect(codesOf(issues)).toContain('SECURITY_GATE_NO_GOVERNED_RUN');
  });

  test('CONTROLE POSITIVO — run corrente ilegível ⇒ SECURITY_GATE_UNAVAILABLE (nunca PASS por ausência)', () => {
    for (const currentRun of [null, undefined, {}, { startedAt: CURRENT_RUN.startedAt }]) {
      const issues = resolveSecurityProvenance({
        lineage: LINEAGE_OK,
        currentRun,
        sbom: { generatedAt: '2026-10-10T05:10:00.000Z' },
      });
      expect(codesOf(issues)).toContain('SECURITY_GATE_UNAVAILABLE');
    }
  });

  test('SBOM reusado entre runs (run_id NULLABLE por desenho) não é recusado só por isso', () => {
    // A unicidade do snapshot é (tenant_key, sha256) ⇒ ele É reusado de propósito.
    // Sem este caso, a checagem puniria o comportamento correto do produtor.
    const issues = resolveSecurityProvenance({
      lineage: LINEAGE_OK,
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: '2026-10-10T05:10:00.000Z', runId: null },
    });
    expect(codesOf(issues)).not.toContain('SECURITY_GATE_FOREIGN_RUN');
    expect(issues).toEqual([]);
  });

  test('ANTI "GATE QUE NÃO PODE FALHAR": os 4 códigos de recusa são todos alcançáveis', () => {
    const reached = new Set([
      ...codesOf(resolveSecurityProvenance({ lineage: LINEAGE_OK, currentRun: CURRENT_RUN, sbom: { generatedAt: '2026-01-01T00:00:00.000Z' } })),
      ...codesOf(resolveSecurityProvenance({ lineage: LINEAGE_OK, currentRun: CURRENT_RUN, sbom: { runId: 'outro-run' } })),
      ...codesOf(resolveSecurityProvenance({ lineage: { source: 'none' }, currentRun: CURRENT_RUN, sbom: {} })),
      ...codesOf(resolveSecurityProvenance({ lineage: LINEAGE_OK, currentRun: null, sbom: {} })),
    ]);
    expect([...reached].sort()).toEqual([
      'SECURITY_GATE_FOREIGN_RUN',
      'SECURITY_GATE_NO_GOVERNED_RUN',
      'SECURITY_GATE_STALE_EVIDENCE',
      'SECURITY_GATE_UNAVAILABLE',
    ]);
  });

  test('datetime inválido não vira recusa falsa (nem esconde vínculo ausente)', () => {
    const issues = resolveSecurityProvenance({
      lineage: LINEAGE_OK,
      currentRun: CURRENT_RUN,
      sbom: { generatedAt: 'não-é-data' },
    });
    expect(codesOf(issues)).not.toContain('SECURITY_GATE_STALE_EVIDENCE');
  });
});

describe('run ENCERRADO não é run corrente (família H20)', () => {
  const sbomFresco = { generatedAt: '2026-10-17T12:00:00.000Z', runId: 'run-atual' };
  const runAberto = { runId: 'run-atual', startedAt: '2026-10-17T11:00:00.000Z', sourceFingerprint: 'f'.repeat(64) };

  test('run ABANDONED ⇒ SECURITY_GATE_RUN_CLOSED (não culpa o SBOM)', () => {
    const issues = resolveSecurityProvenance({
      lineage: { runId: 'run-atual', source: 'governance/.current-run.json' },
      currentRun: { ...runAberto, status: 'ABANDONED', closedAt: '2026-10-17T13:00:00.000Z' },
      sbom: sbomFresco,
    });
    expect(codesOf(issues)).toContain('SECURITY_GATE_RUN_CLOSED');
    expect(codesOf(issues)).not.toContain('SECURITY_GATE_STALE_EVIDENCE');
  });

  test('run SUPERSEDED ⇒ SECURITY_GATE_RUN_CLOSED', () => {
    const issues = resolveSecurityProvenance({
      lineage: { runId: 'run-atual', source: 'governance/.current-run.json' },
      currentRun: { ...runAberto, status: 'SUPERSEDED' },
      sbom: sbomFresco,
    });
    expect(codesOf(issues)).toContain('SECURITY_GATE_RUN_CLOSED');
  });

  test('run ABERTO com SBOM fresco segue sem recusa (controle positivo)', () => {
    const issues = resolveSecurityProvenance({
      lineage: { runId: 'run-atual', source: 'governance/.current-run.json' },
      currentRun: runAberto,
      sbom: sbomFresco,
    });
    expect(issues).toEqual([]);
  });
});
