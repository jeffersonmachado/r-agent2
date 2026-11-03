'use strict';

/**
 * Modelo de dados da fila oficial + prova de não-vacuidade dos mecanismos
 * (BUG CLOSURE FIRST, missão 2026-10-17).
 *
 * Aqui ficam travados os dois falsos verdes que a migração eliminou:
 *  1. `blocked`/`blocked_external` contavam como FECHADOS — o relatório da fila
 *     imprimia "abertos: (nenhum)" com 8 itens sem correção;
 *  2. a severidade não existia — 93 itens indistinguíveis, e o motor de
 *     elegibilidade não tinha como saber o que bloqueia certificação.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const { validar, FECHADOS } = require('../../../scripts/governance/validate-hardening-queue');
const { migrarItem, extrairTeste } = require('../../../scripts/governance/migrate-hardening-queue');
const { carregarInventario } = require('../../../governance/bug-closure/defect-registry');
const { derivarSeveridadeDoId, ESTADOS, MIGRACAO_LEGADO } = require('../../../governance/bug-closure/defect-states');
const { provarQueRecusa, verificarGuardas, GUARDAS_EXIGIDAS } = require('../../../scripts/governance/validate-bug-closure-status');

const FILA = path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json');

describe('fila oficial — "bloqueado" NÃO é fechado', () => {
  it('FECHADOS não contém blocked nem blocked_external', () => {
    expect(FECHADOS.has('blocked')).toBe(false);
    expect(FECHADOS.has('blocked_external')).toBe(false);
    expect(FECHADOS.has('done')).toBe(true);
    expect(FECHADOS.has('verified')).toBe(true);
  });

  it('validar() conta um item blocked como ABERTO', () => {
    // CONTRATO ATUALIZADO (2026-10-21): a prova precisa ser ABRÍVEL — hash inexistente agora é
    // `COMMIT_INEXISTENTE`. O fixture usa um commit REAL do repositório (antes era `abc1234`,
    // que só passava porque o validador não olhava o git).
    const commitReal = require('child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' })
      .trim();
    const fila = {
      items: [
        { id: 'P0-X', status: 'blocked', blocked_reason: 'sem acesso ao host' },
        { id: 'P0-Y', status: 'blocked_external', blocked_reason: 'terceiro' },
        { id: 'P1-Z', status: 'verified', commit: commitReal, evidence: 'tests/unit/x.test.js' },
      ],
    };
    const r = validar(fila);
    expect(r.violations).toEqual([]);
    expect(r.open).toEqual(['P0-X(blocked)', 'P0-Y(blocked_external)']);
  });

  it('a fila REAL não declara zero abertos com itens blocked', () => {
    const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
    const r = validar(fila);
    const impedidos = r.open.filter((e) => /\((blocked|blocked_external)\)$/.test(e));
    if (fila.items.some((i) => i.status === 'blocked' || i.status === 'blocked_external')) {
      expect(impedidos.length).toBeGreaterThan(0);
    }
  });
});

describe('migração da fila — canônica, idempotente e sem inventar prova', () => {
  it('done -> FIXED_PENDING_VERIFICATION preservando o status legado', () => {
    const { novo } = migrarItem({ id: 'P1-A', status: 'done', commit: 'abc1234', evidence: 'x' });
    expect(novo.state).toBe(ESTADOS.FIXED_PENDING_VERIFICATION);
    expect(novo.legacyStatus).toBe('done');
    expect(novo.status).toBe('done');
    // Migração NÃO declara verificação: isso exige execução real.
    expect(novo.targetedTestPassing).toBeUndefined();
  });

  it('blocked -> OPEN (impedimento externo não é fechamento)', () => {
    const { novo } = migrarItem({ id: 'P0-A', status: 'blocked', blocked_reason: 'x' });
    expect(novo.state).toBe(ESTADOS.OPEN);
    expect(novo.legacyStatus).toBe('blocked');
  });

  it('é idempotente', () => {
    const original = { id: 'P0-A', status: 'done', commit: 'abc', evidence: 'tests/unit/x.test.js' };
    const { novo: uma } = migrarItem(original);
    const { novo: duas } = migrarItem(uma);
    expect(duas).toEqual(uma);
  });

  it('deriva severidade do prefixo do ID (inclusive ID composto)', () => {
    expect(derivarSeveridadeDoId('P0-1')).toBe('P0');
    expect(derivarSeveridadeDoId('P2-ALGO')).toBe('P2');
    expect(derivarSeveridadeDoId('HARDENING-ENG-GOV-RELEASE-P0-7')).toBe('P0');
    expect(derivarSeveridadeDoId('H19-DIST-CAUSA-UNICA')).toBeNull();
    // Aceita o item inteiro (o bug silencioso de passar o objeto).
    expect(derivarSeveridadeDoId({ id: 'P1-9' })).toBe('P1');
  });

  it('só extrai caminho de teste que EXISTE em disco', () => {
    expect(extrairTeste('tests/unit/governance/bugClosureFirst.test.js (12)')).toBe('tests/unit/governance/bugClosureFirst.test.js');
    expect(extrairTeste('tests/unit/nao/existe/mesmo.test.js')).toBeNull();
    expect(extrairTeste('rag-service 156 passed')).toBeNull();
  });

  it('a fila REAL tem estado canônico em TODOS os itens após a migração', () => {
    const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
    const semEstado = fila.items.filter((i) => !Object.prototype.hasOwnProperty.call(ESTADOS, String(i.state)));
    expect(semEstado.map((i) => i.id)).toEqual([]);
    const semLegado = fila.items.filter((i) => !i.legacyStatus);
    expect(semLegado.map((i) => i.id)).toEqual([]);
    // Todo estado legado presente na fila tem mapeamento canônico documentado.
    for (const i of fila.items) {
      expect(MIGRACAO_LEGADO[String(i.legacyStatus).toLowerCase()]).toBeDefined();
    }
  });
});

describe('prova de não-vacuidade dos mecanismos', () => {
  it('o motor de elegibilidade RECUSA todas as operações certificantes com P0 aberto', () => {
    expect(provarQueRecusa()).toEqual([]);
  });

  it('todos os entrypoints reais consultam a elegibilidade (lista não vazia)', () => {
    expect(GUARDAS_EXIGIDAS.length).toBeGreaterThanOrEqual(9);
    const resultados = verificarGuardas();
    expect(resultados.every((r) => r.ok)).toBe(true);
  });

  it('o inventário real é legível e não vazio (ausência nunca vira "sem defeitos")', () => {
    const inv = carregarInventario();
    expect(inv.defeitos.length).toBeGreaterThan(0);
    expect(inv.resumo.total).toBe(inv.defeitos.length);
  });
});
