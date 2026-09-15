'use strict';

/**
 * T-MR3 — NENHUMA MUTAÇÃO MANUAL DO SAMPLE: o caminho versionado e auditável
 * para aplicar a saída de um run de market discovery ao sample versionado
 * (`config/benchmarks/<vertical>.json`) é o GERADOR
 * `scripts/benchmark/apply-market-discovery-to-sample.js`.
 *
 * Provas:
 *   1. determinístico: mesma entrada → mesma saída (byte a byte);
 *   2. idempotente: aplicar duas vezes não muda o resultado;
 *   3. recusa run não concluído, holdout não pré-registrado e candidato sem
 *      evidência — nunca escreve proveniência fabricada;
 *   4. disciplina de chaves gerenciadas: entradas do sample que NÃO vieram
 *      deste gerador são preservadas intocadas;
 *   5. `--check` detecta drift (exit 1) e passa em sincronia (exit 0), no CLI
 *      real sobre arquivos temporários.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  GENERATOR_ID,
  MANAGED_KEYS,
  ERROR_CODES,
  applyMarketDiscoveryToSample,
} = require('../../../scripts/benchmark/apply-market-discovery-to-sample');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'benchmark', 'apply-market-discovery-to-sample.js');

function buildRunExport(overrides = {}) {
  return {
    runId: 'mdr-test-run',
    vertical: 'fitness-lab',
    discoveryVersion: 'fitness-lab-discovery-v1',
    state: 'MARKET_DISCOVERY_HANDED_OFF',
    completedAt: '2026-09-15T12:00:00.000Z',
    discoverySetId: 'mds-test-set',
    selectedCandidates: ['alpha-gym.com', 'beta-fit.com'],
    holdout: {
      candidateKey: 'gymnovo.com',
      preregistered: true,
      preregisteredAt: '2026-09-15T11:59:00.000Z',
      basis: { reason: 'mais distante do set por arquétipo e geografia' },
    },
    candidates: [
      {
        candidateKey: 'alpha-gym.com',
        name: 'Alpha Gym',
        officialSite: 'https://alpha-gym.com/',
        country: 'BR',
        archetypes: ['independent-gym'],
        independenceGroup: 'alpha',
        sourceEvidence: [{ url: 'https://alpha-gym.com/', evidenceRef: 'ev-alpha', contentHash: 'h1' }],
      },
      {
        candidateKey: 'beta-fit.com',
        name: 'Beta Fit',
        officialSite: 'https://beta-fit.com/',
        country: 'BR',
        archetypes: ['financial-billing'],
        independenceGroup: 'beta',
        sourceEvidence: [{ url: 'https://beta-fit.com/', evidenceRef: 'ev-beta', contentHash: 'h2' }],
      },
      {
        candidateKey: 'gymnovo.com',
        name: 'GymNovo',
        officialSite: 'https://gymnovo.com/',
        country: 'US',
        archetypes: ['financial-billing'],
        independenceGroup: 'gymnovo',
        sourceEvidence: [{ url: 'https://gymnovo.com/', evidenceRef: 'ev-gymnovo', contentHash: 'h3' }],
      },
    ],
    ...overrides,
  };
}

function buildSample() {
  return {
    vertical: 'fitness-lab',
    sampleVersion: 'fitness-lab-sample-v1',
    inventoryVersion: 'inv-1',
    canonicalInventoryBaseline: 10,
    canonicalJourneyInventoryBaseline: 5,
    canonicalBusinessRuleInventoryBaseline: 5,
    archetypes: [
      { id: 'independent-gym', importance: 'REQUIRED', status: 'ACTIVE', name: 'Academia independente' },
      { id: 'financial-billing', importance: 'REQUIRED', status: 'ACTIVE', name: 'Financeiro e cobrança' },
    ],
    benchmarks: [
      {
        id: 'legacy-manual',
        name: 'Legacy Manual',
        role: 'discovery',
        order: 1,
        archetype: 'independent-gym',
        independenceGroup: 'g-legacy',
        sources: [{ url: 'https://legacy.example.com/', tier: 5 }],
        novelty: {},
      },
    ],
    holdout: { benchmarkId: 'legacy-manual', selectedAsHoldoutAt: '2026-09-01T00:00:00.000Z', selectionReason: 'histórico' },
  };
}

describe('apply-market-discovery-to-sample — núcleo puro', () => {
  test('aplica o discovery set com proveniência por item e preserva entradas alheias', () => {
    const next = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });

    // Entrada alheia (não gerenciada) preservada intacta.
    const legacy = next.benchmarks.find((b) => b.id === 'legacy-manual');
    expect(legacy).toEqual(buildSample().benchmarks[0]);

    // Entradas do discovery set com proveniência completa por item.
    const alpha = next.benchmarks.find((b) => b.id === 'alpha-gym.com');
    expect(alpha).toEqual(expect.objectContaining({
      role: 'discovery',
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
    }));
    expect(alpha.provenance).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      marketDiscoveryRunId: 'mdr-test-run',
      discoverySetId: 'mds-test-set',
      appliedAt: '2026-09-15T12:00:00.000Z',
    }));
    expect(alpha.provenance.evidenceRefs).toEqual(['ev-alpha']);

    // O holdout pré-registrado vira o holdout do sample (role validation).
    const holdout = next.benchmarks.find((b) => b.id === 'gymnovo.com');
    expect(holdout.role).toBe('validation');
    expect(next.holdout).toEqual(expect.objectContaining({
      benchmarkId: 'gymnovo.com',
      selectedAsHoldoutAt: '2026-09-15T11:59:00.000Z',
    }));
    expect(next.holdout.provenance.marketDiscoveryRunId).toBe('mdr-test-run');

    // Seção de proveniência do run.
    expect(next.marketDiscoveryProvenance).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      marketDiscoveryRunId: 'mdr-test-run',
      discoverySetId: 'mds-test-set',
      appliedAt: '2026-09-15T12:00:00.000Z',
      selectedCandidates: ['alpha-gym.com', 'beta-fit.com'],
      holdoutCandidateKey: 'gymnovo.com',
    }));
  });

  test('determinístico e idempotente', () => {
    const first = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });
    const again = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));

    const reapplied = applyMarketDiscoveryToSample({ sample: first, runExport: buildRunExport() });
    expect(JSON.stringify(reapplied)).toBe(JSON.stringify(first));
  });

  test('recusa run não concluído', () => {
    expect(() => applyMarketDiscoveryToSample({
      sample: buildSample(),
      runExport: buildRunExport({ state: 'MARKET_SCANNED' }),
    })).toThrow(new RegExp(ERROR_CODES.RUN_NOT_COMPLETED));
  });

  test('recusa holdout não pré-registrado', () => {
    expect(() => applyMarketDiscoveryToSample({
      sample: buildSample(),
      runExport: buildRunExport({ holdout: { candidateKey: 'gymnovo.com', preregistered: false, preregisteredAt: null } }),
    })).toThrow(new RegExp(ERROR_CODES.HOLDOUT_NOT_PREREGISTERED));
  });

  test('recusa candidato selecionado sem evidência (nunca proveniência fabricada)', () => {
    const runExport = buildRunExport();
    runExport.candidates[1].sourceEvidence = [];
    expect(() => applyMarketDiscoveryToSample({ sample: buildSample(), runExport }))
      .toThrow(new RegExp(ERROR_CODES.EVIDENCE_MISSING));
  });

  test('só as chaves gerenciadas mudam', () => {
    const sample = buildSample();
    const next = applyMarketDiscoveryToSample({ sample, runExport: buildRunExport() });
    const managed = new Set([...MANAGED_KEYS]);
    for (const key of Object.keys(next)) {
      if (managed.has(key)) continue;
      expect(JSON.stringify(next[key])).toBe(JSON.stringify(sample[key]));
    }
  });
});

describe('apply-market-discovery-to-sample — CLI com --check', () => {
  function withTempDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sample-'));
    try {
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function writeFixtures(dir) {
    const samplePath = path.join(dir, 'sample.json');
    const exportPath = path.join(dir, 'run-export.json');
    fs.writeFileSync(samplePath, `${JSON.stringify(buildSample(), null, 2)}\n`);
    fs.writeFileSync(exportPath, `${JSON.stringify(buildRunExport(), null, 2)}\n`);
    return { samplePath, exportPath };
  }

  function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  }

  test('write → --check PASS; drift → --check FAIL; re-write → idempotente', () => {
    withTempDir((dir) => {
      const { samplePath, exportPath } = writeFixtures(dir);

      const write = runCli(['--sample', samplePath, '--export', exportPath]);
      expect(write.status).toBe(0);

      const check = runCli(['--sample', samplePath, '--export', exportPath, '--check']);
      expect(check.status).toBe(0);

      // Idempotência byte a byte.
      const before = fs.readFileSync(samplePath, 'utf8');
      const rewrite = runCli(['--sample', samplePath, '--export', exportPath]);
      expect(rewrite.status).toBe(0);
      expect(fs.readFileSync(samplePath, 'utf8')).toBe(before);

      // Drift: mutação manual da chave gerenciada é detectada.
      const drifted = JSON.parse(before);
      drifted.marketDiscoveryProvenance.selectedCandidates = ['alpha-gym.com'];
      fs.writeFileSync(samplePath, `${JSON.stringify(drifted, null, 2)}\n`);
      const drift = runCli(['--sample', samplePath, '--export', exportPath, '--check']);
      expect(drift.status).toBe(1);
      expect(`${drift.stdout}${drift.stderr}`).toMatch(/drift/i);
    });
  });

  test('--export ausente exige banco (fail-closed, nunca silêncio)', () => {
    withTempDir((dir) => {
      const { samplePath } = writeFixtures(dir);
      const result = runCli(['--sample', samplePath, '--run-id', 'mdr-inexistente', '--check']);
      // Sem export E sem banco configurado no ambiente do filho: a única saída
      // aceitável é erro explícito (persistence_required / fonte ausente),
      // nunca exit 0 silencioso.
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/persistence_required|market_run_source_required|market_discovery_run_not_found/);
    });
  });
});
