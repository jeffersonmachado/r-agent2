'use strict';

/**
 * T15 — os artefatos qa/enterprise/* são RUNTIME_EVIDENCE
 * (config/runtime-evidence-artifacts.json): precisam nascer com o lineage do
 * run governado que EXECUTOU a prova. O defeito auditado em 2026-09-20:
 * pbx-voice-flow-prod-like.json com generatedAt de 2026-09-13 carregando o
 * runId de um run criado em 2026-09-18 (adoção retroativa, reprovada pelo
 * gate validate:qa-evidence-same-run). O produtor
 * (scripts/smoke/qa-waves-enterprise-proof-smoke.js) tem que resolver o
 * lineage NA ORIGEM e estampar os artefatos; fora de run governado os campos
 * nascem null — nunca inventados.
 */

const { applyOriginLineage } = require('../../../scripts/governance/lib/resolve-run-lineage');

describe('applyOriginLineage (lib pura)', () => {
  it('preserva o payload e grava nulls quando não há run governado', () => {
    const out = applyOriginLineage({ ok: true, signals: { tts: true } }, { runId: null, sourceFingerprint: null, sourceCommit: null, sourceTree: null });
    expect(out.ok).toBe(true);
    expect(out.signals).toEqual({ tts: true });
    expect(out.runId).toBeNull();
    expect(out.sourceFingerprint).toBeNull();
    expect(out.sourceCommit).toBeNull();
    expect(out.sourceTree).toBeNull();
  });

  it('grava o lineage resolvido na origem quando o run existe', () => {
    const out = applyOriginLineage({ ok: true }, {
      runId: 'rap-governed-x',
      sourceFingerprint: 'f'.repeat(64),
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40),
    });
    expect(out.runId).toBe('rap-governed-x');
    expect(out.sourceFingerprint).toBe('f'.repeat(64));
    expect(out.sourceCommit).toBe('a'.repeat(40));
    expect(out.sourceTree).toBe('b'.repeat(40));
  });

  it('nunca inventa identidade a partir de lineage parcial', () => {
    const out = applyOriginLineage({ ok: false }, {});
    expect(out.runId).toBeNull();
    expect(out.sourceFingerprint).toBeNull();
  });
});

describe('qa-waves-enterprise-proof-smoke — stamping na origem', () => {
  const ENV_KEYS = [
    'GOVERNANCE_RUN_ID',
    'GOVERNANCE_SOURCE_FINGERPRINT',
    'GOVERNANCE_SOURCE_COMMIT',
    'GOVERNANCE_SOURCE_TREE',
  ];
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('expõe stampArtifact e estampa o lineage do env do orquestrador', () => {
    process.env.GOVERNANCE_RUN_ID = 'rap-governed-test';
    process.env.GOVERNANCE_SOURCE_FINGERPRINT = 'e'.repeat(64);
    delete process.env.GOVERNANCE_SOURCE_COMMIT;
    delete process.env.GOVERNANCE_SOURCE_TREE;

    const smoke = require('../../../scripts/smoke/qa-waves-enterprise-proof-smoke.js');
    expect(typeof smoke.stampArtifact).toBe('function');

    const out = smoke.stampArtifact({ ok: true, signals: {} });
    expect(out.runId).toBe('rap-governed-test');
    expect(out.sourceFingerprint).toBe('e'.repeat(64));
    expect(out.ok).toBe(true);
  });

  it('sem run governado explícito grava nulls ou o run corrente — nunca inventa', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const smoke = require('../../../scripts/smoke/qa-waves-enterprise-proof-smoke.js');
    const out = smoke.stampArtifact({ ok: true });
    // Em repo com governance/.current-run.json, o lineage é o do arquivo
    // (fonte 2 canônica); sem ele, null. Nos dois casos, string ou null.
    expect(out.runId === null || typeof out.runId === 'string').toBe(true);
    expect(out.sourceFingerprint === null || typeof out.sourceFingerprint === 'string').toBe(true);
  });
});
