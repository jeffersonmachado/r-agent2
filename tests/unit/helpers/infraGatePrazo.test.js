'use strict';

/**
 * Regressão do PRAZO da porta de infraestrutura (`tests/helpers/infraGate.js#comPrazo`).
 *
 * Defeito real medido no CI (run 39585223390, commit ac92a70ab): o passo L0 reprovou com
 * `Exceeded timeout of 60000 ms` em `tests/unit/engineeringRouterQwenProvider.test.js` porque,
 * sem Postgres no runner, `connect()` do Sequelize fica pendurado. O teste nunca chegava ao
 * `skipOrFail` — ou seja, "infra ausente" virava vermelho de suíte (e, com `bail: 1`, derrubava
 * a suíte oficial inteira) em vez do estado explícito `NOT_EXECUTED`.
 *
 * O que este arquivo trava:
 *  1. `comPrazo` REJEITA quando a promessa não resolva no prazo (nunca pendura);
 *  2. o erro tem código próprio (`INFRA_TIMEOUT`), para o chamador distinguir prazo de defeito;
 *  3. o resultado NÃO é sucesso: alimentado ao `skipOrFail`, o estado registrado é
 *     `NOT_EXECUTED` em modo dev e `INFRA_ERROR` (exceção) em release-authoritative. Prazo curto
 *     nunca pode virar PASS silencioso.
 */

const infraGate = require('../../helpers/infraGate');

describe('comPrazo — infra ausente não pode pendurar a suíte', () => {
  beforeEach(() => {
    infraGate.resetSkips();
    delete process.env.RELEASE_AUTHORITATIVE;
  });

  afterEach(() => {
    delete process.env.RELEASE_AUTHORITATIVE;
  });

  it('rejeita com INFRA_TIMEOUT quando a operação não responde', async () => {
    const nunca = () => new Promise(() => {});
    const inicio = Date.now();
    await expect(infraGate.comPrazo(nunca, { ms: 120, requisito: 'postgres' })).rejects.toMatchObject({
      code: 'INFRA_TIMEOUT',
      requisito: 'postgres',
      prazoMs: 120,
    });
    // Prova de que o prazo é o teto real (não um timeout acidental de 60 s do Jest).
    expect(Date.now() - inicio).toBeLessThan(5000);
  });

  it('devolve o valor quando a operação responde dentro do prazo', async () => {
    await expect(infraGate.comPrazo(async () => 'ok', { ms: 1000 })).resolves.toBe('ok');
  });

  it('propaga o erro ORIGINAL da operação (não mascara falha real como prazo)', async () => {
    const erroReal = Object.assign(new Error('senha inválida'), { code: '28P01' });
    await expect(infraGate.comPrazo(async () => { throw erroReal; }, { ms: 1000 })).rejects.toBe(erroReal);
  });

  it('prazo estourado vira NOT_EXECUTED (dev), nunca PASS silencioso', async () => {
    let capturado = null;
    try {
      await infraGate.comPrazo(() => new Promise(() => {}), { ms: 100, requisito: 'postgres' });
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).not.toBeNull();
    const devePular = infraGate.skipOrFail({
      suite: 'QWEN_LIVE',
      available: false,
      requirement: 'postgres+encryption_key',
      reason: capturado.message,
    });
    expect(devePular).toBe(true);
    const pulos = infraGate.recordedSkips();
    expect(pulos).toHaveLength(1);
    expect(pulos[0].state).toBe('NOT_EXECUTED');
    expect(pulos[0].suite).toBe('QWEN_LIVE');
    // O veredito agregado também não pode sair PASS pleno.
    expect(infraGate.buildExecutionEvidence({ suite: 'QWEN_LIVE' }).verdict).toBe('PASS_WITH_NOT_EXECUTED');
  });

  it('em release-authoritative o prazo estourado é INFRA_ERROR (não pulo)', async () => {
    process.env.RELEASE_AUTHORITATIVE = '1';
    let capturado = null;
    try {
      await infraGate.comPrazo(() => new Promise(() => {}), { ms: 100, requisito: 'postgres' });
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).not.toBeNull();
    expect(() => infraGate.skipOrFail({
      suite: 'QWEN_LIVE',
      available: false,
      requirement: 'postgres+encryption_key',
      reason: capturado.message,
    })).toThrow(/INFRA_UNAVAILABLE|release-authoritative/i);
  });
});
