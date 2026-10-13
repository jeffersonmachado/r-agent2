'use strict';

/**
 * Estados do gate de segurança do release (H8).
 *
 * DEFEITO MEDIDO (2026-10-11): o gate respondia apenas GO/NO_GO. Três situações
 * com ações corretivas DIFERENTES saíam como o mesmo "NO_GO":
 *   - risco real de release (vulnerabilidade crítica aberta, SBOM inválido);
 *   - evidência ausente/vencida/de outro run (precisa REFAZER a medição);
 *   - análise parcial (cobertura abaixo do mínimo, base de advisories vencida).
 *
 * E foi medido também o custo disso na prática: ao subir um run novo depois de um
 * commit, o gate acusou `SECURITY_GATE_STALE_EVIDENCE` — corretamente — e a
 * mensagem precisava dizer "refaça a medição", não "corrija vulnerabilidade".
 *
 * Regras travadas aqui:
 *   1. Estado NUNCA promove para GO: ausência de medição não é aprovação.
 *   2. O mais grave manda (NO_GO > EVIDENCE_UNAVAILABLE > INCOMPLETE > GO).
 *   3. Código de proveniência DESCONHECIDO ⇒ NO_GO (fail-closed).
 *   4. Todo código REALMENTE emitido por `security-gate-provenance.js` está
 *      classificado (a primeira versão usou nomes paralelos inexistentes, e o
 *      código real caía no ramo errado — regressão travada no último teste).
 *   5. Exit code distingue os estados e nenhum deles é 0 além de GO.
 */

const fs = require('fs');
const path = require('path');

const {
  STATE_EXIT_CODES,
  PROVENANCE_EVIDENCE_CODES,
  exitCodeFor,
  composeGateState,
} = require('../../../scripts/governance/lib/security-gate-state');

const {
  DECISIONS,
  STATES,
  resolveState,
  evaluateReleaseSecurity,
} = require('../../../engine/securityIntel/releaseSecurityGate');

const ROOT = path.resolve(__dirname, '..', '..', '..');

describe('composeGateState — estado nunca promove para GO', () => {
  it('tudo limpo ⇒ GO com exit 0', () => {
    const r = composeGateState({ evaluationState: 'GO' });
    expect(r.state).toBe('GO');
    expect(r.exitCode).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('risco real do motor ⇒ NO_GO com exit 1', () => {
    const r = composeGateState({ evaluationState: 'NO_GO', evaluationReasons: ['OPEN_VULNERABILITY'] });
    expect(r.state).toBe('NO_GO');
    expect(r.exitCode).toBe(1);
  });

  it('análise parcial do motor ⇒ INCOMPLETE com exit 2', () => {
    const r = composeGateState({ evaluationState: 'INCOMPLETE', evaluationReasons: ['COVERAGE_BELOW_MINIMUM'] });
    expect(r.state).toBe('INCOMPLETE');
    expect(r.exitCode).toBe(2);
  });

  it('evidência indisponível do motor ⇒ EVIDENCE_UNAVAILABLE com exit 3', () => {
    const r = composeGateState({ evaluationState: 'EVIDENCE_UNAVAILABLE', evaluationReasons: ['SBOM_MISSING'] });
    expect(r.state).toBe('EVIDENCE_UNAVAILABLE');
    expect(r.exitCode).toBe(3);
  });

  it('evidência vencida/de outro run é EVIDENCE_UNAVAILABLE, não risco medido', () => {
    for (const codigo of ['SECURITY_GATE_STALE_EVIDENCE', 'SECURITY_GATE_FOREIGN_RUN', 'SECURITY_GATE_NO_GOVERNED_RUN']) {
      const r = composeGateState({ evaluationState: 'GO', provenanceIssues: [{ code: codigo }] });
      expect(r.state).toBe('EVIDENCE_UNAVAILABLE');
      expect(r.reasons).toContain(codigo);
    }
  });

  it('coleta falhou ⇒ EVIDENCE_UNAVAILABLE (não vira GO nem risco medido)', () => {
    const r = composeGateState({ evaluationState: 'GO', collectError: 'ECONNREFUSED' });
    expect(r.state).toBe('EVIDENCE_UNAVAILABLE');
    expect(r.reasons).toContain('COLLECTION_FAILED');
  });

  it('isenções ilegíveis ⇒ EVIDENCE_UNAVAILABLE (o veredito não considerou o que a UI mostra)', () => {
    const r = composeGateState({ evaluationState: 'GO', waiversError: 'db down' });
    expect(r.state).toBe('EVIDENCE_UNAVAILABLE');
    expect(r.reasons).toContain('WAIVERS_UNAVAILABLE');
  });

  it('o MAIS GRAVE manda: risco + evidência ⇒ NO_GO', () => {
    const r = composeGateState({
      evaluationState: 'NO_GO',
      evaluationReasons: ['OPEN_VULNERABILITY'],
      provenanceIssues: [{ code: 'SECURITY_GATE_STALE_EVIDENCE' }],
      collectError: 'x',
      waiversError: 'y',
    });
    expect(r.state).toBe('NO_GO');
    expect(r.exitCode).toBe(1);
  });

  it('código de proveniência DESCONHECIDO ⇒ NO_GO (fail-closed, não relaxa)', () => {
    const r = composeGateState({ evaluationState: 'GO', provenanceIssues: [{ code: 'CODIGO_NOVO_QUALQUER' }] });
    expect(r.state).toBe('NO_GO');
    expect(r.exitCode).toBe(1);
  });

  it('proveniência sem código ⇒ NO_GO (não relaxa)', () => {
    const r = composeGateState({ evaluationState: 'GO', provenanceIssues: [{ message: 'sem codigo' }] });
    expect(r.state).toBe('NO_GO');
  });

  it('nenhum estado fora de GO tem exit 0', () => {
    for (const estado of ['NO_GO', 'INCOMPLETE', 'EVIDENCE_UNAVAILABLE']) {
      expect(exitCodeFor(estado)).not.toBe(0);
    }
    expect(exitCodeFor('ESTADO_INEXISTENTE')).toBe(1);
    expect(Object.keys(STATE_EXIT_CODES)).toEqual(expect.arrayContaining(['GO', 'NO_GO', 'INCOMPLETE', 'EVIDENCE_UNAVAILABLE']));
  });

  it('todo código REAL de proveniência está classificado como evidência (regressão de nomes paralelos)', () => {
    const fonte = fs.readFileSync(path.join(ROOT, 'scripts/governance/lib/security-gate-provenance.js'), 'utf8');
    const codigos = [...fonte.matchAll(/code:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codigos.length).toBeGreaterThan(0); // se sumirem, o teste vira vácuo
    for (const codigo of codigos) {
      expect(PROVENANCE_EVIDENCE_CODES.has(codigo)).toBe(true);
    }
  });
});

describe('motor puro — resolveState classifica cada bloqueio', () => {
  it('sem bloqueio ⇒ GO', () => {
    expect(resolveState({ decision: DECISIONS.GO, blocking: [] }).state).toBe(STATES.GO);
  });

  it('risco real ⇒ NO_GO', () => {
    for (const codigo of ['OPEN_VULNERABILITY', 'KEV_WITHOUT_FIX', 'SBOM_INVALID', 'VECTOR_INDEX_INVALID']) {
      expect(resolveState({ decision: 'NO_GO', blocking: [{ code: codigo }] }).state).toBe(STATES.NO_GO);
    }
  });

  it('evidência ausente ⇒ EVIDENCE_UNAVAILABLE', () => {
    for (const codigo of ['SECURITY_EVIDENCE_MISSING', 'SBOM_MISSING', 'ADVISORY_BASE_MISSING']) {
      expect(resolveState({ decision: 'NO_GO', blocking: [{ code: codigo }] }).state).toBe(STATES.EVIDENCE_UNAVAILABLE);
    }
  });

  it('análise parcial ⇒ INCOMPLETE', () => {
    for (const codigo of ['COVERAGE_BELOW_MINIMUM', 'ADVISORY_BASE_STALE']) {
      expect(resolveState({ decision: 'NO_GO', blocking: [{ code: codigo }] }).state).toBe(STATES.INCOMPLETE);
    }
  });

  it('código desconhecido ⇒ NO_GO', () => {
    expect(resolveState({ decision: 'NO_GO', blocking: [{ code: 'QUALQUER_COISA' }] }).state).toBe(STATES.NO_GO);
  });
});

describe('motor puro — o estado acompanha a evidência real', () => {
  const politica = { blockOnSeverity: ['CRITICAL', 'HIGH'], requireSbomSnapshot: true, requireValidSbom: true };
  const sbomOk = { available: true, valid: true, sha256: 'a'.repeat(64), componentCount: 10 };
  const baseOk = { available: true, status: 'OK', syncId: 'sync-1', ageHours: 1 };
  const ago = new Date('2026-10-11T12:00:00.000Z');

  function avaliar(extra = {}) {
    return evaluateReleaseSecurity({
      policy: politica,
      findings: { available: true, items: [], source: 'test' },
      sbom: sbomOk,
      advisoryBase: baseOk,
      waivers: [],
      now: ago,
      ...extra,
    });
  }

  it('estado sadio ⇒ GO', () => {
    const r = avaliar();
    expect(r.decision).toBe(DECISIONS.GO);
    expect(r.state).toBe(STATES.GO);
  });

  it('achado HIGH aberto ⇒ NO_GO (risco medido, não evidência)', () => {
    const r = avaliar({
      findings: {
        available: true,
        source: 'test',
        items: [{ findingKey: 'k1', severity: 'HIGH', status: 'OPEN', packageName: 'p', installedVersion: '1.0.0' }],
      },
    });
    expect(r.decision).toBe(DECISIONS.NO_GO);
    expect(r.state).toBe(STATES.NO_GO);
  });

  it('sem dados de achados ⇒ EVIDENCE_UNAVAILABLE (nunca GO por falta de dado)', () => {
    const r = avaliar({ findings: null });
    expect(r.decision).toBe(DECISIONS.NO_GO);
    expect(r.state).toBe(STATES.EVIDENCE_UNAVAILABLE);
  });

  it('SBOM inválido ⇒ NO_GO; SBOM ausente ⇒ EVIDENCE_UNAVAILABLE', () => {
    expect(avaliar({ sbom: { available: true, valid: false, sha256: 'b'.repeat(64) } }).state).toBe(STATES.NO_GO);
    expect(avaliar({ sbom: null }).state).toBe(STATES.EVIDENCE_UNAVAILABLE);
  });

  it('cobertura abaixo do mínimo ⇒ INCOMPLETE (mediu menos, não achou risco)', () => {
    const r = avaliar({ policy: { ...politica, minCoveragePercent: 90 }, coveragePercent: 40 });
    expect(r.decision).toBe(DECISIONS.NO_GO);
    expect(r.state).toBe(STATES.INCOMPLETE);
  });

  it('base de advisories vencida ⇒ INCOMPLETE', () => {
    const r = avaliar({
      advisoryBase: { available: true, status: 'OK', syncId: 's', ageHours: 400, maxAgeHoursBeforeBlocking: 72 },
      policy: { ...politica, blockOnStaleAdvisoryBase: true },
    });
    expect(r.state).toBe(STATES.INCOMPLETE);
  });

  it('o contrato antigo segue intacto: decision é GO/NO_GO e bloqueio nunca vira sucesso', () => {
    for (const extra of [{ findings: null }, { sbom: null }, { coveragePercent: 1 }]) {
      const r = avaliar(extra);
      expect(['GO', 'NO_GO']).toContain(r.decision);
      if (r.state !== 'GO') expect(r.decision).toBe('NO_GO');
    }
  });
});

/**
 * D7. A ÚLTIMA linha do gate tem de ser o VEREDITO, nunca a avaliação de risco.
 *
 * Defeito medido em 2026-10-13: o gate imprimia `evaluation.summary` (que
 * descreve APENAS risco: "GO: 5 verificação(ões) satisfeita(s), 94 aviso(s)")
 * como última linha de uma execução com `state=EVIDENCE_UNAVAILABLE` e **exit
 * 3**. Quem lê o log (operador ou agente) conclui "GO" e o pipeline falha — a
 * pior forma de falso verde, porque a mensagem contradiz o próprio exit code.
 *
 * A prova é feita EXECUTANDO o gate de verdade: qualquer que seja o estado do
 * ambiente, o veredito impresso tem de casar com o exit code.
 */
describe('D7 — veredito impresso casa com o exit code', () => {
  jest.setTimeout(600000);

  const GATE = path.join(ROOT, 'scripts', 'governance', 'validate-security-release-gate.js');

  /** Roda o gate real e devolve { exit, ultimaLinhaVeredito, linhas }. */
  function rodarGate() {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [GATE], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 540000,
      env: { ...process.env },
    });
    const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
    const linhas = saida.split('\n').filter((l) => l.startsWith('[security-release-gate]'));
    const veredito = [...linhas].reverse().find((l) => l.includes('VEREDITO:'));
    return { exit: r.status, linhas, veredito: veredito || null };
  }

  it('o resumo do engine vem ROTULADO como avaliação de risco (não como veredito)', () => {
    const codigo = fs.readFileSync(GATE, 'utf8');
    expect(codigo).toContain('avaliação de risco (engine):');
    const posRisco = codigo.indexOf('avaliação de risco (engine):');
    const posVeredito = codigo.indexOf('VEREDITO:');
    // O veredito é impresso DEPOIS do resumo de risco (é a última palavra).
    expect(posVeredito).toBeGreaterThan(posRisco);
    // E a summary do engine não é mais impressa como linha crua do gate.
    expect(codigo).not.toMatch(/console\.log\(`\[security-release-gate\] \$\{evaluation\.summary\}`\)/);
  });

  it('EXECUÇÃO REAL: a última linha é o veredito e casa com o exit code', () => {
    const { exit, veredito } = rodarGate();
    expect(veredito).not.toBeNull();
    const esperadoPorExit = {
      0: 'GO',
      1: 'NO_GO',
      2: 'INCOMPLETE',
      3: 'EVIDENCE_UNAVAILABLE',
    };
    const esperado = esperadoPorExit[exit];
    expect(esperado).toBeDefined();
    expect(veredito).toContain(`VEREDITO: ${esperado}`);
    expect(veredito).toContain(`exit ${exit}`);
    // O que NUNCA pode acontecer: exit != 0 com a última palavra sendo GO.
    if (exit !== 0) expect(veredito).not.toMatch(/VEREDITO: GO\b/);
  });
});
