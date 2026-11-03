'use strict';

/**
 * FECHAMENTOS-SEM-SUITE-DE-REGRESSAO — nenhum item FECHADO sem suíte de regressão identificável.
 *
 * Medição original (2026-10-30, `backfill-regression-tests.js`): de 59 itens em estado de
 * fechamento sem `regressionTest`, 48 foram resolvidos por fonte real e 11 não tinham nenhuma
 * suíte identificável. Sem suíte, "fechado" é declaração — a máquina de estados exige o campo
 * justamente para que o fechamento seja reexecutável por outra pessoa.
 *
 * A guarda é de duas pontas: (a) sobre a FILA REAL, exigindo suíte declarada e existente em todo
 * item fechado; (b) sobre uma fila SINTÉTICA com o defeito, provando que o predicado detecta a
 * ausência. Uma ponta sem a outra seria vácuo: (a) sozinha passaria com a fila vazia e (b) sozinha
 * não diria nada sobre o repositório.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const FILA = JSON.parse(fs.readFileSync(path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));

/** Estados que DECLARAM fechamento para a certificação. */
const FECHADOS = new Set(['done', 'verified', 'prevention_active', 'ready_for_approval']);

/**
 * Predicado canônico: um item fechado precisa de suíte DECLARADA e PRESENTE.
 * @returns {Array<{id: string, motivo: string}>}
 */
function violacoesDeSuite(itens, raiz = RAIZ) {
  const saida = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    if (!item || !FECHADOS.has(String(item.status || '').toLowerCase())) continue;
    const rel = item.regressionTest;
    if (typeof rel !== 'string' || rel.trim() === '') {
      saida.push({ id: item.id, motivo: 'SEM_SUITE_DECLARADA' });
      continue;
    }
    if (/\s/.test(rel)) {
      saida.push({ id: item.id, motivo: 'SUITE_NAO_E_CAMINHO' });
      continue;
    }
    if (!fs.existsSync(path.join(raiz, rel))) {
      saida.push({ id: item.id, motivo: 'SUITE_INEXISTENTE', caminho: rel });
    }
  }
  return saida;
}

describe('fechamentos — a fila real não tem item fechado sem suíte', () => {
  test('zero violações na fila oficial', () => {
    expect(violacoesDeSuite(FILA.items)).toEqual([]);
  });

  test('a verificação tem alcance real (não passa por fila vazia)', () => {
    expect(Array.isArray(FILA.items)).toBe(true);
    const fechados = FILA.items.filter((i) => FECHADOS.has(String(i.status || '').toLowerCase()));
    // Se este número cair a zero, o teste acima viraria vácuo — e é exatamente isso que se quer
    // detectar aqui, não mascarar.
    expect(fechados.length).toBeGreaterThan(100);
  });

  test('todo item fechado aponta para um arquivo que o repositório tem', () => {
    const fechados = FILA.items.filter((i) => FECHADOS.has(String(i.status || '').toLowerCase()));
    for (const item of fechados) {
      const abs = path.join(RAIZ, item.regressionTest);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });
});

describe('fechamentos — o predicado DETECTA o defeito (prova de sensibilidade)', () => {
  const item = (over = {}) => ({ id: 'X', status: 'verified', ...over });

  test('sem `regressionTest` ⇒ SEM_SUITE_DECLARADA', () => {
    expect(violacoesDeSuite([item()])).toEqual([{ id: 'X', motivo: 'SEM_SUITE_DECLARADA' }]);
  });

  test('campo vazio/em branco ⇒ SEM_SUITE_DECLARADA (não é "declarado")', () => {
    expect(violacoesDeSuite([item({ regressionTest: '   ' })])[0].motivo).toBe('SEM_SUITE_DECLARADA');
  });

  test('caminho inexistente ⇒ SUITE_INEXISTENTE', () => {
    const v = violacoesDeSuite([item({ regressionTest: 'tests/unit/nao-existe.test.js' })]);
    expect(v[0].motivo).toBe('SUITE_INEXISTENTE');
  });

  test('prosa com espaço não é caminho de suíte', () => {
    const v = violacoesDeSuite([item({ regressionTest: 'teste negativo de proveniência' })]);
    expect(v[0].motivo).toBe('SUITE_NAO_E_CAMINHO');
  });

  test('item ABERTO não é exigido (a regra é sobre fechamento)', () => {
    expect(violacoesDeSuite([{ id: 'Y', status: 'pending' }])).toEqual([]);
    expect(violacoesDeSuite([{ id: 'Y', status: 'blocked_external' }])).toEqual([]);
  });

  test('suíte real aceita (contraprova do predicado)', () => {
    const real = FILA.items.find((i) => FECHADOS.has(String(i.status || '').toLowerCase()));
    expect(violacoesDeSuite([real])).toEqual([]);
  });
});
