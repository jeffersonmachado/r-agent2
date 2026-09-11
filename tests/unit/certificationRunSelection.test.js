'use strict';

const {
  pickCertificationRun,
  NON_CERTIFIABLE_RUN_STATUSES,
} = require('../../governance/export-certification-snapshot');

/**
 * Defeito verificado (2026-09-11): `exportCertificationSnapshot` escolhia o run
 * mais recente SEM filtrar status. Um run criado e deixado em FAILED (ex.: um
 * `create-governed-run` sem drift de fonte) passava a fundamentar o snapshot de
 * certificação — sem scorecard e sem decisão — e todos os gates acusavam
 * FOREIGN_RUN_ARTIFACT / MASTER_SCORECARD_NOT_10_OF_10 (invalidArtifacts saltou
 * de 0 para 50).
 *
 * Regra: um run que FALHOU (ou foi INVALIDATED) não pode ser base de
 * certificação; o snapshot deve vir do run certifícável mais recente.
 */
describe('export-certification-snapshot — seleção do run de certificação', () => {
  it('ignora runs FAILED e escolhe o certifícável mais recente', () => {
    const runs = [
      { run_id: 'run-failed', status: 'FAILED' },
      { run_id: 'run-completed', status: 'COMPLETED' },
      { run_id: 'run-older', status: 'COMPLETED' },
    ];
    expect(pickCertificationRun(runs).run_id).toBe('run-completed');
  });

  it('ignora runs INVALIDATED', () => {
    const runs = [
      { run_id: 'run-invalidated', status: 'INVALIDATED' },
      { run_id: 'run-completed', status: 'COMPLETED' },
    ];
    expect(pickCertificationRun(runs).run_id).toBe('run-completed');
  });

  it('aceita runs em andamento (CREATED/RUNNING) — o ciclo ainda vai completá-los', () => {
    const runs = [
      { run_id: 'run-created', status: 'CREATED' },
      { run_id: 'run-completed', status: 'COMPLETED' },
    ];
    expect(pickCertificationRun(runs).run_id).toBe('run-created');
  });

  it('trata status em caixa baixa e status ausente', () => {
    const runs = [
      { run_id: 'run-failed', status: 'failed' },
      { run_id: 'run-unknown' },
      { run_id: 'run-completed', status: 'COMPLETED' },
    ];
    expect(pickCertificationRun(runs).run_id).toBe('run-unknown');
  });

  it('cai no mais recente quando TODOS são não-certifícáveis (nunca inventa run)', () => {
    const runs = [
      { run_id: 'run-failed-new', status: 'FAILED' },
      { run_id: 'run-failed-old', status: 'FAILED' },
    ];
    expect(pickCertificationRun(runs).run_id).toBe('run-failed-new');
  });

  it('devolve null sem runs', () => {
    expect(pickCertificationRun([])).toBeNull();
    expect(pickCertificationRun(undefined)).toBeNull();
  });

  it('declara os status não-certifícáveis esperados', () => {
    expect([...NON_CERTIFIABLE_RUN_STATUSES]).toEqual(['FAILED', 'INVALIDATED']);
  });
});
