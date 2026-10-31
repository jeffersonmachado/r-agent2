'use strict';

/**
 * Disponibilidade do sandbox: cache NEGATIVO não pode envenenar o processo.
 *
 * DEFEITO REAL MEDIDO (2026-10-21): rodando `npx jest tests/unit` completo, o probe
 * `docker info` (timeout 5000 ms) estourou por contenção — 11 workers na máquina — e o
 * resultado NEGATIVO foi cacheado para todo o processo. A suíte
 * `engineeringRouterExecutionSandboxSecurity` passou a receber `SANDBOX_UNAVAILABLE` em 6 casos
 * com o Docker saudável (`docker ps` respondendo). A MESMA suíte, isolada, passava 10/10.
 *
 * Consequência em produção: um runner sob carga reprova tasks legítimas como INFRA_ERROR.
 *
 * Contrato provado aqui:
 *   1. resultado POSITIVO é cacheado (Docker não "desaparece" durante o processo);
 *   2. falha TRANSITÓRIA (timeout/SIGTERM) é retentada na mesma checagem e, se persistir,
 *      responde `false` SEM envenenar o processo (a próxima chamada reavalia);
 *   3. `ENOENT` (CLI inexistente) é definitivo e cacheado;
 *   4. o consumidor típico decide UMA vez (`beforeAll`), então a retentativa é o que evita
 *      falso negativo por lentidão momentânea.
 */

const mockExecFileSync = jest.fn();

jest.mock('child_process', () => ({ execFileSync: (...args) => mockExecFileSync(...args) }));

function carregarModulo({ tentativas } = {}) {
  const anterior = process.env.ENGINEERING_ROUTER_DOCKER_PROBE_ATTEMPTS;
  if (tentativas !== undefined) process.env.ENGINEERING_ROUTER_DOCKER_PROBE_ATTEMPTS = String(tentativas);
  else delete process.env.ENGINEERING_ROUTER_DOCKER_PROBE_ATTEMPTS;
  let mod;
  jest.isolateModules(() => {
    mod = require('../../api/services/engineeringRouter/executionSandbox');
  });
  if (anterior === undefined) delete process.env.ENGINEERING_ROUTER_DOCKER_PROBE_ATTEMPTS;
  else process.env.ENGINEERING_ROUTER_DOCKER_PROBE_ATTEMPTS = anterior;
  return mod;
}

const erroTimeout = () => Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' });

describe('isSandboxAvailable — cache', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  test('Docker disponível é cacheado: o probe roda UMA vez', () => {
    mockExecFileSync.mockReturnValue('27.3.1');
    const { isSandboxAvailable } = carregarModulo();

    expect(isSandboxAvailable()).toBe(true);
    expect(isSandboxAvailable()).toBe(true);
    expect(isSandboxAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  test('transiente na 1ª tentativa e sucesso na 2ª ⇒ TRUE (o retry é o ponto)', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw erroTimeout(); })
      .mockReturnValue('27.3.1');
    const { isSandboxAvailable } = carregarModulo();

    // Sem retry, isto responderia `false` e o `beforeAll` da suíte pularia tudo.
    expect(isSandboxAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  test('todas as tentativas falham por timeout ⇒ FALSE, mas a próxima chamada reavalia', () => {
    mockExecFileSync.mockImplementation(() => { throw erroTimeout(); });
    const { isSandboxAvailable } = carregarModulo({ tentativas: 2 });

    expect(isSandboxAvailable()).toBe(false);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2); // 2 tentativas da MESMA checagem

    // Daemon responde: recupera. Com o cache negativo antigo, ficaria `false` para sempre.
    mockExecFileSync.mockReturnValue('27.3.1');
    expect(isSandboxAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
  });

  test('SIGTERM (processo morto por timeout) também não envenena o cache', () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync docker SIGTERM'), { signal: 'SIGTERM' });
    });
    const { isSandboxAvailable } = carregarModulo({ tentativas: 1 });

    expect(isSandboxAvailable()).toBe(false);
    mockExecFileSync.mockReturnValue('27.3.1');
    expect(isSandboxAvailable()).toBe(true);
  });

  test('CLI inexistente (ENOENT) é DEFINITIVO: não reavalia nem retenta', () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' });
    });
    const { isSandboxAvailable } = carregarModulo({ tentativas: 3 });

    expect(isSandboxAvailable()).toBe(false);
    expect(isSandboxAvailable()).toBe(false);
    // 1 única tentativa apesar de `tentativas: 3` — ENOENT não é transiente.
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  test('resetSandboxAvailabilityCache força reavaliação', () => {
    mockExecFileSync.mockReturnValue('27.3.1');
    const { isSandboxAvailable, resetSandboxAvailabilityCache } = carregarModulo();

    expect(isSandboxAvailable()).toBe(true);
    resetSandboxAvailabilityCache();
    expect(isSandboxAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  test('sucesso após falha passa a ser cacheado (não há probe extra)', () => {
    mockExecFileSync.mockImplementation(() => { throw erroTimeout(); });
    const { isSandboxAvailable } = carregarModulo({ tentativas: 1 });

    expect(isSandboxAvailable()).toBe(false);
    mockExecFileSync.mockReturnValue('27.3.1');
    expect(isSandboxAvailable()).toBe(true);
    expect(isSandboxAvailable()).toBe(true);
    // 1 falha + 1 sucesso; o sucesso vira cache.
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });
});
