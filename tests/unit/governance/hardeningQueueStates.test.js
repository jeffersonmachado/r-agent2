'use strict';

/**
 * MISSAO-B8 — ESTADOS DA FILA OFICIAL (`AI_MEMORY/hardening-queue.json`).
 *
 * Por que esta suíte existe: o hook `continue-until-done` decide se o turno pode
 * encerrar lendo o `status` de cada item. Um estado que o validador não conhece é
 * tratado como ABERTO pelo hook — então um typo (`verifed`) trava a sessão para
 * sempre, e o inverso é pior: um estado "quase fechado" (`fixed_unverified`) que o
 * hook contasse como fechado encerraria a missão sem prova.
 *
 * A suíte exercita `validar()` com FILAS SINTÉTICAS — não o arquivo real. Assim o
 * teste mede a REGRA, e não o estado do dia.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const { validar, ESTADOS, FECHADOS } = require('../../../scripts/governance/validate-hardening-queue');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

/** Commit REAL do repositório: `COMMIT_INEXISTENTE` só pode ser testado com hash verificável. */
const COMMIT_REAL = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim();
/** 40 hex que não existe em objeto nenhum (o defeito do rebase: ponteiro órfão com cara de prova). */
const COMMIT_ORFAO = 'deadbeef'.repeat(5);

const fila = (...itens) => ({ items: itens });
const codigos = (r) => r.violations.map((v) => v.code);

describe('MISSAO-B8 — estados fechados exigem a prova que o nome promete', () => {
  test('verified/done sem commit OU sem evidence são CAMPO_OBRIGATORIO_AUSENTE', () => {
    for (const status of ['verified', 'done']) {
      const semCommit = validar(fila({ id: 'X', status, evidence: 'algo' }));
      expect(codigos(semCommit)).toContain('CAMPO_OBRIGATORIO_AUSENTE');
      const semEvidence = validar(fila({ id: 'X', status, commit: COMMIT_REAL }));
      expect(codigos(semEvidence)).toContain('CAMPO_OBRIGATORIO_AUSENTE');
    }
  });

  test('prevention_active exige `prevention` além de commit e evidence', () => {
    const r = validar(fila({ id: 'X', status: 'prevention_active', commit: COMMIT_REAL, evidence: 'ok' }));
    expect(r.violations).toEqual([
      expect.objectContaining({ code: 'CAMPO_OBRIGATORIO_AUSENTE', item: 'X' }),
    ]);
    expect(r.violations[0].detail).toContain('prevention');
  });

  test('item completo em estado fechado não gera violação (não-vacuidade)', () => {
    const r = validar(fila({
      id: 'X', status: 'verified', commit: COMMIT_REAL, evidence: 'suíte tal',
    }));
    expect(r.violations).toEqual([]);
    expect(r.counts).toEqual({ verified: 1 });
    expect(r.open).toEqual([]);
  });
});

describe('MISSAO-B8 — estados abertos e de impedimento nunca contam como fechados', () => {
  test('pending/in_progress aparecem em `open` (o hook bloqueia a partir daí)', () => {
    const r = validar(fila(
      { id: 'A', status: 'pending' },
      { id: 'B', status: 'in_progress' },
      { id: 'C', status: 'verified', commit: COMMIT_REAL, evidence: 'x' },
    ));
    expect(r.open).toEqual(['A(pending)', 'B(in_progress)']);
    expect(r.counts).toEqual({ pending: 1, in_progress: 1, verified: 1 });
  });

  test('blocked/blocked_external exigem motivo e NÃO entram em FECHADOS', () => {
    for (const status of ['blocked', 'blocked_external']) {
      const semMotivo = validar(fila({ id: 'X', status }));
      expect(codigos(semMotivo)).toContain('CAMPO_OBRIGATORIO_AUSENTE');
      expect(FECHADOS.has(status)).toBe(false);
    }
    const ok = validar(fila({ id: 'X', status: 'blocked_external', blocked_reason: 'chave do CI' }));
    expect(ok.violations).toEqual([]);
    expect(ok.open).toEqual(['X(blocked_external)']);
  });

  test('failed exige failure_reason', () => {
    expect(codigos(validar(fila({ id: 'X', status: 'failed' })))).toContain('CAMPO_OBRIGATORIO_AUSENTE');
    expect(validar(fila({ id: 'X', status: 'failed', failure_reason: 'flaky' })).violations).toEqual([]);
  });
});

describe('MISSAO-B8 — estados que "parecem" fechados e não são', () => {
  test('fixed_unverified COM evidência é violação: com evidência o estado é `verified`', () => {
    const r = validar(fila({
      id: 'X', status: 'fixed_unverified', fix_note: 'corrigido', evidence: 'suíte',
    }));
    expect(codigos(r)).toContain('CAMPO_PROIBIDO_PRESENTE');
    const semEvidencia = validar(fila({ id: 'X', status: 'fixed_unverified', fix_note: 'corrigido' }));
    expect(semEvidencia.violations).toEqual([]);
    // `fixed_unverified` NÃO é fechado: é exatamente o estado que não pode liberar o hook.
    expect(FECHADOS.has('fixed_unverified')).toBe(false);
    expect(semEvidencia.open).toEqual(['X(fixed_unverified)']);
  });

  test('estado desconhecido (typo) é STATUS_DESCONHECIDO e fica ABERTO', () => {
    const r = validar(fila({ id: 'X', status: 'verifed', commit: COMMIT_REAL, evidence: 'x' }));
    expect(codigos(r)).toContain('STATUS_DESCONHECIDO');
    // Sem `spec` não há contagem de estado: um typo não pode inflar "fechados".
    expect(r.counts).toEqual({});
    expect(r.open).toEqual([]);
  });

  test('status em CAIXA ALTA é recusado (o hook compara minúsculo)', () => {
    const r = validar(fila({ id: 'X', status: 'DONE', commit: COMMIT_REAL, evidence: 'x' }));
    expect(codigos(r)).toContain('STATUS_NAO_CANONICO_EM_CAIXA');
  });

  test('os dez estados declarados existem e `FECHADOS` é subconjunto deles', () => {
    expect(Object.keys(ESTADOS).sort()).toEqual([
      'blocked', 'blocked_external', 'done', 'failed', 'fixed_unverified',
      'in_progress', 'pending', 'prevention_active', 'ready_for_approval', 'verified',
    ]);
    for (const estado of FECHADOS) expect(ESTADOS[estado]).toBeDefined();
  });
});

describe('MISSAO-B8 — prova citada tem de ser ABRÍVEL', () => {
  test('commit inexistente no repositório é COMMIT_INEXISTENTE (falso verde com cara de rigor)', () => {
    const r = validar(fila({ id: 'X', status: 'done', commit: COMMIT_ORFAO, evidence: 'suíte' }));
    expect(codigos(r)).toContain('COMMIT_INEXISTENTE');
  });

  test('commit real é aceito (o teste anterior não passa por vacuidade)', () => {
    const r = validar(fila({ id: 'X', status: 'done', commit: COMMIT_REAL, evidence: 'suíte' }));
    expect(codigos(r)).not.toContain('COMMIT_INEXISTENTE');
  });

  test('id duplicado e item sem id são recusados', () => {
    expect(codigos(validar(fila({ id: 'X', status: 'pending' }, { id: 'X', status: 'pending' }))))
      .toContain('ITEM_DUPLICADO');
    expect(codigos(validar(fila({ status: 'pending' })))).toContain('ITEM_SEM_ID');
  });

  test('fila sem array `items` é QUEUE_MALFORMED (nunca PASS por ausência)', () => {
    expect(validar({ fila: [] }).violations[0].code).toBe('QUEUE_MALFORMED');
    expect(validar(null).violations[0].code).toBe('QUEUE_MALFORMED');
  });
});
