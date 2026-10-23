'use strict';

/**
 * P1-B — AGREGAÇÃO DE EVIDÊNCIAS INCOMPATÍVEIS (missão Codex 2026-10-23).
 *
 * Defeito: o regularizador gravava resultados por item num diretório COMPARTILHADO
 * (`.../bug-closure-regularization/itens/`) e montava o relatório agregado lendo tudo o que
 * estava lá. Uma execução parcial reutilizava arquivos de execuções anteriores — outro commit,
 * outro fingerprint — e o agregado passava a parecer cobertura integral.
 *
 * Contrato sob teste (`scripts/governance/lib/regularizationRun.js`):
 *   1. toda execução tem `runId` + diretório próprio + `manifest.json` com identidade;
 *   2. todo resultado carrega `runId`, a identidade e `artifactSha256` do próprio conteúdo;
 *   3. `agregar()` recusa execução ausente/incompleta, identidade divergente, id duplicado e
 *      artefato adulterado;
 *   4. execução PARCIAL nunca declara cobertura integral.
 *
 * Os cenários usam filesystem real (diretório temporário), não mocks.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runLib = require('../../../scripts/governance/lib/regularizationRun');

const BASE = path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization');

function raiz() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-'));
}

function identidade(commit = 'a'.repeat(40), fp = 'b'.repeat(64)) {
  return {
    commit,
    sourceFingerprint: fp,
    inventoryFingerprint: 'c'.repeat(64),
    testManifestFingerprint: 'd'.repeat(64),
  };
}

function abrirRun(root, { commit, fp, escopo } = {}) {
  return runLib.iniciar({
    rootDir: root,
    baseRel: BASE,
    commit: commit || identidade().commit,
    sourceFingerprint: fp || identidade().sourceFingerprint,
    inventoryFingerprint: 'c'.repeat(64),
    testManifestFingerprint: 'd'.repeat(64),
    escopo: escopo || { tipo: 'PARCIAL', esperadoNoEscopo: 2 },
  });
}

const resultado = (id, classe = 'AGUARDA_ASSINATURA_E_ANCORA') => ({
  id,
  severity: 'P1',
  classe,
  teste: `tests/unit/${id}.test.js`,
  log: `${BASE}/${id}.log`,
});

function fechar(root, run, ids, status = runLib.STATUS.COMPLETED) {
  for (const id of ids) {
    const r = runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: run.runId, resultado: resultado(id) });
    expect(r.ok).toBe(true);
  }
  return runLib.finalizar({ rootDir: root, baseRel: BASE, runId: run.runId, status, processados: ids.length });
}

describe('P1-B — identidade de execução', () => {
  test('cada execução tem runId próprio, diretório próprio e manifesto com identidade', () => {
    const root = raiz();
    const a = abrirRun(root);
    const b = abrirRun(root);
    expect(a.runId).not.toBe(b.runId);
    expect(a.dir).not.toBe(b.dir);
    const m = runLib.lerManifesto(root, BASE, a.runId);
    expect(m.identidade.commit).toBe(identidade().commit);
    expect(m.identidade.sourceFingerprint).toBe(identidade().sourceFingerprint);
    expect(m.versaoRegularizador).toBe(runLib.VERSAO_REGULARIZADOR);
    expect(m.status).toBe(runLib.STATUS.RUNNING);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('duas execuções simultâneas não compartilham diretório, manifesto nem log', () => {
    const root = raiz();
    const a = abrirRun(root);
    const b = abrirRun(root);
    fechar(root, a, ['X1']);
    fechar(root, b, ['Y1']);
    const ra = runLib.lerResultados(root, BASE, a.runId);
    const rb = runLib.lerResultados(root, BASE, b.runId);
    expect(ra.resultados.map((r) => r.id)).toEqual(['X1']);
    expect(rb.resultados.map((r) => r.id)).toEqual(['Y1']);
    // Nenhum vazamento de um run para o outro.
    const arquivosA = fs.readdirSync(path.join(a.dir, 'itens'));
    const arquivosB = fs.readdirSync(path.join(b.dir, 'itens'));
    expect(arquivosA).toEqual(['X1.json']);
    expect(arquivosB).toEqual(['Y1.json']);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);
});

describe('P1-B — agregação rejeita evidência incompatível (cenários 1–5)', () => {
  test('Cenário 1 — SHA diferente: agregação RECUSADA', () => {
    const root = raiz();
    const a = abrirRun(root, { commit: '1'.repeat(40) });
    const b = abrirRun(root, { commit: '2'.repeat(40) });
    fechar(root, a, ['A1']);
    fechar(root, b, ['B1']);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId, b.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('IDENTIDADE_INCOMPATIVEL:commit');
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('Cenário 2 — mesmo SHA, fingerprint diferente: RECUSADA (não vira "não certificante" silencioso)', () => {
    const root = raiz();
    const a = abrirRun(root, { fp: 'e'.repeat(64) });
    const b = abrirRun(root, { fp: 'f'.repeat(64) });
    fechar(root, a, ['A2']);
    fechar(root, b, ['B2']);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId, b.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('IDENTIDADE_INCOMPATIVEL:sourceFingerprint');
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('Cenário 3 — evidência ADULTERADA: hash do artefato não confere ⇒ RECUSADA', () => {
    const root = raiz();
    const a = abrirRun(root);
    fechar(root, a, ['A3']);
    const arquivo = path.join(a.dir, 'itens', 'A3.json');
    const corpo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    corpo.classe = 'PRONTA'; // "melhora" o resultado sem refazer o hash
    fs.writeFileSync(arquivo, `${JSON.stringify(corpo, null, 2)}\n`, 'utf8');
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(`ARTEFATO_ADULTERADO:${a.runId}`);
    expect(r.adulterados[0].motivo).toBe('ARTIFACT_HASH_DIVERGENTE');
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('Cenário 4 — execução INTERROMPIDA (RUNNING) ⇒ INCOMPLETA, nunca agregada', () => {
    const root = raiz();
    const a = abrirRun(root);
    runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: a.runId, resultado: resultado('A4') });
    // Sem `finalizar`: é exatamente o estado de um processo morto no meio.
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(`EXECUCAO_INCOMPLETA:${a.runId}:RUNNING`);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('Cenário 5 — duplicidade entre execuções compatíveis: RECUSADA (não "o último vence")', () => {
    const root = raiz();
    const a = abrirRun(root);
    const b = abrirRun(root);
    fechar(root, a, ['DUP']);
    fechar(root, b, ['DUP']);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId, b.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('ID_DUPLICADO_ENTRE_EXECUCOES');
    expect(r.duplicados[0].id).toBe('DUP');
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);
});

describe('P1-B — execução parcial não finge cobertura integral', () => {
  test('run PARCIAL com tudo o que selecionou continua “PARCIAL” e não cobre o inventário', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'PARCIAL', limite: 1, esperadoNoEscopo: 1 } });
    fechar(root, a, ['P1']);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(true);
    expect(r.completo).toBe(false);
    expect(r.escopo[0]).toMatchObject({ tipo: 'PARCIAL', completoNoEscopo: true, processados: 1 });
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('run INTEGRAL que processou menos que o esperado não é COMPLETED', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'INTEGRAL', esperadoNoEscopo: 3 } });
    // Processa 2 de 3 e finaliza: `completo` fica false e `agregar` reporta cobertura parcial.
    for (const id of ['I1', 'I2']) {
      runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: a.runId, resultado: resultado(id) });
    }
    const fim = runLib.finalizar({ rootDir: root, baseRel: BASE, runId: a.runId, status: runLib.STATUS.COMPLETED, processados: 2 });
    expect(fim.manifesto.escopo.completo).toBe(false);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(true);
    expect(r.completo).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('run INTEGRAL completo é o ÚNICO caso com cobertura integral', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'INTEGRAL', esperadoNoEscopo: 2 } });
    fechar(root, a, ['C1', 'C2']);
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(true);
    expect(r.completo).toBe(true);
    expect(r.resultados).toHaveLength(2);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);
});

describe('P1-B — o regularizador usa a execução isolada (contrato de fonte)', () => {
  test('o código não agrega lendo o diretório compartilhado de itens', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'regularize-bug-closures.js'), 'utf8');
    // O diretório compartilhado `itens/` não pode ser fonte de agregação.
    expect(fonte).not.toContain("path.join(EVIDENCIA, 'itens')");
    expect(fonte).toContain('runLib.agregar');
    expect(fonte).toContain('runLib.gravarResultado');
    expect(fonte).toContain('runLib.iniciar');
    // Agregação só existe como operação explícita.
    expect(fonte).toContain('--agregar');
  });
});

// ─── 1ª passada da revisão independente (achados 1 e 2) ─────────────────────

describe('revisão independente — agregação não aceita cobertura declarada', () => {
  test('manifesto forjado com escopo.completo=true e ZERO artefatos ⇒ RECUSADO', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'INTEGRAL', esperadoNoEscopo: 1 } });
    // Forja: marca completo por fora, sem produzir resultado nenhum.
    const manifestoPath = path.join(a.dir, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(manifestoPath, 'utf8'));
    m.status = 'COMPLETED';
    m.resultados = 1;
    m.escopo.completo = true;
    fs.writeFileSync(manifestoPath, `${JSON.stringify(m, null, 2)}\n`, 'utf8');

    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(`EXECUCAO_SEM_RESULTADOS:${a.runId}`);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('completo é RECALCULADO dos artefatos: manifesto mentindo `completo` não basta', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'INTEGRAL', esperadoNoEscopo: 3 } });
    fechar(root, a, ['M1']); // 1 de 3
    const manifestoPath = path.join(a.dir, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(manifestoPath, 'utf8'));
    m.escopo.completo = true; // mentira
    m.resultados = 1;
    fs.writeFileSync(manifestoPath, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
    const r = runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [a.runId] });
    expect(r.ok).toBe(true);
    expect(r.completo).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);

  test('finalizar conta os artefatos em vez de confiar no chamador', () => {
    const root = raiz();
    const a = abrirRun(root, { escopo: { tipo: 'INTEGRAL', esperadoNoEscopo: 2 } });
    for (const id of ['N1', 'N2']) {
      runLib.gravarResultado({ rootDir: root, baseRel: BASE, runId: a.runId, resultado: resultado(id) });
    }
    const fim = runLib.finalizar({ rootDir: root, baseRel: BASE, runId: a.runId, status: runLib.STATUS.COMPLETED });
    expect(fim.manifesto.resultados).toBe(2);
    expect(fim.manifesto.escopo.completo).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);
});

describe('revisão independente — runId entra em caminho, logo tem contrato', () => {
  test('runId com traversal é recusado ANTES de qualquer I/O', () => {
    const root = raiz();
    const forjado = '../../../../p1b-evil';
    for (const acao of [
      () => runLib.lerManifesto(root, BASE, forjado),
      () => runLib.lerResultados(root, BASE, forjado),
      () => runLib.agregar({ rootDir: root, baseRel: BASE, runIds: [forjado] }),
      () => runLib.dirDaExecucao(root, BASE, forjado),
    ]) {
      let recusou = false;
      try {
        const r = acao();
        recusou = r === null || r.ok === false;
      } catch (e) {
        recusou = /RUN_ID_FORA_(DO_CONTRATO|DA_RAIZ)/.test(e.message);
      }
      expect(recusou).toBe(true);
    }
    expect(runLib.validarRunId(forjado).ok).toBe(false);
    expect(runLib.validarRunId('run-20261023120000-abcdef12').ok).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  }, 60000);
});
