'use strict';

/**
 * Testes das funções PURAS do inventário de branches. Sem git, sem IO: a parte que
 * decide a classificação (e portanto o que pode ser podado) é testável isoladamente.
 */

const { familiaDe, classificar, FIXTURE_SANDBOX } = require('../../../tools/audit/branch-inventory');

describe('branch-inventory — funções puras', () => {
  test('familiaDe agrupa pelos dois primeiros segmentos', () => {
    expect(familiaDe('engineering/missions/005b6a6f-191b')).toBe('engineering/missions');
    expect(familiaDe('engineering-router/candidates/x')).toBe('engineering-router/candidates');
    expect(familiaDe('main')).toBe('main');
    expect(familiaDe('hardening/p0-certificacao')).toBe('hardening/p0-certificacao');
  });

  test('classificar: só o fixture sandbox => sandbox_only (descartável)', () => {
    expect(classificar([FIXTURE_SANDBOX, FIXTURE_SANDBOX])).toBe('sandbox_only');
    expect(classificar([FIXTURE_SANDBOX])).toBe('sandbox_only');
  });

  test('classificar: qualquer arquivo fora do fixture => toca_outros (exige revisão)', () => {
    expect(classificar([FIXTURE_SANDBOX, 'api/server.js'])).toBe('toca_outros');
    expect(classificar(['docs/O_QUE_FALTA.md'])).toBe('toca_outros');
  });

  test('classificar: nenhum arquivo => sem_arquivos (branch vazia em relação a main)', () => {
    expect(classificar([])).toBe('sem_arquivos');
  });

  test('o fixture é o artefato do sandbox do Engineering Router — não um arquivo de produto', () => {
    // Trava de significado: se alguém renomear o fixture, este teste avisa que a
    // classificação "descartável" passou a apontar para outra coisa.
    expect(FIXTURE_SANDBOX).toBe('tests/fixtures/engineering-router-sandbox/mathUtils.js');
  });
});
