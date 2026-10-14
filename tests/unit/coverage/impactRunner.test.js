'use strict';

/**
 * Testes do runner L1 (scripts/governance/run-impact-validation.js).
 *
 * Protege os dois defeitos reais medidos em 2026-10-14:
 *  1. FALSO VERMELHO — `jest.config.cjs` não tem `frontend/` nos roots, então
 *     passar um teste Vitest ao Jest reportava "VERMELHO: 1 teste falhou" para
 *     um teste que passa. A seleção precisa ser separada por runner.
 *  2. GAP SEMÂNTICO — alterar um arquivo de teste não o colocava na seleção.
 *
 * Também protege o parsing de argumentos: `--files=valor` era ignorado em
 * silêncio por um erro de slice (+3 em vez de +1) e o runner caía no
 * `git diff` do working tree, executando arquivos que o operador não pediu.
 */

const path = require('path');
const {
  separarPorRunner,
  EXIT,
} = require('../../../scripts/governance/run-impact-validation');
const { selectValidation } = require('../../../qa/coverage/impactSelection');
const { buildImportGraph, collectDependents } = require('../../../qa/coverage/impactGraph');

describe('runner L1 — separação por runner', () => {
  test('testes de frontend vão para o Vitest', () => {
    const r = separarPorRunner([
      'frontend/src/__tests__/a.test.js',
      'frontend/src/context/__tests__/b.test.jsx',
    ]);
    expect(r.vitest).toEqual([
      'frontend/src/__tests__/a.test.js',
      'frontend/src/context/__tests__/b.test.jsx',
    ]);
    expect(r.jest).toEqual([]);
  });

  test('testes de backend/engine vão para o Jest', () => {
    const r = separarPorRunner([
      'tests/unit/x.test.js',
      'engine/__tests__/y.test.js',
      'api/__tests__/z.test.js',
      'tests/integration/w.test.js',
    ]);
    expect(r.jest).toHaveLength(4);
    expect(r.vitest).toEqual([]);
  });

  test('E2E de frontend NÃO é tratado como teste de frontend (é outro pacote)', () => {
    const r = separarPorRunner(['frontend-e2e/login.spec.js']);
    expect(r.vitest).toEqual([]);
    expect(r.jest).toEqual(['frontend-e2e/login.spec.js']);
  });

  test('seleção mista é dividida nos dois grupos', () => {
    const r = separarPorRunner([
      'frontend/src/__tests__/a.test.js',
      'tests/unit/b.test.js',
      'engine/__tests__/c.test.js',
    ]);
    expect(r.vitest).toEqual(['frontend/src/__tests__/a.test.js']);
    expect(r.jest).toEqual(['engine/__tests__/c.test.js', 'tests/unit/b.test.js']);
  });

  test('normaliza separadores e prefixo ./ antes de classificar', () => {
    const r = separarPorRunner(['./frontend/src/__tests__/a.test.js']);
    expect(r.vitest).toEqual(['frontend/src/__tests__/a.test.js']);
  });

  test('lista vazia devolve os dois grupos vazios (sem lançar)', () => {
    expect(separarPorRunner([])).toEqual({ jest: [], vitest: [] });
    expect(separarPorRunner()).toEqual({ jest: [], vitest: [] });
  });

  test('os exit codes são estáveis e distintos (contrato com o orquestrador)', () => {
    expect(EXIT.GREEN).toBe(0);
    expect(EXIT.RED).toBe(1);
    expect(EXIT.ESCALATE).toBe(2);
    expect(EXIT.INFRA).toBe(3);
  });
});

describe('runner L1 — arquivo de teste alterado é executado', () => {
  const ARQUIVOS = [
    { path: 'engine/utils.js', source: '' },
    { path: 'engine/__tests__/utils.test.js', source: "require('../utils');" },
    { path: 'engine/__tests__/outro.test.js', source: '' },
  ];
  const grafo = () => buildImportGraph({ files: ARQUIVOS });

  test('o próprio arquivo de teste alterado entra na seleção', () => {
    const r = selectValidation({
      changedFiles: ['engine/__tests__/outro.test.js'],
      reverse: grafo().reverse,
      collectDependents,
    });
    expect(r.tests).toEqual(['engine/__tests__/outro.test.js']);
    expect(r.escalate).toBe(false);
  });

  test('e NÃO arrasta os testes que dependem do que ele importa', () => {
    const r = selectValidation({
      changedFiles: ['engine/__tests__/utils.test.js'],
      reverse: grafo().reverse,
      collectDependents,
    });
    expect(r.tests).toEqual(['engine/__tests__/utils.test.js']);
  });
});

describe('runner L1 — parsing de argumentos', () => {
  // O parser vive dentro do main; a garantia é comportamental: aceitar as duas
  // formas. Este teste documenta o contrato exercitado pelo orquestrador.
  const { main } = require('../../../scripts/governance/run-impact-validation');

  test('aceita --files=valor sem cair no git diff (forma com igual)', () => {
    const antes = process.argv;
    try {
      // `--dry-run` evita executar suíte; o relatório prova qual base foi usada.
      main(['--files=engine/utils.js', '--dry-run']);
      const rel = require(path.join(process.cwd(), 'reports', 'impact-validation-report.json'));
      expect(rel.base).toBe('EXPLICIT');
      expect(rel.changedFiles).toEqual(['engine/utils.js']);
    } finally {
      process.argv = antes;
    }
  });

  test('aceita --files valor (forma separada)', () => {
    main(['--files', 'engine/utils.js', '--dry-run']);
    const rel = require(path.join(process.cwd(), 'reports', 'impact-validation-report.json'));
    expect(rel.base).toBe('EXPLICIT');
    expect(rel.changedFiles).toEqual(['engine/utils.js']);
  });
});
