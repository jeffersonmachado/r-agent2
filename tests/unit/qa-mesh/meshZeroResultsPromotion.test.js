'use strict';

/**
 * PROMOÇÃO CANÔNICA DA MALHA — CONTRATO DE PROVA DE EXECUÇÃO
 * (missão V3 §2; defeito HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA).
 *
 * HISTÓRICO MEDIDO
 * ----------------
 * 1ª correção (2026-10-17, manhã): `results.length === 0` não promove. Insuficiente:
 * um array NÃO VAZIO continuava aceito como prova — 144 objetos `SKIPPED`, um
 * objeto fabricado à mão ou um resultado importado de outro run promoviam
 * `go-no-go-report.json`, `release-gate.json` e o pacote de inteligência.
 *
 * CONTRATO ATUAL (todos obrigatórios)
 *   - identidade de execução completa (executionId + runId + sourceFingerprint +
 *     sourceCommit de 40 hex), vinda dos produtores canônicos;
 *   - ≥ 1 resultado;
 *   - cada resultado: id, status de outcome real, janela startedAt/finishedAt,
 *     evidência de execução, não sintético/importado/reaproveitado, e identidade
 *     de run igual à da execução quando declarada;
 *   - resultado iniciado antes do run é evidência reaproveitada.
 */

const fs = require('fs');
const path = require('path');

const {
  avaliarPromocaoCanonica,
  validarResultadoExecutado,
  identidadeDeExecucaoValida,
  STATUS_NAO_EXECUTADOS,
} = require('../../../qa-mesh/meshRunner');

const IDENTIDADE = {
  executionId: 'mesh-2026-10-17T10-00-00',
  startedAt: '2026-10-17T10:00:00.000Z',
  runId: 'rap-governed-20261017100000000-abc12345',
  sourceFingerprint: 'f'.repeat(64),
  sourceCommit: 'a'.repeat(40),
};

const resultado = (extra = {}) => ({
  id: 'cenario-1',
  status: 'PASS',
  startedAt: '2026-10-17T10:00:05.000Z',
  finishedAt: '2026-10-17T10:00:09.000Z',
  logs: ['executou'],
  artifacts: [{ type: 'screenshot', path: '/tmp/x.png' }],
  ...extra,
});

const avaliar = (results, identidade = IDENTIDADE) => avaliarPromocaoCanonica({ habilitado: true, results, identidade });

describe('§2.1 — zero cenários não promove', () => {
  it('lista vazia ⇒ MESH_SEM_RESULTADOS', () => {
    const d = avaliar([]);
    expect(d.permitido).toBe(false);
    expect(d.motivos.map((m) => m.code)).toContain('MESH_SEM_RESULTADOS');
  });

  it('results ausente/malformado ⇒ não promove (fail-closed)', () => {
    expect(avaliar(null).permitido).toBe(false);
    expect(avaliar(undefined).permitido).toBe(false);
    expect(avaliar('nao-e-array').permitido).toBe(false);
  });
});

describe('§2.2 — resultado fabricado ou sem identidade não promove', () => {
  it('objeto fora do contrato (sem janela de execução e sem evidência)', () => {
    const d = avaliar([{ id: 'inventado', status: 'PASS' }]);
    expect(d.permitido).toBe(false);
    const codes = d.motivos.map((m) => m.code);
    expect(codes).toContain('MESH_RESULTADO_SEM_IDENTIDADE');
    expect(codes).toContain('MESH_RESULTADO_SEM_EVIDENCIA');
  });

  it('resultado não-objeto ⇒ MESH_RESULTADO_MALFORMADO', () => {
    expect(validarResultadoExecutado(null, IDENTIDADE).map((m) => m.code)).toContain('MESH_RESULTADO_MALFORMADO');
    expect(avaliar(['x']).permitido).toBe(false);
  });

  it('startedAt posterior a finishedAt ⇒ malformado', () => {
    const d = avaliar([resultado({ startedAt: '2026-10-17T10:00:30.000Z', finishedAt: '2026-10-17T10:00:10.000Z' })]);
    expect(d.permitido).toBe(false);
    expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_MALFORMADO');
  });

  it('sintético / importado / reaproveitado ⇒ não promove', () => {
    for (const marca of [{ synthetic: true }, { imported: true }, { reused: true }, { importedFrom: 'run-x' }, { reusedFrom: 'run-x' }]) {
      const d = avaliar([resultado(marca)]);
      expect(d.permitido).toBe(false);
      expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_REAPROVEITADO');
    }
  });

  it('identidade de execução incompleta ⇒ MESH_SEM_IDENTIDADE_DE_EXECUCAO', () => {
    for (const campo of ['executionId', 'runId', 'sourceFingerprint', 'sourceCommit']) {
      const d = avaliar([resultado()], { ...IDENTIDADE, [campo]: undefined });
      expect(d.permitido).toBe(false);
      expect(d.motivos.map((m) => m.code)).toContain('MESH_SEM_IDENTIDADE_DE_EXECUCAO');
    }
    expect(identidadeDeExecucaoValida({ ...IDENTIDADE, sourceCommit: 'abc' }).faltantes).toContain('sourceCommit_formato');
  });
});

describe('§2.3 — resultado de outro run / anterior ao run não promove', () => {
  it('runId do resultado difere do run da execução', () => {
    const d = avaliar([resultado({ runId: 'rap-governed-de-outro-ciclo-9999' })]);
    expect(d.permitido).toBe(false);
    expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_RUN_ESTRANGEIRO');
  });

  it('sourceCommit do resultado difere do código avaliado', () => {
    const d = avaliar([resultado({ sourceCommit: 'b'.repeat(40) })]);
    expect(d.permitido).toBe(false);
    expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_RUN_ESTRANGEIRO');
  });

  it('resultado iniciado ANTES do run ⇒ evidência reaproveitada', () => {
    const d = avaliar([resultado({ startedAt: '2026-10-16T09:00:00.000Z', finishedAt: '2026-10-16T09:05:00.000Z' })]);
    expect(d.permitido).toBe(false);
    expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_ANTERIOR_AO_RUN');
  });
});

describe('§2.4 — SKIPPED/NOT_EXECUTED/UNKNOWN não promovem', () => {
  for (const status of ['SKIPPED', 'NOT_EXECUTED', 'UNKNOWN', 'PENDING', 'BLOCKED', 'skipped']) {
    it(`status ${status} não prova execução`, () => {
      const d = avaliar([resultado({ status })]);
      expect(d.permitido).toBe(false);
      expect(d.motivos.map((m) => m.code)).toContain('MESH_RESULTADO_STATUS_NAO_EXECUTADO');
    });
  }

  it('lista mista com um SKIPPED já derruba a promoção', () => {
    const d = avaliar([resultado(), resultado({ id: 'cenario-2', status: 'SKIPPED' })]);
    expect(d.permitido).toBe(false);
    expect(d.resultadosExecutados).toBe(1);
  });

  it('o conjunto de status não-executados é explícito (nunca heurística)', () => {
    expect(STATUS_NAO_EXECUTADOS.has('SKIPPED')).toBe(true);
    expect(STATUS_NAO_EXECUTADOS.has('PASS')).toBe(false);
    expect(STATUS_NAO_EXECUTADOS.has('FAIL')).toBe(false);
  });
});

describe('§2.5 — execução válida promove (controle positivo)', () => {
  it('resultado completo e identidade coerente ⇒ permitido', () => {
    const d = avaliar([resultado(), resultado({ id: 'cenario-2', status: 'FAIL' })]);
    expect(d.permitido).toBe(true);
    expect(d.motivos).toEqual([]);
    expect(d.totalResultados).toBe(2);
    expect(d.resultadosExecutados).toBe(2);
  });

  it('promoção desabilitada pelo pipeline continua desabilitada, sem motivo de defeito', () => {
    const d = avaliarPromocaoCanonica({ habilitado: false, results: [resultado()], identidade: IDENTIDADE });
    expect(d.permitido).toBe(false);
    expect(d.motivos).toEqual([]);
  });
});

describe('§2.6/§2.7 — o caminho REAL de escrita é gated pela decisão', () => {
  const FONTE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'qa-mesh', 'meshRunner.js'), 'utf8');

  it('a decisão precede a escrita dos artefatos governados', () => {
    const iDecisao = FONTE.indexOf('avaliarPromocaoCanonica({');
    const iGoNoGo = FONTE.indexOf('writeJson(QA_MESH_GO_NO_GO_PATH');
    const iReleaseGate = FONTE.indexOf('writeJson(QA_MESH_RELEASE_GATE_PATH');
    expect(iDecisao).toBeGreaterThan(-1);
    expect(iDecisao).toBeLessThan(iGoNoGo);
    expect(iDecisao).toBeLessThan(iReleaseGate);
  });

  it('o escritor canônico é a própria decisão (writeCanonicalOutputs rebaixado na recusa)', () => {
    expect(FONTE).toMatch(/writeCanonicalOutputs = false/);
    expect(FONTE).toMatch(/if \(!decisao\.permitido && writeCanonicalOutputs\)/);
    for (const marcador of ['writeJson(QA_MESH_GO_NO_GO_PATH', 'writeJson(QA_MESH_RELEASE_GATE_PATH', 'writeJson(REPORT_PATH']) {
      expect(FONTE.indexOf(marcador)).toBeGreaterThan(-1);
    }
  });

  it('a recusa deixa evidência diagnóstica sem simular aprovação', () => {
    expect(FONTE.indexOf("appendLog('CANONICAL_PROMOTION_REFUSED'")).toBeGreaterThan(-1);
    expect(FONTE).toMatch(/summary\.canonicalPromotion = \{ promoted: false/);
    expect(FONTE).toMatch(/motivos: decisao\.motivos\.slice\(0, 40\)/);
    expect(FONTE).toMatch(/summary\.reasons = \[\.\.\.new Set/);
  });
});
