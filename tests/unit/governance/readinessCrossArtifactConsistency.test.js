'use strict';

/**
 * G1–G5 (RED→GREEN) — invariante cross-artifact de CORE readiness.
 *
 * Defeito reproduzido: `export-governance-artifacts.js` publicava
 * `corePlatformReadiness.score` a partir de `evaluation.readiness_score` (run
 * persistido), enquanto o produtor canônico gravava
 * `readiness.readinessScore` em `dev/platform-readiness/latest.json`. Para o
 * MESMO `runId` + `sourceFingerprint` os dois números podiam divergir (100 × 0)
 * e nenhum gate apontava a contradição.
 */

const fs = require('fs');
const path = require('path');

const {
  evaluateReadinessConsistency,
  metricsOf,
} = require('../../../governance/readiness-consistency');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUN_ID = 'rap-governed-test-0001';
const FP = '0593e1abfebb2f35d74750213a03e5b80ee7f510a8b14e00b8b8adb790a5ed7d';

function artifact(overrides = {}) {
  return {
    runId: RUN_ID,
    sourceFingerprint: FP,
    finalDecision: 'AUTONOMOUS_READY_GO',
    blockingGaps: [],
    certificationStates: {
      corePlatformReadiness: { state: 'CORE_GO', score: 100, scope: 'plataforma' },
    },
    ...overrides,
  };
}

describe('G1–G5 invariante cross-artifact de CORE readiness', () => {
  describe('G5 — 0 vs 100 na mesma identidade é FALHA DE GOVERNAÇA (fail-closed)', () => {
    it('detecta divergência de score e NÃO escolhe o valor favorável', () => {
      const result = evaluateReadinessConsistency([
        { path: 'dev/platform-readiness/latest.json', artifact: artifact({ readiness: { readinessScore: 100 } }) },
        {
          path: 'governance/final-readiness-report.json',
          artifact: artifact({
            certificationStates: { corePlatformReadiness: { state: 'CORE_NOT_GO', score: 0 } },
          }),
        },
      ]);

      expect(result.status).toBe('FAIL');
      const scoreViolation = result.violations.find((v) => v.field === 'coreReadinessScore');
      expect(scoreViolation).toBeTruthy();
      expect(scoreViolation.code).toBe('READINESS_CROSS_ARTIFACT_DIVERGENCE');
      expect(scoreViolation.values.map((v) => v.value)).toEqual([100, 0]);
      // Nenhum valor é eleito como vencedor.
      expect(result.status).not.toBe('PASS');
    });

    it('detecta divergência de ESTADO mesmo com score igual', () => {
      const result = evaluateReadinessConsistency([
        { path: 'a.json', artifact: artifact() },
        {
          path: 'b.json',
          artifact: artifact({ certificationStates: { corePlatformReadiness: { state: 'CORE_NOT_GO', score: 100 } } }),
        },
      ]);
      expect(result.status).toBe('FAIL');
      expect(result.violations.some((v) => v.field === 'coreReadinessState')).toBe(true);
    });

    it('detecta divergência de DECISÃO', () => {
      const result = evaluateReadinessConsistency([
        { path: 'a.json', artifact: artifact() },
        { path: 'b.json', artifact: artifact({ finalDecision: 'NO_GO' }) },
      ]);
      expect(result.status).toBe('FAIL');
      expect(result.violations.some((v) => v.field === 'finalDecision')).toBe(true);
    });

    it('detecta divergência de blockingGaps', () => {
      const result = evaluateReadinessConsistency([
        { path: 'a.json', artifact: artifact() },
        { path: 'b.json', artifact: artifact({ blockingGaps: [{ id: 'g1' }] }) },
      ]);
      expect(result.status).toBe('FAIL');
      expect(result.violations.some((v) => v.field === 'blockingGapsCount')).toBe(true);
    });
  });

  describe('controle positivo', () => {
    it('mesma identidade com valores idênticos é PASS', () => {
      const result = evaluateReadinessConsistency([
        { path: 'a.json', artifact: artifact() },
        { path: 'b.json', artifact: artifact() },
      ]);
      expect(result.status).toBe('PASS');
      expect(result.violations).toEqual([]);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].consistent).toBe(true);
    });

    it('runIds diferentes NÃO são comparados entre si', () => {
      const result = evaluateReadinessConsistency([
        { path: 'a.json', artifact: artifact() },
        { path: 'b.json', artifact: artifact({ runId: 'outro-run' }) },
      ]);
      expect(result.status).toBe('PASS');
      expect(result.groups).toHaveLength(2);
    });
  });

  describe('G4 — identidade incompleta não vira PASS silencioso', () => {
    it('artefato sem runId/fingerprint entra em unreadable', () => {
      const result = evaluateReadinessConsistency([
        { path: 'sem-identidade.json', artifact: { certificationStates: { corePlatformReadiness: { state: 'CORE_GO', score: 100 } } } },
      ]);
      expect(result.unreadable).toContain('sem-identidade.json');
      expect(result.groups).toEqual([]);
    });

    it('artefato sem bloco de core readiness entra em unreadable', () => {
      const result = evaluateReadinessConsistency([
        { path: 'sem-bloco.json', artifact: { runId: RUN_ID, sourceFingerprint: FP } },
      ]);
      expect(result.unreadable).toContain('sem-bloco.json');
    });
  });

  describe('metricsOf normaliza as duas formas em uso', () => {
    it('lê certificationStates.corePlatformReadiness', () => {
      expect(metricsOf(artifact()).coreReadinessScore).toBe(100);
    });

    it('lê corePlatformReadiness de topo', () => {
      expect(metricsOf({ runId: RUN_ID, sourceFingerprint: FP, corePlatformReadiness: { state: 'CORE_GO', score: 100 } }).coreReadinessScore).toBe(100);
    });

    it('lê readiness.readinessScore da projeção do produtor externo', () => {
      const metrics = metricsOf({ runId: RUN_ID, sourceFingerprint: FP, readiness: { readinessScore: 100 } });
      expect(metrics.coreReadinessScore).toBe(100);
      expect(metrics.hasCoreReadinessBlock).toBe(true);
    });
  });

  describe('estado real do repositorio', () => {
    const files = [
      'governance/final-readiness-report.json',
      'dev/platform-readiness/latest.json',
    ];

    it('os artefatos reais da mesma identidade estão coerentes', () => {
      const entries = files.map((rel) => ({ path: rel, artifact: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')) }));
      const result = evaluateReadinessConsistency(entries);
      expect(result.violations).toEqual([]);
      expect(result.status).toBe('PASS');
    });

    it('nenhum artefato real publica score de core readiness nulo', () => {
      for (const rel of files) {
        const metrics = metricsOf(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')));
        expect(metrics.coreReadinessScore).not.toBeNull();
      }
    });
  });
});
