'use strict';

/**
 * tests/unit/governance/certificationCoherence.test.js
 *
 * PROVA que dois artefatos finais contraditórios do MESMO run não podem ser entregues juntos como se
 * ambos fossem autoridade.
 *
 * DEFEITO REAL (2026-10-02): o envelope continha, para o runId `rap-governed-20261002021741216-6a8080a5`:
 *   governance/certification-snapshot.json       → NO_GO / runStatus=FAILED
 *   docs/governance/_platform-status-source.json → AUTONOMOUS_READY_GO
 * Ambos aparentam ser canônicos; um auditor não tem como saber qual vale. Não é proibido ter estado
 * intermediário — é proibido ter intermediário SEM DIZER QUE É.
 */

const {
  normalizeDecision,
  isNonCurrent,
  assessFinalCoherence,
  assessRunStatusSemantics,
  buildSupersessionMarker,
  NON_CURRENT_MARKERS,
} = require('../../../scripts/governance/lib/certificationCoherence');

const RUN = 'rap-governed-20261002021741216-6a8080a5';

describe('certificationCoherence — artefatos finais não podem se contradizer', () => {
  describe('normalização de decisão', () => {
    test('mapeia as formas reais de GO e NO_GO', () => {
      for (const v of ['GO', 'PASS', 'AUTONOMOUS_READY_GO', 'READY', 'GREEN', 'VERIFIED']) {
        expect(normalizeDecision(v)).toBe('GO');
      }
      for (const v of ['NO_GO', 'NOGO', 'FAIL', 'FAILED', 'BLOCKED', 'RED']) {
        expect(normalizeDecision(v)).toBe('NO_GO');
      }
    });

    test('aceita objeto { decision } (formato real do finalDecision)', () => {
      expect(normalizeDecision({ decision: 'NO_GO', reason: 'x' })).toBe('NO_GO');
      expect(normalizeDecision({ status: 'AUTONOMOUS_READY_GO' })).toBe('GO');
    });

    test('valor desconhecido NÃO vira GO nem NO_GO por adivinhação', () => {
      expect(normalizeDecision('TALVEZ')).toBe('UNKNOWN');
      expect(normalizeDecision(null)).toBe('UNKNOWN');
      expect(normalizeDecision('')).toBe('UNKNOWN');
    });
  });

  describe('coerência entre artefatos', () => {
    const go = { path: 'docs/governance/_platform-status-source.json', runId: RUN, decision: 'AUTONOMOUS_READY_GO' };
    const noGo = { path: 'governance/certification-snapshot.json', runId: RUN, decision: { decision: 'NO_GO' } };

    test('O DEFEITO REAL: GO e NO_GO no MESMO run ⇒ incoerente', () => {
      const verdict = assessFinalCoherence({ artifacts: [go, noGo] });
      expect(verdict.coherent).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_FINAL_SNAPSHOT_INCOHERENT');
      expect(verdict.conflicts).toHaveLength(1);
      expect(verdict.conflicts[0].goArtifacts).toContain(go.path);
      expect(verdict.conflicts[0].noGoArtifacts).toContain(noGo.path);
    });

    test('marcar o conflitante como SUPERSEDED resolve — desde que declare por quem', () => {
      const marked = {
        ...noGo,
        lifecycle: 'SUPERSEDED',
        supersededBy: 'docs/governance/_platform-status-source.json',
        reason: 'Projeção bruta do estado do banco; a decisão canônica está no platform-status-source.',
      };
      const verdict = assessFinalCoherence({ artifacts: [go, marked] });
      expect(verdict.coherent).toBe(true);
      expect(verdict.code).toBeNull();
    });

    test('marcar como não-corrente SEM dizer por quem NÃO resolve', () => {
      const marked = { ...noGo, lifecycle: 'TRANSITIONAL' };
      const verdict = assessFinalCoherence({ artifacts: [go, marked] });
      expect(verdict.coherent).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_SUPERSESSION_UNDECLARED');
      expect(verdict.missingMarkers[0].path).toBe(noGo.path);
    });

    test('runs DIFERENTES com decisões diferentes não são contradição', () => {
      const other = { path: 'reports/outro.json', runId: 'rap-governed-20260101000000000-zzz', decision: 'NO_GO' };
      const verdict = assessFinalCoherence({ artifacts: [go, other] });
      expect(verdict.coherent).toBe(true);
    });

    test('dois GO no mesmo run são coerentes', () => {
      const go2 = { path: 'reports/final-governance-report.json', runId: RUN, decision: 'GO' };
      expect(assessFinalCoherence({ artifacts: [go, go2] }).coherent).toBe(true);
    });

    test('decisão UNKNOWN é ignorada (não inventa contradição)', () => {
      const unknown = { path: 'reports/x.json', runId: RUN, decision: 'INDEFINIDO' };
      expect(assessFinalCoherence({ artifacts: [go, unknown] }).coherent).toBe(true);
    });

    test('todos os marcadores não-correntes são reconhecidos', () => {
      for (const marker of NON_CURRENT_MARKERS) {
        expect(isNonCurrent({ lifecycle: marker })).toBe(true);
        expect(isNonCurrent({ lifecycle: marker.toLowerCase() })).toBe(true);
      }
      expect(isNonCurrent({ lifecycle: 'CURRENT' })).toBe(false);
      expect(isNonCurrent({})).toBe(false);
    });
  });

  describe('coerência semântica de status × números', () => {
    test('runStatus=FAILED com 78/78 e 0 blockers SEM explicação ⇒ incoerente', () => {
      const verdict = assessRunStatusSemantics({
        runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 78, scorecardBelow10: 0, openBlockers: 0,
      });
      expect(verdict.coherent).toBe(false);
      expect(verdict.code).toBe('GOVERNANCE_STATUS_NUMBERS_CONTRADICTORY');
    });

    test('a MESMA situação com explicação semântica explícita E não-corrente é aceita', () => {
      const verdict = assessRunStatusSemantics({
        runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 78, scorecardBelow10: 0, openBlockers: 0,
        semanticNote: 'runStatus é o estado do RUN no banco neste instante; a decisão de release é publicada à parte.',
        lifecycle: 'TRANSITIONAL',
      });
      expect(verdict.coherent).toBe(true);
      expect(verdict.declared).toBe(true);
    });

    // Fechamento da brecha medida em 2026-10-05: o PRODUTOR do snapshot injetava a
    // nota automaticamente quando via runStatus=FAILED, então o gate era satisfeito
    // por construção — bastava escrever prosa para um artefato CORRENTE se absolver.
    // Texto não é transição de estado: sem declarar não-corrente, não passa.
    test('nota semântica em artefato CORRENTE NÃO absolve (texto não é transição de estado)', () => {
      for (const lifecycle of [null, 'CURRENT']) {
        const verdict = assessRunStatusSemantics({
          runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 78, scorecardBelow10: 0, openBlockers: 0,
          semanticNote: 'runStatus é o estado do RUN no banco neste instante; a decisão de release é publicada à parte.',
          lifecycle,
        });
        expect(verdict.coherent).toBe(false);
        expect(verdict.code).toBe('GOVERNANCE_STATUS_NOTE_WITHOUT_SUPERSESSION');
      }
    });

    test('a nota só absolve quando o artefato diz por quem foi substituído', () => {
      for (const marker of NON_CURRENT_MARKERS) {
        const verdict = assessRunStatusSemantics({
          runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 78, scorecardBelow10: 0, openBlockers: 0,
          semanticNote: 'runStatus é o estado do RUN no banco neste instante; a decisão de release é publicada à parte.',
          lifecycle: marker,
        });
        expect(verdict.coherent).toBe(true);
        expect(verdict.declared).toBe(true);
      }
    });

    test('explicação curta demais não conta como explicação', () => {
      const verdict = assessRunStatusSemantics({
        runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 78, scorecardBelow10: 0, openBlockers: 0,
        semanticNote: 'ok',
      });
      expect(verdict.coherent).toBe(false);
    });

    test('runStatus=FAILED com números RUINS é coerente (não há contradição)', () => {
      const verdict = assessRunStatusSemantics({
        runStatus: 'FAILED', scorecardTotal: 78, scorecardPassed: 40, scorecardBelow10: 12, openBlockers: 5,
      });
      expect(verdict.coherent).toBe(true);
    });

    test('status favorável nunca é contradição consigo mesmo', () => {
      const verdict = assessRunStatusSemantics({ runStatus: 'COMPLETED', scorecardTotal: 78, scorecardPassed: 78, openBlockers: 0 });
      expect(verdict.coherent).toBe(true);
    });
  });

  describe('marca de supersessão', () => {
    test('exige destino e motivo substancial', () => {
      expect(() => buildSupersessionMarker({ supersededBy: 'x', reason: 'y'.repeat(30) })).toThrow(/`supersededBy`/);
      expect(() => buildSupersessionMarker({ supersededBy: 'docs/x.json', reason: 'curto' })).toThrow(/pelo menos 20 caracteres/);
    });

    test('rejeita lifecycle que na verdade é corrente', () => {
      expect(() => buildSupersessionMarker({ supersededBy: 'docs/x.json', reason: 'y'.repeat(30), lifecycle: 'CURRENT' }))
        .toThrow(/lifecycle inválido/);
    });

    test('monta a marca completa', () => {
      const marker = buildSupersessionMarker({
        supersededBy: 'docs/governance/_platform-status-source.json',
        reason: 'Projeção bruta do banco, não é a decisão canônica da plataforma.',
      });
      expect(marker).toMatchObject({ lifecycle: 'TRANSITIONAL', supersededBy: 'docs/governance/_platform-status-source.json' });
    });
  });
});
