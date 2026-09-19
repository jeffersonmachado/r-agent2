'use strict';

/**
 * Regressão do defeito REAL de lineage retroativo (2026-09-19).
 *
 * O defeito: `qa-mesh/go-no-go-report.json` foi produzido em
 * 2026-09-18T10:46:59.739Z e recebeu, via
 * `scripts/governance/stamp-report-lineage.js`, o `runId`
 * `rap-governed-20260918201837632-be6d7695` — um GovernanceRun criado ~9h32
 * depois. O `generatedAt` original foi PRESERVADO, então o artefato passou a
 * afirmar ter sido produzido por um run posterior à sua criação.
 *
 * Estes testes travam o mecanismo nos dois sentidos:
 *   1. o produtor (stamp) RECUSA artefatos de RUNTIME_EVIDENCE;
 *   2. o stamp continua funcionando para relatórios derivados legítimos.
 *
 * Sem o teste 2, "recusar tudo" passaria como correção.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MODES,
  REASONS,
  isRuntimeEvidenceArtifact,
  isDerivedReportArtifact,
  listRuntimeEvidenceArtifacts,
  getModeForArtifact,
} = require('../../../scripts/governance/lib/runtime-evidence-artifacts');
const { stamp } = require('../../../scripts/governance/stamp-report-lineage');

const RUN = {
  run_id: 'rap-governed-TEST-run',
  source_fingerprint: 'f'.repeat(64),
};

const RUNTIME_EVIDENCE_SAMPLE = 'qa-mesh/go-no-go-report.json';
const DERIVED_SAMPLE = 'reports/route-mount-report.json';

describe('runtime-evidence-artifacts (classificação canônica)', () => {
  it('classifica o artefato do defeito real como RUNTIME_EVIDENCE', () => {
    expect(getModeForArtifact(RUNTIME_EVIDENCE_SAMPLE)).toBe(MODES.RUNTIME_EVIDENCE);
    expect(isRuntimeEvidenceArtifact(RUNTIME_EVIDENCE_SAMPLE)).toBe(true);
    expect(isDerivedReportArtifact(RUNTIME_EVIDENCE_SAMPLE)).toBe(false);
  });

  it('classifica o artefato derivado como DERIVED_REPORT', () => {
    expect(getModeForArtifact(DERIVED_SAMPLE)).toBe(MODES.DERIVED_REPORT);
    expect(isDerivedReportArtifact(DERIVED_SAMPLE)).toBe(true);
  });

  it('normaliza separadores e prefixos ao classificar', () => {
    expect(isRuntimeEvidenceArtifact('./qa-mesh\\go-no-go-report.json')).toBe(true);
    expect(isRuntimeEvidenceArtifact('QA-MESH/go-no-go-report.json')).toBe(false);
  });

  it('classifica todo artefato declarado (sem caminho órfão)', () => {
    const runtime = listRuntimeEvidenceArtifacts();
    expect(runtime.length).toBeGreaterThan(0);
    for (const artifact of runtime) {
      expect(getModeForArtifact(artifact)).toBe(MODES.RUNTIME_EVIDENCE);
    }
    expect(runtime).toContain(RUNTIME_EVIDENCE_SAMPLE);
  });

  it('não classifica caminho desconhecido', () => {
    expect(getModeForArtifact('reports/inexistente.json')).toBeNull();
  });
});

describe('stamp-report-lineage — recusa de lineage retroativo', () => {
  let tempRoot;
  let originalCwd;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-lineage-'));
    originalCwd = process.cwd();
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('RECUSA estampar artefato de RUNTIME_EVIDENCE mesmo existindo no disco', () => {
    const rel = RUNTIME_EVIDENCE_SAMPLE;
    fs.mkdirSync(path.dirname(path.join(tempRoot, rel)), { recursive: true });
    // Evidência real: produzida ANTES do run que tentaria adotá-la.
    const original = {
      status: 'GO',
      generatedAt: '2026-09-18T10:46:59.739Z',
      totals: { scenarios: 139 },
    };
    fs.writeFileSync(path.join(tempRoot, rel), JSON.stringify(original, null, 2), 'utf8');

    const result = stamp(rel, RUN);

    expect(result.stamped).toBe(false);
    expect(result.reason).toBe(REASONS.RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE);

    // Prova que o arquivo NÃO foi tocado: o runId estrangeiro não entrou.
    const after = JSON.parse(fs.readFileSync(path.join(tempRoot, rel), 'utf8'));
    expect(after).toEqual(original);
    expect(after.runId).toBeUndefined();
    expect(after.sourceFingerprint).toBeUndefined();
  });

  it('CONTINUA estampando relatório derivado (recusa não é cega)', () => {
    const rel = DERIVED_SAMPLE;
    fs.mkdirSync(path.dirname(path.join(tempRoot, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, rel),
      JSON.stringify({ status: 'PASS', generatedAt: '2026-09-18T10:46:59.739Z' }, null, 2),
      'utf8',
    );

    const result = stamp(rel, RUN);

    expect(result.stamped).toBe(true);
    const after = JSON.parse(fs.readFileSync(path.join(tempRoot, rel), 'utf8'));
    expect(after.runId).toBe(RUN.run_id);
    expect(after.sourceFingerprint).toBe(RUN.source_fingerprint);
  });

  it('não inventa lineage para arquivo ausente', () => {
    const result = stamp('reports/route-mount-report.json', RUN);
    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('missing');
  });
});
