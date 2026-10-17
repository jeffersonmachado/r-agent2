'use strict';

/**
 * MALHA COM ZERO RESULTADOS NÃO PROMOVE ARTEFATO GOVERNADO
 * (defeito HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA, 2026-10-17).
 *
 * Medição original: `--scenario-id` que não casava com o registry fazia a malha
 * executar NADA e ainda escrever `qa-mesh/go-no-go-report.json`,
 * `qa-mesh/release-gate.json` e o pacote de inteligência. Esses artefatos são
 * consumidos pelos gates como prova de execução — fail-open latente: só o
 * caminho verde (144 resultados) impedia o dano.
 *
 * Regra nova: promoção canônica exige ≥ 1 resultado executado. A execução segue
 * registrada em `qa/evidence/<id>/` (auditável), mas não toca artefato governado,
 * e o motivo fica declarado em `summary.canonicalPromotion`.
 */

const { podePromoverCanonico } = require('../../../qa-mesh/meshRunner');

describe('promoção canônica da malha exige execução real', () => {
  it('zero resultados ⇒ NÃO promove, com código nomeado', () => {
    const r = podePromoverCanonico(true, []);
    expect(r.permitido).toBe(false);
    expect(r.motivo.code).toBe('MESH_SEM_RESULTADOS');
    expect(r.motivo.detail).toContain('ZERO resultados');
  });

  it('results ausente/malformado ⇒ NÃO promove (fail-closed)', () => {
    expect(podePromoverCanonico(true, null).permitido).toBe(false);
    expect(podePromoverCanonico(true, undefined).permitido).toBe(false);
  });

  it('um resultado executado ⇒ promove (controle positivo)', () => {
    const r = podePromoverCanonico(true, [{ id: 'cenario-1', status: 'PASS' }]);
    expect(r.permitido).toBe(true);
    expect(r.motivo).toBeNull();
  });

  it('promoção desabilitada pelo pipeline segue desabilitada', () => {
    const r = podePromoverCanonico(false, [{ id: 'x' }]);
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBeNull(); // não é recusa por defeito: é escopo não canônico
  });

  it('o escritor do go-no-go só roda sob a decisão de promoção', () => {
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'qa-mesh', 'meshRunner.js'), 'utf8');
    const idxDecisao = fonte.indexOf('podePromoverCanonico(writeCanonicalOutputs, results)');
    const idxEscrita = fonte.indexOf('writeJson(QA_MESH_GO_NO_GO_PATH');
    expect(idxDecisao).toBeGreaterThan(-1);
    expect(idxEscrita).toBeGreaterThan(-1);
    // A decisão vem ANTES da escrita do artefato governado.
    expect(idxDecisao).toBeLessThan(idxEscrita);
    expect(fonte).toContain("appendLog('CANONICAL_PROMOTION_REFUSED'");
  });
});
