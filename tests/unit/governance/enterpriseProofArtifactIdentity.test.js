'use strict';

/**
 * T23b — contrato de identidade dos artefatos qa/enterprise/* produzidos
 * pelo enterprise proof smoke. Defeito medido em 2026-09-20 (run
 * rap-governed-20260920113643242-cac6169c): RAP-068 caiu com
 * ARTIFACT_CONTRACT_INCOMPLETE — qa/enterprise/pbx-voice-flow-prod-like.json
 * tinha lineage de origem (T15) mas SEM artifactType/artifactVersion, que o
 * master-scorecard-engine exige de todo artefato com requireLineage
 * (governance/master-scorecard-engine.js). O smoke já estampa lineage na
 * origem via stampArtifact; o tipo/versão do artefato têm que nascer no
 * mesmo carimbo — stamp posterior é adoção retroativa.
 */

const { stampArtifact } = require('../../../scripts/smoke/qa-waves-enterprise-proof-smoke');

describe('enterprise proof smoke — stampArtifact com contrato de identidade (T23b)', () => {
  it('artefato nasce com artifactType e artifactVersion', () => {
    const out = stampArtifact({ ok: true, signals: { tts: true } });
    expect(out.artifactType).toBeTruthy();
    expect(out.artifactVersion).toBeTruthy();
  });

  it('preserva payload e lineage de origem junto com o tipo', () => {
    const out = stampArtifact({ ok: true, evidencePaths: ['x.json'] });
    expect(out.ok).toBe(true);
    expect(out.evidencePaths).toEqual(['x.json']);
    expect(out).toHaveProperty('runId');
    expect(out).toHaveProperty('sourceFingerprint');
    expect(typeof out.artifactType).toBe('string');
    expect(typeof out.artifactVersion).toBe('string');
  });

  it('não sobrescreve artifactType/artifactVersion explícitos do produtor', () => {
    const out = stampArtifact({ ok: true, artifactType: 'custom-proof', artifactVersion: '2.1.0' });
    expect(out.artifactType).toBe('custom-proof');
    expect(out.artifactVersion).toBe('2.1.0');
  });
});
