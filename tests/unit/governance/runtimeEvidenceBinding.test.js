'use strict';

/**
 * BINDING entre a evidência de runtime V1 e os testes REAIS que a provam.
 *
 * DEFEITO REAL medido em 2026-09-28: o item `RESTART_RESUME` apontava para o `testId`
 * 'restart-safe', que não existe em nenhum teste do repositório (os nomes dos testes da suíte
 * mudaram e o mapa não acompanhou). O coletor roda Jest com `--testNamePattern`, então o filtro
 * casava com ZERO testes, todos ficavam `pending`, e o item terminava em
 * "todos os testes que casaram estão skip/pending — nenhuma prova real de comportamento":
 * `RUNTIME_FAIL` no gate de runtime. Ninguém tinha notado porque o binding só é exercido quando
 * alguém roda a coleta completa.
 *
 * Este teste fecha a classe do defeito: TODO `testId` do mapa precisa casar (como regex do Jest)
 * com pelo menos um `describe(...)`/`test(...)` REAL do arquivo apontado. Binding stale passa a
 * falhar em `npm run test:unit`, não na hora da prova.
 */

const fs = require('fs');
const path = require('path');

const { RUNTIME_ITEMS } = require('../../../scripts/governance/collect-engineering-router-runtime-evidence');

const ROOT = path.join(__dirname, '..', '..', '..');

/** Nomes reais declarados no arquivo: `describe('...')`, `test('...')`, `it('...')`.
 *  Inclui TEMPLATE LITERALS (crase): há testes nomeados com interpolação
 *  (`` test(`REJECTED ou sem efeito colateral real: ${payload.name}`) ``), e ignorá-los produziria
 *  falso stale — exatamente o tipo de leitura parcial que já causou diagnóstico errado no repo. */
function declaredNames(absPath) {
  const source = fs.readFileSync(absPath, 'utf8');
  const names = [];
  for (const match of source.matchAll(/\b(?:describe|test|it)\(\s*'([^']+)'/g)) names.push(match[1]);
  for (const match of source.matchAll(/\b(?:describe|test|it)\(\s*"([^"]+)"/g)) names.push(match[1]);
  for (const match of source.matchAll(/\b(?:describe|test|it)\(\s*`([^`]+)`/g)) {
    names.push(match[1].replace(/\$\{[^}]*\}/g, 'INTERPOLADO'));
  }
  return names;
}

describe('binding da evidência de runtime V1 com os testes reais', () => {
  test('o mapa RUNTIME_ITEMS é não-vazio e tem IDs únicos', () => {
    expect(Array.isArray(RUNTIME_ITEMS)).toBe(true);
    expect(RUNTIME_ITEMS.length).toBeGreaterThan(20);
    const ids = RUNTIME_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('todo testPath existe no repositório', () => {
    const missing = RUNTIME_ITEMS.filter((item) => !fs.existsSync(path.join(ROOT, item.testPath)));
    expect(missing.map((item) => `${item.id} → ${item.testPath}`)).toEqual([]);
  });

  test('todo testId casa com pelo menos um teste REAL declarado no arquivo (nunca binding stale)', () => {
    const stale = [];
    for (const item of RUNTIME_ITEMS) {
      const abs = path.join(ROOT, item.testPath);
      if (!fs.existsSync(abs)) continue; // coberto pelo teste acima
      const names = declaredNames(abs);
      const pattern = new RegExp(item.testId);
      if (!names.some((name) => pattern.test(name))) {
        stale.push(`${item.id} → /${item.testId}/ em ${item.testPath} (0 testes casam; ${names.length} declarados)`);
      }
    }
    expect(stale).toEqual([]);
  });
});
