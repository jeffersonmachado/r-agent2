'use strict';

/**
 * Persistência do histórico das ações de release.
 *
 * O que este teste protege (o defeito que ele existe para impedir):
 *   - reiniciar a API NÃO pode apagar o que já aconteceu;
 *   - um registro gravado como `running` por uma sessão anterior NÃO pode
 *     continuar "rodando para sempre": se o PID não está vivo, o estado é
 *     `interrupted` com o motivo escrito — status mentiroso é pior que status
 *     ausente.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

let service;
let raiz;

function dirJobs() {
  return path.join(raiz, 'logs', 'dev-governance');
}

function gravarRegistro(registro) {
  fs.mkdirSync(dirJobs(), { recursive: true });
  fs.writeFileSync(path.join(dirJobs(), `${registro.id}.job.json`), JSON.stringify(registro));
}

describe('releaseActionService — persistência do histórico', () => {
  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-devgovernance-'));
    configureRuntimeRoot(raiz);
    // Módulo recarregado por teste para não herdar o Map em memória do anterior.
    jest.resetModules();
    service = require('./releaseActionService');
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  });

  it('lê o registro de uma sessão anterior (histórico não some no reinício)', () => {
    gravarRegistro({
      id: 'job-antigo',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'succeeded',
      exitCode: 0,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: '2026-10-11T10:05:00.000Z',
      logPath: path.join(dirJobs(), 'release-verify-job-antigo.log'),
    });
    const itens = service.listReleaseActions();
    const encontrado = itens.find((item) => item.id === 'job-antigo');
    expect(encontrado).toBeTruthy();
    expect(encontrado.status).toBe('succeeded');
    expect(encontrado.exitCode).toBe(0);
  });

  it('registro `running` de sessão anterior com PID MORTO vira `interrupted` com motivo', () => {
    gravarRegistro({
      id: 'job-orfao',
      actionId: 'seal',
      label: 'Novo ciclo de selagem',
      status: 'running',
      pid: 999999, // PID improvável: nenhum processo real
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: null,
      logPath: path.join(dirJobs(), 'release-seal-job-orfao.log'),
    });
    const job = service.getReleaseAction({ jobId: 'job-orfao' });
    expect(job.status).toBe('interrupted');
    expect(job.interruptedReason).toMatch(/reiniciada/);
  });

  it('registro `running` com PID VIVO permanece `running` (não inventa interrupção)', () => {
    gravarRegistro({
      id: 'job-vivo',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'running',
      pid: process.pid,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: null,
      logPath: path.join(dirJobs(), 'release-verify-job-vivo.log'),
    });
    const job = service.getReleaseAction({ jobId: 'job-vivo' });
    expect(job.status).toBe('running');
    expect(job.interruptedReason).toBeUndefined();
  });

  it('lê o fim do log do job persistido (a evidência sobrevive ao reinício)', () => {
    const logPath = path.join(dirJobs(), 'release-verify-job-log.log');
    fs.mkdirSync(dirJobs(), { recursive: true });
    fs.writeFileSync(logPath, 'linha 1\nlinha 2\nDELIVERED_RELEASE_VERIFIED\n');
    gravarRegistro({
      id: 'job-log',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'succeeded',
      exitCode: 0,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: '2026-10-11T10:01:00.000Z',
      logPath,
    });
    const job = service.getReleaseAction({ jobId: 'job-log' });
    expect(job.logTail).toMatch(/DELIVERED_RELEASE_VERIFIED/);
  });

  it('registro ilegível é ignorado sem derrubar a listagem', () => {
    fs.mkdirSync(dirJobs(), { recursive: true });
    fs.writeFileSync(path.join(dirJobs(), 'quebrado.job.json'), '{nao-e-json');
    expect(() => service.listReleaseActions()).not.toThrow();
    expect(service.readPersistedJobs()).toHaveLength(0);
  });

  it('job inexistente ⇒ erro tipado (nunca um estado inventado)', () => {
    expect(() => service.getReleaseAction({ jobId: 'nao-existe' })).toThrow(/release_action_not_found/);
  });

  it('isProcessAlive reconhece o próprio processo e rejeita PID inexistente', () => {
    expect(service.isProcessAlive(process.pid)).toBe(true);
    expect(service.isProcessAlive(999999)).toBe(false);
    expect(service.isProcessAlive(0)).toBe(false);
    expect(service.isProcessAlive('abc')).toBe(false);
  });

  it('exporta o teto de retenção do histórico persistido', () => {
    expect(service.MAX_PERSISTED_JOBS).toBeGreaterThan(0);
  });
});
