'use strict';

/**
 * FIXPOINT DE GOVERNANÇA — REPROJEÇÃO CIRCULAR E SEMÂNTICA DE CORE
 *
 * Defeitos reproduzidos e corrigidos:
 *
 * 1. `run-persisted-scorecard.js` classificava requisitos auto-referentes por
 *    `requirement.code` / `requirement.validator`, mas o requisito PERSISTIDO
 *    carrega o caminho do artefato em `evidence[].path`. O guard nunca casava:
 *    "Artifact reporta NO_GO: governance/final-proof-report.json" era tratado
 *    como falha REAL e 41 blockers circulares derrubavam o run (incluindo
 *    RAP-064). Resultado: NO_GO permanente, impossível de convergir.
 *
 * 2. `governance/export-governance-artifacts.js` derivava CORE readiness de
 *    "todas as 78 dimensões ok". Uma dimensão ADIADA (pacote/DELIVERED) então
 *    rebaixava o estado do núcleo — exatamente a consolidação de estados
 *    independentes que §39/§55 proíbe.
 *
 * 3. A convergência não regerava a projeção de readiness, então
 *    `dev/platform-readiness/latest.json` mantinha runId ESTRANGEIRO e o
 *    contamination cleaner derrubava o run (FOREIGN_RUN_ARTIFACT em campo de
 *    decisão).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const {
  CIRCULAR_PROJECTION_REPORTS,
  isArtifactNoGoRequirement,
  isCircularRequirement,
  isCircularOnlyDimension,
} = require('../../../scripts/governance/circular-projection');
const { buildCertificationStates } = require('../../../governance/certification-states');

// ── §Defeito 1: guard circular ────────────────────────────────────────────

describe('guard circular reconhece o requisito como ele é PERSISTIDO', () => {
  it('a falha circular é reconhecida quando o caminho está em evidence[].path', () => {
    const requirement = {
      id: 'governed',
      category: 'GOVERNED',
      mandatory: true,
      status: 'NO_GO',
      code: 'ALL_EVIDENCE_FAILED',
      reason: 'Artifact reporta NO_GO: governance/final-proof-report.json',
      validator: [],
      evidence: [{ status: 'NO_GO', code: 'MANDATORY_GATE_NO_GO', path: 'governance/final-proof-report.json' }],
    };
    expect(isArtifactNoGoRequirement(requirement)).toBe(true);
    expect(isCircularRequirement(requirement)).toBe(true);
  });

  it('os QUATRO relatórios de projeção são circulares', () => {
    for (const reportPath of CIRCULAR_PROJECTION_REPORTS) {
      const requirement = {
        status: 'NO_GO',
        validator: [reportPath],
        evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: reportPath }],
      };
      expect(isCircularRequirement(requirement)).toBe(true);
    }
  });

  it('NÃO é circular: NO_GO de artefato que não é projeção do scorecard', () => {
    const requirement = {
      status: 'NO_GO',
      code: 'MANDATORY_GATE_NO_GO',
      evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: 'reports/security-validation-report.json' }],
    };
    expect(isArtifactNoGoRequirement(requirement)).toBe(true);
    expect(isCircularRequirement(requirement)).toBe(false);
  });

  it('NÃO é circular: falha real que não é NO_GO de artefato', () => {
    const requirement = {
      status: 'FAIL',
      code: 'OPEN_GAPS_PRESENT',
      reason: '7 gap(s) obrigatório(s) aberto(s).',
      validator: ['governance/final-proof-report.json'],
      evidence: [],
    };
    expect(isArtifactNoGoRequirement(requirement)).toBe(false);
    expect(isCircularRequirement(requirement)).toBe(false);
  });

  it('o guard NÃO transforma falha real em sucesso (dimensão mista continua reprovada)', () => {
    const dimension = {
      id: 'RAP-999',
      requirements: [
        { status: 'NO_GO', evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: 'governance/final-proof-report.json' }] },
        { status: 'FAIL', code: 'OPEN_GAPS_PRESENT', reason: 'gap obrigatório aberto', evidence: [] },
      ],
    };
    expect(isCircularOnlyDimension(dimension)).toBe(false);
  });

  it('dimensão cujas ÚNICAS falhas são circulares é classificada como circular', () => {
    const dimension = {
      id: 'RAP-064',
      requirements: [
        { status: 'PASS', code: 'ALL_EVIDENCE_PASSED' },
        { status: 'NO_GO', evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: 'governance/report-contamination-report.json' }] },
      ],
    };
    // `report-contamination-report.json` NÃO é projeção do scorecard → é falha real.
    expect(isCircularOnlyDimension(dimension)).toBe(false);

    const circularOnly = {
      id: 'RAP-064',
      requirements: [
        { status: 'PASS', code: 'ALL_EVIDENCE_PASSED' },
        { status: 'NO_GO', evidence: [{ code: 'MANDATORY_GATE_NO_GO', path: 'governance/final-governance-report.json' }] },
      ],
    };
    expect(isCircularOnlyDimension(circularOnly)).toBe(true);
  });

  it('dimensão sem falha própria (só gap/blocker derivado) é circular', () => {
    const dimension = {
      id: 'RAP-X',
      requirements: [
        { status: 'PASS' },
        { status: 'FAIL', category: 'NO_KNOWN_GAP' },
        { status: 'FAIL', category: 'NO_OPEN_BLOCKER' },
      ],
    };
    expect(isCircularOnlyDimension(dimension)).toBe(true);
  });
});

// ── §Defeito 2/3: semântica de core e cobertura de implementação ───────────

describe('certification-states: sem medição não se publica 0', () => {
  const REQUIRED = ['beauty', 'fitness', 'food', 'services', 'clinic', 'market', 'bakery'];

  it('sem a lista de verticais os números são null, NUNCA 0/N', () => {
    const states = buildCertificationStates({ rootDir: REPO_ROOT, requiredVerticals: REQUIRED });
    const impl = states.verticalImplementationReadiness;
    expect(impl.numerator).toBeNull();
    expect(impl.percent).toBeNull();
    expect(impl.coveredVerticals).toBeNull();
    // O denominador continua conhecido (é a política, não a medição).
    expect(impl.denominator).toBe(REQUIRED.length);
  });

  it('com a lista de verticais o numerador é contado e o rótulo é o correto', () => {
    const states = buildCertificationStates({
      rootDir: REPO_ROOT,
      requiredVerticals: REQUIRED,
      verticals: REQUIRED.map((vertical) => ({ vertical, implemented: true })),
      verticalCoveragePercent: 100,
    });
    const impl = states.verticalImplementationReadiness;
    expect(impl.numerator).toBe(7);
    expect(impl.denominator).toBe(7);
    expect(impl.percent).toBe(100);
    expect(impl.label).toBe('VERTICAL_IMPLEMENTATION_COVERAGE');
  });

  it('core GO não é rebaixado por pacote pendente, e mercado NÃO herda o core', () => {
    const states = buildCertificationStates({
      rootDir: REPO_ROOT,
      requiredVerticals: REQUIRED,
      verticals: REQUIRED.map((vertical) => ({ vertical, implemented: true })),
      verticalCoveragePercent: 100,
      readinessScore: 100,
      coreReady: true,
    });
    expect(states.corePlatformReadiness.state).toBe('CORE_GO');
    // 100% de implementação NÃO certifica mercado: o estado de mercado só vira
    // CERTIFIED quando TODAS as verticais medirem SAMPLE_SUFFICIENT. 2026-09-17:
    // fitness concluiu o caminho real (17/17 gates + HOLDOUT_PASS, ciclo
    // r1/r23→r25) — a contagem acompanha o relatório, nunca o core GO.
    expect(states.verticalMarketCertification.state).toBe('VERTICAL_MARKET_NOT_CERTIFIED');
    const benchmarkReport = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, 'reports', 'benchmark-sufficiency-report.json'), 'utf8',
    ));
    const reportSufficient = (benchmarkReport.verticals || [])
      .filter((v) => v.status === 'SAMPLE_SUFFICIENT').length;
    expect(states.verticalMarketCertification.certifiedVerticals).toBe(reportSufficient);
    expect(states.verticalMarketCertification.certifiedVerticals)
      .toBeLessThan(states.verticalMarketCertification.requiredVerticals);
    expect(states.liveProviderCertification.state).toBe('PENDING');
  });

  it('CORE_NOT_GO é explícito quando o núcleo não está pronto', () => {
    const states = buildCertificationStates({ rootDir: REPO_ROOT, requiredVerticals: REQUIRED, coreReady: false });
    expect(states.corePlatformReadiness.state).toBe('CORE_NOT_GO');
    expect(states.corePlatformReadiness.doesNotInclude).toEqual(
      expect.arrayContaining(['market research', 'integração live com provedor']),
    );
  });

  it('os cinco estados são sempre publicados juntos, com a invariante explícita', () => {
    const states = buildCertificationStates({ rootDir: REPO_ROOT, requiredVerticals: REQUIRED });
    expect(Object.keys(states)).toEqual(expect.arrayContaining([
      'corePlatformReadiness',
      'verticalImplementationReadiness',
      'verticalMarketCertification',
      'integrationContractCertification',
      'liveProviderCertification',
    ]));
    expect(states._invariant).toMatch(/INDEPENDENTES/);
  });

  it('o estado de contrato EVO vem do contrato versionado, com os quatro estados separados', () => {
    const states = buildCertificationStates({ rootDir: REPO_ROOT, requiredVerticals: REQUIRED });
    const evo = states.integrationContractCertification.providers.evo;
    expect(evo.contractState.LOCAL_CONTRACT_TESTED).toBe(true);
    expect(evo.contractState.LIVE_CERTIFIED).toBe(false);
    expect(evo.liveVerified).toBe(false);
    expect(evo.mustNotClaim).toBe('LIVE VERIFIED');
  });
});

// ── §Defeito 3: sequência de convergência ────────────────────────────────

describe('a sequência de convergência preserva o lineage canônico', () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts/governance/converge-governance.sh'), 'utf8');

  it('regera a projeção de readiness ANTES do fixpoint', () => {
    const readinessIndex = script.indexOf('platform-readiness.js');
    const fixpointIndex = script.indexOf('run-persisted-scorecard.js');
    expect(readinessIndex).toBeGreaterThan(-1);
    expect(fixpointIndex).toBeGreaterThan(-1);
    expect(readinessIndex).toBeLessThan(fixpointIndex);
  });

  it('tolera o exit code de decisão do produtor (não aborta sob set -e)', () => {
    // O exit code do produtor espelha a DECISÃO; a avaliação é do fixpoint.
    expect(script).toMatch(/platform-readiness\.js >\/dev\/null \|\| true/);
  });

  it('o runId da projeção é o do run corrente, sem artefato estrangeiro', () => {
    const currentRunPath = path.join(REPO_ROOT, 'governance', '.current-run.json');
    const projectionPath = path.join(REPO_ROOT, 'dev', 'platform-readiness', 'latest.json');
    if (!fs.existsSync(currentRunPath) || !fs.existsSync(projectionPath)) return;
    const current = JSON.parse(fs.readFileSync(currentRunPath, 'utf8'));
    const projection = JSON.parse(fs.readFileSync(projectionPath, 'utf8'));
    expect(projection.runId).toBe(current.runId);
  });

  it('o relatório de contaminação não aponta lineage estrangeiro', () => {
    const reportPath = path.join(REPO_ROOT, 'governance', 'report-contamination-report.json');
    if (!fs.existsSync(reportPath)) return;
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const foreign = (report.contaminations || []).flatMap((entry) => entry.issues || [])
      .filter((issue) => issue.type === 'FOREIGN_RUN_ARTIFACT' || issue.type === 'FOREIGN_RELEASE_ARTIFACT');
    expect(foreign).toEqual([]);
  });
});
