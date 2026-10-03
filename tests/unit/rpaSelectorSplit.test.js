'use strict';

/**
 * Regressão do defeito real reproduzido em 2026-10-02 (execução do seed
 * `fitness-matricula-checkin` pelo mesh):
 *
 *   ✏️ Preencher - Seletor: input[placeholder="Nome, documento, telefone ou código"]
 *   ⚠️ page.click: Unexpected token "" while parsing css selector "input[placeholder="Nome"
 *
 * `_splitSelectors` fazia `selector.split(',')` sem respeitar aspas, então um
 * seletor com vírgula DENTRO do valor de um atributo (ou de uma pseudo-classe)
 * era cortado em pedaços inválidos. Como o passo era não-crítico, a falha
 * cascateava em silêncio até derrubar o assert final — e o cenário ainda era
 * classificado como `infra_error`, escondendo que a causa era FUNCIONAL.
 */

const M = require('../../core/rpa/actionExecutor');

const ActionExecutor = M.ActionExecutor || M;

function split(selector) {
  const instance = Object.create(ActionExecutor.prototype);
  return instance._splitSelectors(selector);
}

describe('actionExecutor._splitSelectors — vírgula só separa em nível de topo', () => {
  it('vírgula dentro do valor de um atributo NÃO divide (regressão do defeito real)', () => {
    const selector = 'input[placeholder="Nome, documento, telefone ou código"]';
    expect(split(selector)).toEqual([selector]);
  });

  it('vírgula dentro de :has-text() NÃO divide', () => {
    expect(split('button:has-text("Entrar, agora")')).toEqual(['button:has-text("Entrar, agora")']);
  });

  it('vírgula dentro de aspas simples NÃO divide', () => {
    expect(split("input[placeholder='a, b, c']")).toEqual(["input[placeholder='a, b, c']"]);
  });

  it('vírgula de topo continua separando seletores (comportamento preservado)', () => {
    expect(split('.rap-toast--success, .toast')).toEqual(['.rap-toast--success', '.toast']);
  });

  it('mistura de vírgula protegida e vírgula de topo separa só a de topo', () => {
    expect(split('button:has-text("a, b"), .outro')).toEqual(['button:has-text("a, b")', '.outro']);
  });

  it('vírgula dentro de parênteses sem aspas também é protegida', () => {
    expect(split(':is(a, b)')).toEqual([':is(a, b)']);
  });

  it('espaços em volta são aparados e entradas vazias descartadas', () => {
    expect(split('  .a ,  .b  ')).toEqual(['.a', '.b']);
    expect(split(',,')).toEqual([]);
  });

  it('entrada inválida devolve lista vazia', () => {
    expect(split('')).toEqual([]);
    expect(split(null)).toEqual([]);
    expect(split(undefined)).toEqual([]);
    expect(split(123)).toEqual([]);
  });

  it('controle negativo: a implementação ingênua antiga quebraria o seletor real', () => {
    // Prova que o teste cobre o defeito: `split(',')` puro produziria 4 pedaços inválidos.
    const selector = 'input[placeholder="Nome, documento, telefone ou código"]';
    expect(selector.split(',').length).toBeGreaterThan(1);
    expect(split(selector).length).toBe(1);
  });
});
