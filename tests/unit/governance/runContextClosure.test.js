'use strict';

/**
 * ENCERRAMENTO DE RUN GOVERNADO ÓRFÃO — H20 (missão 2026-10-17).
 *
 * Defeito medido: ciclo interrompido entre `create-governed-run` e a fase que
 * regenera a projeção deixava um run ABERTO para sempre, sem declaração de que o
 * ciclo falhou. O invariante "projeção.runId == run.runId" passava a depender de
 * ONDE o ciclo parou.
 *
 * Correção: run pode ser encerrado (SUPERSEDED|ABANDONED) com motivo e evidência
 * OBRIGATÓRIOS. Fechar não pode esconder divergência — só declarar o estado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { main, ESTADOS_DE_FECHAMENTO } = require('../../../scripts/governance/close-run-context');

let tmpDir;
let contexto;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-run-'));
  contexto = path.join(tmpDir, '.current-run.json');
  fs.writeFileSync(contexto, JSON.stringify({
    runId: 'rap-governed-20261017111858007-5d93eee8',
    sourceCommit: 'a'.repeat(40),
    startedAt: '2026-10-17T11:18:58.257Z',
    status: 'CREATED',
  }, null, 2));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fechamento de run órfão', () => {
  it('exige --reason (fechar sem motivo é apagar prova)', async () => {
    expect(await main(['--context', contexto, '--evidence', 'x'])).toBe(2);
    expect(JSON.parse(fs.readFileSync(contexto, 'utf8')).status).toBe('CREATED');
  });

  it('exige --evidence', async () => {
    expect(await main(['--context', contexto, '--reason', 'interrompido'])).toBe(2);
  });

  it('recusa status fora de SUPERSEDED|ABANDONED', async () => {
    expect(ESTADOS_DE_FECHAMENTO).toEqual(['SUPERSEDED', 'ABANDONED']);
    expect(await main(['--context', contexto, '--reason', 'r', '--evidence', 'e', '--status', 'GREEN'])).toBe(2);
  });

  it('run inexistente não é "fechado às cegas"', async () => {
    const vazio = path.join(tmpDir, 'nao-existe.json');
    expect(await main(['--context', vazio, '--reason', 'r', '--evidence', 'e'])).toBe(1);
  });

  it('--dry-run não grava', async () => {
    expect(await main(['--context', contexto, '--reason', 'r', '--evidence', 'e', '--dry-run'])).toBe(0);
    expect(JSON.parse(fs.readFileSync(contexto, 'utf8')).status).toBe('CREATED');
  });

  it('fecha com motivo, autor, data e evidência preservando o runId', async () => {
    expect(await main(['--context', contexto, '--reason', 'ciclo interrompido', '--evidence', 'reports/x.json', '--by', 'qa'])).toBe(0);
    const r = JSON.parse(fs.readFileSync(contexto, 'utf8'));
    expect(r.status).toBe('ABANDONED');
    expect(r.runId).toBe('rap-governed-20261017111858007-5d93eee8');
    expect(r.closedAt).toBeTruthy();
    expect(r.closedBy).toBe('qa');
    expect(r.closedReason).toBe('ciclo interrompido');
    expect(r.closedEvidence).toBe('reports/x.json');
  });

  it('fechamento no BANCO usa o status declarado e o runId do ponteiro (banco é a autoridade)', async () => {
    // DEFEITO MEDIDO 2026-10-30: só o ponteiro era fechado; a linha em governance_runs permanecia CREATED.
    const update = jest.fn().mockResolvedValue([1]);
    const deps = {
      sequelize: { connect: jest.fn(), getSequelize: () => ({}) },
      getGovernanceRun: () => ({ update }),
    };
    const { fecharNoBanco } = require('../../../scripts/governance/close-run-context');

    const resultado = await fecharNoBanco({ runId: 'rap-governed-x', status: 'SUPERSEDED' }, deps);

    expect(resultado).toEqual({ atualizadas: 1 });
    expect(update).toHaveBeenCalledWith({ status: 'SUPERSEDED' }, { where: { run_id: 'rap-governed-x' } });
  });

  it('falha de banco NÃO é silenciosa: devolve o motivo para o chamador publicar', async () => {
    const deps = {
      sequelize: { connect: jest.fn(), getSequelize: () => ({}) },
      getGovernanceRun: () => ({ update: jest.fn(() => { throw new Error('sem banco'); }) }),
    };
    const { fecharNoBanco } = require('../../../scripts/governance/close-run-context');

    const resultado = await fecharNoBanco({ runId: 'rap-governed-x', status: 'ABANDONED' }, deps);

    expect(resultado.erro).toBe('sem banco');
  });

});
