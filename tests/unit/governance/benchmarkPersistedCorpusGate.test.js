'use strict';

/**
 * Casos adversariais do gate BENCHMARK_PERSISTED_CORPUS_CURRENT.
 *
 * Duas camadas com pesos diferentes, e é isso que estes testes travam:
 *   - INTEGRIDADE é defeito SEMPRE (referência quebrada é corrupção);
 *   - POLÍTICA só vale para vertical CERTIFICADA (candidato não resolvido sem
 *     identidade normalizada é ESTADO do pipeline, não defeito).
 *
 * Se a segunda camada vazasse para o corpus inteiro, o gate ficaria vermelho
 * por desenho do pipeline — e um gate que sempre falha deixa de ser lido.
 * Se a primeira camada fosse ignorada, corrupção de dados passaria como PASS.
 */

const {
  CODES,
  INTEGRITY_CODES,
  CERTIFICATION_CLAIM,
  evaluatePersistedFinding,
  loadCertifiedSamples,
  resolveSupportingRunId,
  buildReport,
} = require('../../../scripts/governance/validate-benchmark-persisted-corpus');
const {
  getSemanticPipelineVersion,
} = require('../../../api/services/benchmark/semantic/semanticPipelineVersion');

const CURRENT = getSemanticPipelineVersion().version;

const EVIDENCE_ID = 'ev-1';
const RUN_ID = 'run-1';

function context(overrides = {}) {
  return {
    evidenceIds: new Set([EVIDENCE_ID]),
    runIds: new Set([RUN_ID]),
    certified: false,
    currentVersion: CURRENT,
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    id: 'f-1',
    run_id: RUN_ID,
    benchmark_id: 'benchmark-x',
    evidence_id: EVIDENCE_ID,
    verification_state: 'VERIFIED_OFFICIAL',
    metadata: {
      normalizedId: 'membership.sell',
      contentHash: 'a'.repeat(64),
      semanticPipelineVersion: CURRENT,
    },
    ...overrides,
  };
}

describe('integridade — defeito em qualquer cenário (mesmo sem certificação)', () => {
  it('detecta evidência órfã', () => {
    const result = evaluatePersistedFinding(finding({ evidence_id: 'ev-inexistente' }), context());
    expect(result.integrity).toEqual([CODES.ORPHAN_EVIDENCE]);
    expect(INTEGRITY_CODES).toContain(CODES.ORPHAN_EVIDENCE);
  });

  it('detecta run órfão', () => {
    const result = evaluatePersistedFinding(finding({ run_id: 'run-inexistente' }), context());
    expect(result.integrity).toContain(CODES.ORPHAN_RUN);
  });

  it('detecta run_id ausente', () => {
    const result = evaluatePersistedFinding(finding({ run_id: null }), context());
    expect(result.integrity).toContain(CODES.ORPHAN_RUN);
  });

  it('detecta contentHash malformado (mas aceita sha256:<64hex> e <64hex>)', () => {
    const bad = evaluatePersistedFinding(finding({ metadata: { contentHash: 'nao-e-hash' } }), context());
    expect(bad.integrity).toEqual([CODES.INVALID_CONTENT_HASH]);

    for (const hash of ['a'.repeat(64), `sha256:${'b'.repeat(64)}`]) {
      const ok = evaluatePersistedFinding(finding({ metadata: { contentHash: hash } }), context());
      expect(ok.integrity).toEqual([]);
    }
  });

  it('contentHash AUSENTE não é violação de integridade (não há o que validar)', () => {
    const result = evaluatePersistedFinding(finding({ metadata: {} }), context());
    expect(result.integrity).toEqual([]);
  });

  it('integridade falha mesmo quando a vertical NÃO é certificada', () => {
    const result = evaluatePersistedFinding(
      finding({ evidence_id: 'ev-inexistente', run_id: 'run-inexistente' }),
      context({ certified: false }),
    );
    expect(result.integrity).toHaveLength(2);
    expect(result.policy).toEqual([]);
  });
});

describe('política — só para vertical certificada', () => {
  it('NÃO aplica política a vertical não certificada (estado, não defeito)', () => {
    const unverified = finding({
      evidence_id: null,
      verification_state: 'UNVERIFIED',
      metadata: { normalizedId: null },
    });
    const result = evaluatePersistedFinding(unverified, context({ certified: false }));
    expect(result.policy).toEqual([]);
    expect(result.codes).toEqual([]);
  });

  it.each([
    ['versão semântica desatualizada', { metadata: { normalizedId: 'x', contentHash: 'a'.repeat(64) } }, CODES.STALE_SEMANTICS],
    ['sem evidência', { evidence_id: null }, CODES.MISSING_EVIDENCE],
    ['estado não validado', { verification_state: 'UNVERIFIED' }, CODES.NOT_VALIDATED],
    ['sem normalizedId', { metadata: { contentHash: 'a'.repeat(64), semanticPipelineVersion: CURRENT } }, CODES.MISSING_NORMALIZED_ID],
    ['substituído', { verification_state: 'SUPERSEDED' }, CODES.SUPERSEDED_FINDING],
    ['recusado', { verification_state: 'REJECTED' }, CODES.SUPERSEDED_FINDING],
  ])('REPROVA achado certificado com %s', (_label, overrides, expectedCode) => {
    const result = evaluatePersistedFinding(finding(overrides), context({ certified: true }));
    expect(result.policy).toContain(expectedCode);
  });

  it('APROVA achado certificado completo', () => {
    const result = evaluatePersistedFinding(finding(), context({ certified: true }));
    expect(result.codes).toEqual([]);
  });

  it('marca superseded por metadata.supersededBy, não só por estado', () => {
    const result = evaluatePersistedFinding(
      finding({ metadata: { normalizedId: 'x', contentHash: 'a'.repeat(64), semanticPipelineVersion: CURRENT, supersededBy: 'f-2' } }),
      context({ certified: true }),
    );
    expect(result.policy).toContain(CODES.SUPERSEDED_FINDING);
  });
});

describe('resolveSupportingRunId — ABS-14: o último run que CONTÉM o benchmark', () => {
  const runsAsc = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];

  it('escolhe o run mais recente que contém o benchmark', () => {
    const findingsByRun = new Map([
      ['r1', [{ benchmark_id: 'wellhub' }]],
      ['r2', [{ benchmark_id: 'wellhub' }]],
    ]);
    expect(resolveSupportingRunId('wellhub', runsAsc, findingsByRun)).toBe('r2');
  });

  it('run mais recente SEM o benchmark não vira respaldo (evita falso positivo em massa)', () => {
    // r3 é o run mais novo da vertical, mas não contém 'wellhub'. Usar "run mais
    // recente da vertical" faria o gate auditar findings de outro escopo e
    // acusar histórico como se fosse a afirmação atual.
    const findingsByRun = new Map([
      ['r1', [{ benchmark_id: 'wellhub' }]],
      ['r3', [{ benchmark_id: 'gymdesk' }]],
    ]);
    expect(resolveSupportingRunId('wellhub', runsAsc, findingsByRun)).toBe('r1');
  });

  it('devolve null quando nenhum run contém o benchmark', () => {
    const findingsByRun = new Map([['r3', [{ benchmark_id: 'outro' }]]]);
    expect(resolveSupportingRunId('wellhub', runsAsc, findingsByRun)).toBeNull();
  });
});

describe('buildReport — agregação por vertical', () => {
  const corpus = {
    runs: [{ id: RUN_ID, vertical: 'fitness' }],
    evidenceIds: new Set([EVIDENCE_ID]),
    findings: [
      finding({ id: 'f-ok' }),
      finding({ id: 'f-bad', run_id: 'run-sumiu' }),
    ],
  };

  it('reporta a vertical certificada sem runs como certificação sem corpus', () => {
    const { violations } = buildReport({
      corpus: { runs: [], evidenceIds: new Set(), findings: [] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['wellhub'] }],
      currentVersion: CURRENT,
    });
    expect(violations.map((v) => v.code)).toContain(CODES.CERTIFIED_WITHOUT_RUNS);
  });

  it('reporta benchmark certificado sem NENHUM achado persistido', () => {
    const { violations } = buildReport({
      corpus: { runs: [{ id: RUN_ID, vertical: 'fitness' }], evidenceIds: new Set(), findings: [] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['wellhub'] }],
      currentVersion: CURRENT,
    });
    expect(violations.map((v) => v.code)).toContain(CODES.CERTIFIED_WITHOUT_RUNS);
  });

  it('só os achados do run que RESPALDA entram na política; o resto é histórico', () => {
    const oldRun = { id: 'run-old', vertical: 'fitness' };
    const newRun = { id: 'run-new', vertical: 'fitness' };
    const result = buildReport({
      corpus: {
        runs: [oldRun, newRun],
        evidenceIds: new Set([EVIDENCE_ID]),
        findings: [
          // histórico: sem versão semântica, mas NÃO é a afirmação atual
          finding({ id: 'f-old', run_id: 'run-old', metadata: { normalizedId: 'x', contentHash: 'a'.repeat(64) } }),
          // respaldo real do benchmark: está completo
          finding({ id: 'f-new', run_id: 'run-new' }),
        ],
      },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['benchmark-x'] }],
      currentVersion: CURRENT,
    });

    const fitness = result.perVertical.find((entry) => entry.vertical === 'fitness');
    expect(fitness.findings).toBe(2);
    expect(fitness.supportingFindings).toBe(1);
    expect(result.violations.filter((v) => v.scope === 'policy')).toEqual([]);
    expect(result.supportingDetail).toEqual([
      { vertical: 'fitness', benchmarkId: 'benchmark-x', supportingRunId: 'run-new' },
    ]);
  });

  it('o HOLDOUT não analisado é isento EXPLICITAMENTE (não é lacuna, é o desenho)', () => {
    // O holdout é o instrumento de generalização: deve ficar intocado até a
    // saturação aparente. Sem a isenção, o gate acusaria um estado BY DESIGN
    // como certificação sem corpus — falso positivo real, medido em 2026-09-19
    // (wellable.co em fitness.json).
    const result = buildReport({
      corpus: { runs: [{ id: RUN_ID, vertical: 'fitness' }], evidenceIds: new Set([EVIDENCE_ID]), findings: [] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['wellable.co'], holdoutId: 'wellable.co' }],
      currentVersion: CURRENT,
    });
    expect(result.violations).toEqual([]);
    // Isenção auditável: aparece no relatório, com motivo, em vez de sumir.
    expect(result.supportingDetail).toEqual([
      { vertical: 'fitness', benchmarkId: 'wellable.co', supportingRunId: null, exempt: 'holdout_not_analyzed_before_saturation' },
    ]);
  });

  it('benchmark comum sem achados CONTINUA sendo violação (isenção não é geral)', () => {
    const result = buildReport({
      corpus: { runs: [{ id: RUN_ID, vertical: 'fitness' }], evidenceIds: new Set([EVIDENCE_ID]), findings: [] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['wellhub'], holdoutId: 'wellable.co' }],
      currentVersion: CURRENT,
    });
    expect(result.violations.map((v) => v.code)).toContain(CODES.CERTIFIED_WITHOUT_RUNS);
  });

  it('holdout JÁ analisado entra na política como qualquer benchmark', () => {
    const result = buildReport({
      corpus: { runs: [{ id: RUN_ID, vertical: 'fitness' }], evidenceIds: new Set([EVIDENCE_ID]), findings: [finding({ id: 'f-h', benchmark_id: 'wellable.co' })] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['wellable.co'], holdoutId: 'wellable.co' }],
      currentVersion: CURRENT,
    });
    expect(result.violations).toEqual([]);
    expect(result.supportingDetail[0]).toEqual({
      vertical: 'fitness',
      benchmarkId: 'wellable.co',
      supportingRunId: RUN_ID,
    });
  });

  it('explica o corpus por vertical em vez de só dizer PASS', () => {
    const { perVertical, violations } = buildReport({
      corpus,
      certifiedSamples: [],
      currentVersion: CURRENT,
    });
    const fitness = perVertical.find((entry) => entry.vertical === 'fitness');
    // Só o achado cujo run EXISTE pertence à vertical; o de run inexistente é
    // agrupado em "(sem run)" — não pode contar como corpus da vertical.
    expect(fitness.findings).toBe(1);
    expect(fitness.validated).toBe(1);
    expect(fitness.withoutEvidence).toBe(0);
    expect(perVertical.find((entry) => entry.vertical === '(sem run)').findings).toBe(1);
    // integridade é global: o run inexistente falha mesmo sem certificação
    expect(violations.map((v) => v.code)).toContain(CODES.ORPHAN_RUN);
    expect(violations.every((v) => v.scope === 'integrity')).toBe(true);
  });

  it('achado cujo run não existe aparece como "(sem run)" e nunca é contado como certificado', () => {
    const { perVertical } = buildReport({
      corpus: { runs: [{ id: RUN_ID, vertical: 'fitness' }], evidenceIds: new Set([EVIDENCE_ID]), findings: [finding({ id: 'f-x', run_id: 'run-desconhecido' })] },
      certifiedSamples: [{ vertical: 'fitness', benchmarkIds: ['benchmark-x'] }],
      currentVersion: CURRENT,
    });
    const orphan = perVertical.find((entry) => entry.vertical === '(sem run)');
    expect(orphan).toBeTruthy();
    expect(orphan.certified).toBe(false);
  });
});

describe('loadCertifiedSamples — lê a DECLARAÇÃO real dos samples', () => {
  it('nenhuma vertical declara certificação hoje (estado honesto)', () => {
    // Hoje nenhum sample tem `claim: SAMPLE_SUFFICIENT`. Quando tiver, este
    // teste falha de propósito: é o sinal de que o corpus precisa ser
    // reprocessado antes de a certificação valer.
    expect(loadCertifiedSamples()).toEqual([]);
    expect(CERTIFICATION_CLAIM).toBe('SAMPLE_SUFFICIENT');
  });
});
