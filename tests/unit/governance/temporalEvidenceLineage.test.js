'use strict';

/**
 * TEMPORAL EVIDENCE LINEAGE — matriz de prova (missão 2026-10-05).
 *
 * DEFEITO REAL MEDIDO (release r-agent2-20261005-011259, dentro do payload):
 *   governance/mutable-json-state-validation-report.json  generatedAt=01:20:06
 *   governance/json-persistence-audit.json                generatedAt=01:20:05
 * enquanto o run só começou às 02:30:45 — e os dois carregavam o runId e o
 * sourceFingerprint desse run. Todas as outras checagens passavam (runId certo,
 * fingerprint certo, artifactType presente): só o TEMPO prova que nada rodou nele.
 *
 * Estes testes extraem/provocam o comportamento REAL:
 *   - stamp-report-lineage.js contra artefato pré-run (deve RECUSAR e não escrever)
 *   - gate CURRENT_RUN_TEMPORAL_INTEGRITY (deve contar e reprovar)
 *   - Master Scorecard (não pode dar 10/10 com evidência pré-run)
 *   - isolamento de histórico/transicional e fail-closed de não classificado
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const authority = require('../../../scripts/governance/lib/runtime-evidence-artifacts');
const { stamp } = require('../../../scripts/governance/stamp-report-lineage');
const { evaluateRunTemporalIntegrity } = require('../../../scripts/governance/validate-current-run-temporal-integrity');
const { evaluateEvidence } = require('../../../governance/master-scorecard-engine');

// Valores do caso real (não inventados): o run do release auditado e o artefato
// do RAP-078 que ficou pré-run dentro do pacote.
const RUN = {
  run_id: 'rap-governed-20261005023044918-48ad43cf',
  source_fingerprint: 'c35b1f6ec98fa0641c8002976de114f39462e532f9883011bfd364c8da14ed54',
  started_at: '2026-10-05T02:30:45.064Z',
};
const PRE_RUN = '2026-10-05T01:20:06.189Z';
const IN_RUN = '2026-10-05T03:00:00.000Z';
const RAP078 = 'governance/mutable-json-state-validation-report.json';

const originalCwd = process.cwd();
const tempRoots = [];

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-lineage-'));
  tempRoots.push(dir);
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'governance', '.current-run.json'),
    JSON.stringify({ runId: RUN.run_id, sourceFingerprint: RUN.source_fingerprint, startedAt: RUN.started_at }, null, 2),
  );
  return dir;
}

function lineage(generatedAt, extra = {}) {
  return {
    artifactType: 'mutable-json-state-validation-report',
    artifactVersion: '1.0.0',
    runId: RUN.run_id,
    sourceFingerprint: RUN.source_fingerprint,
    generatedAt,
    status: 'PASS',
    ...extra,
  };
}

function writeArtifact(root, relativePath, value) {
  const abs = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(abs, text);
  return { abs, text };
}

afterEach(() => {
  process.chdir(originalCwd);
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('estampagem retroativa — DERIVED/CERTIFICATION pré-run não pode ganhar lineage', () => {
  test('RAP-078 pré-run: stamp RECUSA e o arquivo NÃO é modificado', () => {
    const root = workspace();
    const { abs, text } = writeArtifact(root, RAP078, lineage(PRE_RUN));
    process.chdir(root);

    const outcome = stamp(RAP078, RUN);

    expect(outcome.stamped).toBe(false);
    expect(outcome.reason).toBe(authority.REASONS.REJECTED_STALE_ARTIFACT);
    // Prova material: bytes idênticos (nada de generatedAt reescrito nem runId injetado).
    expect(fs.readFileSync(abs, 'utf8')).toBe(text);
  });

  test('mesmo run: stamp ACEITA e PRESERVA o generatedAt real do produtor', () => {
    const root = workspace();
    // artefato sem lineage, mas produzido DENTRO do run (pelo validador)
    const { abs } = writeArtifact(root, RAP078, {
      artifactType: 'mutable-json-state-validation-report',
      artifactVersion: '1.0.0',
      generatedAt: IN_RUN,
      status: 'PASS',
    });
    process.chdir(root);

    const outcome = stamp(RAP078, RUN);

    expect(outcome.stamped).toBe(true);
    const written = JSON.parse(fs.readFileSync(abs, 'utf8'));
    expect(written.runId).toBe(RUN.run_id);
    expect(written.generatedAt).toBe(IN_RUN);
  });

  test('artefato NÃO classificado não é estampado (fail-closed, nunca "por desconhecido")', () => {
    const root = workspace();
    writeArtifact(root, 'reports/desconhecido.json', { generatedAt: IN_RUN, status: 'PASS' });
    process.chdir(root);

    const outcome = stamp('reports/desconhecido.json', RUN);

    expect(outcome.stamped).toBe(false);
    expect(outcome.reason).toBe(authority.REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT);
  });

  test('RUNTIME_EVIDENCE continua exigindo lineage na ORIGEM (não regrediu)', () => {
    const root = workspace();
    writeArtifact(root, 'qa-mesh/go-no-go-report.json', { generatedAt: IN_RUN, status: 'GO' });
    process.chdir(root);

    const outcome = stamp('qa-mesh/go-no-go-report.json', RUN);

    expect(outcome.stamped).toBe(false);
    expect(outcome.reason).toBe(authority.REASONS.RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE);
  });
});

describe('gate CURRENT_RUN_TEMPORAL_INTEGRITY', () => {
  test('artefato autoritativo pré-run reprova o run (o caso do payload)', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage(PRE_RUN));

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(evaluation.status).toBe('FAIL');
    expect(evaluation.totals.preRunArtifacts).toBeGreaterThanOrEqual(1);
    const violation = evaluation.violations.find((entry) => entry.path === RAP078);
    expect(violation).toBeTruthy();
    expect(violation.code).toBe('PRE_RUN_AUTHORITATIVE_ARTIFACT');
    expect(violation.producer).toMatchObject({ command: 'npm run verify:no-mutable-json-state' });
  });

  test('mesma evidência produzida no run: SAME_RUN e sem violação', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage(IN_RUN));

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(evaluation.totals.preRunArtifacts).toBe(0);
    expect(evaluation.entries.find((entry) => entry.path === RAP078).status).toBe(authority.STATUS.SAME_RUN);
    expect(evaluation.violations.find((entry) => entry.path === RAP078)).toBeUndefined();
  });

  test('artefato consumido em decisão SEM classificação = NO_GO (fail-closed)', () => {
    const root = workspace();
    writeArtifact(root, 'reports/nao-classificado-consumido.json', lineage(IN_RUN));

    const evaluation = evaluateRunTemporalIntegrity({
      root,
      run: RUN,
      declaredPaths: ['reports/nao-classificado-consumido.json'],
    });

    expect(evaluation.status).toBe('FAIL');
    expect(evaluation.totals.unknownClassification).toBeGreaterThanOrEqual(1);
    expect(evaluation.violations.some((entry) => entry.code === 'UNCLASSIFIED_AUTHORITATIVE_ARTIFACT')).toBe(true);
  });

  test('run ERRADO e fonte ERRADA são distinguidos', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage(IN_RUN, { runId: 'rap-governed-de-outro-run' }));
    writeArtifact(root, 'governance/json-persistence-audit.json', lineage(IN_RUN, { sourceFingerprint: 'fingerprint-de-outra-fonte' }));

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(evaluation.totals.wrongRunArtifacts).toBeGreaterThanOrEqual(1);
    expect(evaluation.violations.some((entry) => entry.code === 'WRONG_RUN_AUTHORITATIVE_ARTIFACT')).toBe(true);
    expect(evaluation.violations.some((entry) => entry.code === 'INVALID_AUTHORITATIVE_ARTIFACT')).toBe(true);
  });

  test('sem run resolvido o gate é fail-closed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-norun-'));
    tempRoots.push(root);

    const evaluation = evaluateRunTemporalIntegrity({ root });

    expect(evaluation.status).toBe('FAIL');
    expect(evaluation.violations[0].code).toBe('CURRENT_RUN_UNRESOLVED');
  });
});

describe('gate temporal — deferimento de fase (e absoluto na fase devida)', () => {
  // Artefato da cadeia FINAL: o produtor só é devido depois do empacotamento.
  const FINAL_CHAIN = 'governance/final-governance-report.json';

  afterEach(() => {
    delete process.env.ARTIFACT_REFRESH_PHASE;
  });

  test('em CONVERGE, pré-run de cadeia FINAL é PENDING_PHASE — não é violação', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'CONVERGE';
    const root = workspace();
    writeArtifact(root, FINAL_CHAIN, lineage(PRE_RUN));

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    // O que importa: o pipeline NÃO pode ser abortado por evidência que ainda não
    // pode existir — mas ela também não é aceita (não recebe lineage).
    expect(evaluation.status).toBe('PASS');
    expect(evaluation.totals.pendingPhaseArtifacts).toBeGreaterThanOrEqual(1);
    expect(evaluation.violations.find((entry) => entry.path === FINAL_CHAIN)).toBeUndefined();
    expect(evaluation.pendingPhase.find((entry) => entry.path === FINAL_CHAIN)).toBeTruthy();
  });

  test('na fase FINAL, o MESMO artefato pré-run é violação (fail-closed)', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'FINAL';
    const root = workspace();
    writeArtifact(root, FINAL_CHAIN, lineage(PRE_RUN));

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(evaluation.status).toBe('FAIL');
    expect(evaluation.totals.preRunArtifacts).toBeGreaterThanOrEqual(1);
    expect(evaluation.violations.some((entry) => entry.path === FINAL_CHAIN && entry.code === 'PRE_RUN_AUTHORITATIVE_ARTIFACT')).toBe(true);
  });

  test('artefato de produtor sem fase declarada NUNCA é deferido (o par do RAP-078)', () => {
    for (const phase of ['CONVERGE', 'FINAL', 'DELIVERED']) {
      process.env.ARTIFACT_REFRESH_PHASE = phase;
      const root = workspace();
      writeArtifact(root, RAP078, lineage(PRE_RUN));

      const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

      expect(evaluation.status).toBe('FAIL');
      expect(evaluation.violations.some((entry) => entry.path === RAP078)).toBe(true);
    }
  });
});

describe('isolamento de HISTORICAL e TRANSITIONAL', () => {
  test('histórico (dist/archive/**) é ignorado e não vira evidência', () => {
    const root = workspace();
    writeArtifact(root, 'dist/archive/r-agent2-20260901.zip.proof.json', { generatedAt: PRE_RUN, status: 'GREEN' });

    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(authority.classifyArtifact('dist/archive/r-agent2-20260901.zip.proof.json')).toBe(authority.MODES.HISTORICAL_REPORT);
    expect(evaluation.totals.historicalIgnored).toBeGreaterThanOrEqual(1);
    expect(evaluation.violations.some((entry) => entry.path.startsWith('dist/archive/'))).toBe(false);
  });

  test('snapshot transicional é reconhecido e excluído da decisão', () => {
    const snapshot = 'governance/final-snapshot-coherence-report.json';
    expect(authority.classifyArtifact(snapshot)).toBe(authority.MODES.TRANSITIONAL_REPORT);
    expect(authority.isAuthoritativeArtifact(snapshot)).toBe(false);

    const root = workspace();
    writeArtifact(root, snapshot, { generatedAt: PRE_RUN, status: 'NO_GO' });
    const evaluation = evaluateRunTemporalIntegrity({ root, run: RUN });

    expect(evaluation.totals.transitionalIgnored).toBeGreaterThanOrEqual(1);
    // Snapshot transicional NUNCA domina a decisão final.
    expect(evaluation.violations.some((entry) => entry.path === snapshot)).toBe(false);
  });

  test('scorecard consumindo artefato histórico é violação explícita', () => {
    const root = workspace();
    writeArtifact(root, 'dist/archive/antigo.json', { generatedAt: PRE_RUN, status: 'PASS' });

    const evaluation = evaluateRunTemporalIntegrity({
      root,
      run: RUN,
      declaredPaths: ['dist/archive/antigo.json'],
    });

    expect(evaluation.violations.some((entry) => entry.code === 'SCORECARD_CONSUMES_NON_AUTHORITATIVE_ARTIFACT')).toBe(true);
  });
});

describe('Master Scorecard — a mesma regra temporal (nada de freshness permissiva)', () => {
  const spec = {
    type: 'current_artifact',
    path: RAP078,
    statusPaths: ['status', 'decision'],
    acceptedValues: ['PASS'],
    requireLineage: true,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  };

  function contextFor(root) {
    return {
      rootDir: root,
      sourceFingerprint: RUN.source_fingerprint,
      runContext: { runId: RUN.run_id, sourceFingerprint: RUN.source_fingerprint, startedAt: RUN.started_at, status: 'RUNNING' },
      nowMs: Date.parse(IN_RUN) + 3_600_000,
    };
  }

  test('evidência pré-run NÃO sustenta a dimensão (não pode 10/10)', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage(PRE_RUN));

    const outcome = evaluateEvidence(spec, contextFor(root));

    expect(outcome.status).toBe('STALE');
    expect(JSON.stringify(outcome)).toMatch(/STALE_ARTIFACT/);
  });

  test('mesma evidência dentro do run sustenta a dimensão (caminho feliz preservado)', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage(IN_RUN));

    const outcome = evaluateEvidence(spec, contextFor(root));

    expect(outcome.status).toBe('PASS');
  });

  test('evidência com timestamp futuro continua reprovada', () => {
    const root = workspace();
    writeArtifact(root, RAP078, lineage('2027-01-01T00:00:00.000Z'));

    const outcome = evaluateEvidence(spec, contextFor(root));

    expect(outcome.status).toBe('INVALID');
    expect(JSON.stringify(outcome)).toMatch(/ARTIFACT_FROM_FUTURE/);
  });
});

describe('autoridade única — taxonomia e produtores', () => {
  test('os cinco modos existem e os autoritativos são distintos dos não autoritativos', () => {
    expect(Object.keys(authority.MODES).sort()).toEqual([
      'CERTIFICATION_ARTIFACT',
      'DERIVED_REPORT',
      'HISTORICAL_REPORT',
      'RUNTIME_EVIDENCE',
      'TRANSITIONAL_REPORT',
    ]);
    expect(authority.AUTHORITATIVE_MODES).not.toContain(authority.MODES.HISTORICAL_REPORT);
    expect(authority.AUTHORITATIVE_MODES).not.toContain(authority.MODES.TRANSITIONAL_REPORT);
  });

  test('RAP-078 está classificado e tem produtor declarado (reexecução possível)', () => {
    expect(authority.classifyArtifact(RAP078)).toBe(authority.MODES.CERTIFICATION_ARTIFACT);
    expect(authority.getProducer(RAP078)).toMatchObject({ command: 'npm run verify:no-mutable-json-state' });
    expect(authority.getProducer('governance/json-persistence-audit.json')).toMatchObject({ command: 'npm run audit:json-persistence' });
  });

  test('a regra declarada é a mesma aplicada em código', () => {
    expect(authority.loadConfig().sameRunRule).toMatch(/generatedAt >= governanceRun\.startedAt/);
  });
});

describe('reexecução do produtor — o que reprova e o que NÃO reprova (converge 8.7/12)', () => {
  const ensure = require('../../../scripts/governance/ensure-authoritative-artifacts-fresh');

  const RUN_START = Date.parse(RUN.started_at);
  const HISTORICAL = 'dist/archive/r-agent2-20261004-094046/r-agent2-20261004-094046.manifest.json';
  const TRANSITIONAL = 'governance/final-snapshot-coherence-report.json';
  const FINAL_PHASE = 'governance/tamper-detection-report.json';

  function entry(relativePath, { generatedAt = null, status = authority.STATUS.STALE_ARTIFACT } = {}) {
    return {
      path: relativePath,
      classification: authority.classifyArtifact(relativePath),
      status,
      generatedAt,
      producer: authority.getProducer(relativePath),
    };
  }

  test('os três produtores que faltavam estão declarados (reexecução possível)', () => {
    // Medido 2026-10-05 (`seal-release --from prepare`): o passo 8.7 abriu com
    // `sem-produtor=3` — system-scope-audit, replay-hardening e model-driven-e2e
    // eram autoritativos e SEM produtor declarado, o que é fail-closed por
    // política. Os comandos abaixo são os produtores REAIS (o converge 6/12 roda
    // os dois primeiros; o terceiro consome o mesh do run, por isso roda no 8.7).
    const declarados = {
      'governance/system-scope-audit.json': 'node scripts/governance/generate-system-scope-audit.js',
      'governance/replay-hardening-report.json': 'node governance/replay-hardening-engine.js',
      'governance/model-driven-e2e-report.json': 'npm run validate:model-driven-e2e',
    };
    for (const [artifactPath, command] of Object.entries(declarados)) {
      const producer = authority.getProducer(artifactPath);
      expect(producer).toBeTruthy();
      expect(producer.command).toBe(command);
      expect(producer.phase).toBe('CONVERGE');
    }
  });

  test('histórico e transicional NUNCA reprovam o passo (não têm produtor por definição)', () => {
    // Falso bloqueio medido: os 6 arquivos de dist/archive/** e o
    // governance/final-snapshot-coherence-report.json entravam em `unresolved`
    // (`nao-resolvidos=7`) e abortavam o converge no passo 8.7 — evidência que a
    // própria taxonomia já havia excluído da decisão.
    const outcome = ensure.summarizeRefresh({
      afterEntries: [entry(HISTORICAL, { status: authority.STATUS.HISTORICAL }), entry(TRANSITIONAL, { status: authority.STATUS.TRANSITIONAL })],
      startedAtMs: RUN_START,
    });
    expect(outcome.unresolved).toEqual([]);
    expect(outcome.status).toBe('PASS');
  });

  test('autoritativo stale SEM produtor declarado continua FAIL-CLOSED', () => {
    const outcome = ensure.summarizeRefresh({
      afterEntries: [{
        path: 'governance/artefato-sem-produtor.json',
        classification: authority.MODES.CERTIFICATION_ARTIFACT,
        status: authority.STATUS.STALE_ARTIFACT,
        generatedAt: PRE_RUN,
        producer: null,
      }],
      startedAtMs: RUN_START,
    });
    expect(outcome.status).toBe('FAIL');
    expect(outcome.unresolved).toHaveLength(1);
  });

  test('artefato REEXECUTADO que continua pré-run reprova (o produtor não produziu o run)', () => {
    const outcome = ensure.summarizeRefresh({
      afterEntries: [entry(RAP078, { generatedAt: PRE_RUN })],
      reexecutedPaths: new Set([RAP078]),
      startedAtMs: RUN_START,
    });
    expect(outcome.status).toBe('FAIL');
    expect(outcome.unresolved.map((e) => e.path)).toEqual([RAP078]);
  });

  test('deferido por fase (cadeia FINAL em CONVERGE) NÃO reprova o passo', () => {
    const outcome = ensure.summarizeRefresh({
      afterEntries: [entry(FINAL_PHASE, { generatedAt: PRE_RUN })],
      startedAtMs: RUN_START,
    });
    expect(outcome.status).toBe('PASS');
  });

  test('artefato autoritativo do próprio run passa', () => {
    const outcome = ensure.summarizeRefresh({
      afterEntries: [entry(RAP078, { generatedAt: IN_RUN, status: authority.STATUS.SAME_RUN })],
      startedAtMs: RUN_START,
    });
    expect(outcome.status).toBe('PASS');
  });
});

describe('tolerância de fase — PENDING_PHASE vs falha REAL (autoridade única da taxonomia)', () => {
  const deferral = require('../../../scripts/governance/scorecard-phase-deferral');

  // Artefato da cadeia FINAL (producer.phase = FINAL) e o caso CENTRAL da missão
  // (RAP-078, produtor sem fase declarada = sempre devido).
  const FINAL_CHAIN = 'governance/final-governance-report.json';
  const ALWAYS_DUE = 'governance/mutable-json-state-validation-report.json';

  function staledRequirement(artifactPath) {
    return {
      id: 'REQ-1',
      category: 'GOVERNED',
      mandatory: true,
      status: 'STALE',
      code: 'ARTIFACT_DID_NOT_PASS',
      reason: 'Artifact gerado ANTES do início do run',
      validator: [artifactPath],
      evidence: [{ path: artifactPath, status: 'STALE', code: 'STALE_ARTIFACT', reason: 'gerado ANTES do início do run' }],
    };
  }

  function below10Dimension(artifactPath) {
    return { id: 'RAP-TESTE-01', score: 8, requirements: [staledRequirement(artifactPath)] };
  }

  afterEach(() => {
    delete process.env.ARTIFACT_REFRESH_PHASE;
  });

  test('antes da fase do produtor, a dimensão é DEFERRED (não falha real)', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'CONVERGE';
    const out = deferral.classifyBelow10Dimensions([below10Dimension(FINAL_CHAIN)], {});
    expect(out.status).toBe('DEFERRED');
    expect(out.realFailures).toEqual([]);
    expect(out.classified[0].kind).toBe('PENDING_PHASE');
  });

  test('na fase do produtor, o MESMO artefato pré-run vira falha REAL (fail-closed)', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'FINAL';
    const out = deferral.classifyBelow10Dimensions([below10Dimension(FINAL_CHAIN)], {});
    expect(out.status).toBe('FAIL');
    expect(out.realFailures.map((entry) => entry.id)).toEqual(['RAP-TESTE-01']);
  });

  test('artefato sem fase declarada (sempre devido) NUNCA é tolerado — é o caso do RAP-078', () => {
    for (const phase of ['CONVERGE', 'FINAL', 'DELIVERED']) {
      process.env.ARTIFACT_REFRESH_PHASE = phase;
      const out = deferral.classifyBelow10Dimensions([below10Dimension(ALWAYS_DUE)], {});
      expect(out.status).toBe('FAIL');
      expect(out.realFailures.map((entry) => entry.id)).toEqual(['RAP-TESTE-01']);
    }
  });
});

describe('verificador offline — contrato da seção temporal (não confia só no payload)', () => {
  const VERIFIER = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-enterprise-governance-v2.sh');

  function verifierSource() {
    return fs.readFileSync(VERIFIER, 'utf8');
  }

  test('embute lista canônica MÍNIMA com o par do RAP-078', () => {
    const source = verifierSource();
    // Armadilha medida: usando só a taxonomia DO PAYLOAD, um envelope com taxonomia
    // antiga/truncada escapa (foi o caso do envelope auditado, que trazia a 1.0.0).
    expect(source).toMatch(/const MINIMUM=\[/);
    expect(source).toContain('governance/mutable-json-state-validation-report.json');
    expect(source).toContain('governance/json-persistence-audit.json');
    expect(source).toMatch(/TEMPORAL_LINEAGE_VIOLATION/);
  });

  test('taxonomia ausente no payload não vira passe silencioso', () => {
    expect(verifierSource()).toMatch(/TEMPORAL_TAXONOMY_MISSING/);
  });

  test('usa caminhos declarados pelo scorecard empacotado, sem executar código do payload', () => {
    const source = verifierSource();
    expect(source).toMatch(/master-scorecard-registry\.js/);
    expect(source).toMatch(/scorePaths/);
  });

  test('o start do run vem do próprio runId quando o manifesto não o declara', () => {
    expect(verifierSource()).toMatch(/rap-governed-/);
    expect(verifierSource()).toMatch(/runStartedAt=m\.runStartedAt/);
  });

  // ── DEFEITOS MEDIDOS (2026-10-06) no envelope final ────────────────────────
  // O passo `check-dist-clean` reprovava com o verifier v2 e a seção temporal
  // ficava inutilizável. Duas causas independentes, ambas silenciosas.
  describe('robustez do próprio verificador (defeitos medidos 2026-10-06)', () => {
    test('nenhum crase fora de comentário bash (bash executa o texto como comando)', () => {
      // Regra exata e simples: crase em QUALQUER linha de código é perigosa. Em
      // comentário bash (linha iniciada por #) ela é inerte. Fora disso o bash
      // trata como substituição de comando MESMO entre aspas duplas — foi assim
      // que um comentário JS com crases dentro do bloco node da seção 9 fez o
      // bash executar 'continue' ('significativo apenas em um loop') e mutar o
      // JS antes de o node recebê-lo, matando a checagem temporal.
      const offenders = verifierSource()
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => entry.line.includes('`'))
        .filter((entry) => !entry.line.trimStart().startsWith('#'))
        .map((entry) => `${entry.number}: ${entry.line.trim().slice(0, 90)}`);
      expect(offenders).toEqual([]);
    });

    test('a lista MINIMA é satisfazível: o que o pacote não carrega é provado offline', () => {
      const source = verifierSource();
      const minimumMatch = source.match(/const MINIMUM=\[([\s\S]*?)\];/);
      expect(minimumMatch).not.toBeNull();
      const minimum = [...minimumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(minimum.length).toBeGreaterThan(0);

      // generate-zip.sh exclui '/reports/' da raiz por decisão de projeto (saída
      // gerada) — exigir presença física de reports/* no payload é IMPOSSÍVEL.
      const zipSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'generate-zip.sh'), 'utf8');
      expect(zipSource).toContain("'/reports/'");

      const notShipped = minimum.filter((rel) => rel.startsWith('reports/'));
      expect(notShipped.length).toBeGreaterThan(0);
      // Para cada um deles o verificador tem de exigir cobertura pelo PROOF SET —
      // nunca aceitar em silêncio.
      expect(source).toMatch(/proofCovered/);
      expect(source).toMatch(/TEMPORAL_EVIDENCE_MISSING/);
    });
  });
});

describe('propagação — Readiness e Final Governance dependem do gate temporal', () => {
  const ROOT = path.join(__dirname, '..', '..', '..');

  test('final governance bloqueia sem o relatório temporal (fail-closed nos dois sentidos)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'governance', 'final-governance-engine.js'), 'utf8');

    expect(source).toMatch(/function checkTemporalIntegrity/);
    expect(source).toMatch(/checkTemporalIntegrity\(\),/);
    expect(source).toMatch(/reports\/current-run-temporal-integrity-report\.json/);
    expect(source).toMatch(/preRunArtifacts/);
    // ausência do relatório NÃO é passe
    expect(source).toMatch(/sem prova de integridade temporal/);
  });

  test('platform readiness adiciona gap CRÍTICO e motivo obrigatório', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tools', 'system', 'platform-readiness.js'), 'utf8');

    expect(source).toMatch(/current_run_temporal_integrity/);
    expect(source).toMatch(/temporalHardBlock/);
    expect(source).toMatch(/ensure:authoritative-artifacts-fresh/);
  });

  test('o selo reexecuta a evidência ANTES de empacotar (não empacota pré-run)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');
    const finalPhase = source.slice(source.indexOf('phase_final()'), source.indexOf('phase_publish()'));

    expect(finalPhase).toMatch(/ensure:authoritative-artifacts-fresh/);
    // a reexecução tem de vir antes da INVOCAÇÃO do empacotamento
    expect(finalPhase.indexOf('npm run ensure:authoritative-artifacts-fresh'))
      .toBeLessThan(finalPhase.indexOf('npm run zip:release'));
  });
});
