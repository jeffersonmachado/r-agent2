'use strict';

/**
 * REGRESSÃO PERMANENTE — suíte obrigatória não pode ser "verde por vacuidade".
 *
 * DEFEITO MEDIDO (histórico do repositório, registrado em AGENTS.md): até 2026-07 o comando
 * `npm run test:flow` rodava apenas `tests/flow`, que não contém NENHUM `*.test.js`. Com
 * `--passWithNoTests` o Jest saía com código 0 sem executar um único teste — um gate verde que não
 * executava nada. O gate foi corrigido incluindo `engine/__tests__`, mas a FLAG que permite o verde
 * vazio continuou no `package.json`, pronta para mascarar a próxima seleção errada.
 *
 * Missão CI DEFINITIVO §1: "Nunca aceitar testes com zero assertions efetivas"; §8: "Não usar
 * passWithNoTests". Este teste fixa as duas metades do contrato:
 *   1. nenhum script oficial carrega `--passWithNoTests`;
 *   2. a seleção de caminhos de cada script oficial contém, de fato, arquivos de teste.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));

const SCRIPTS_OFICIAIS = ['test:unit', 'test:flow', 'test:rpa:jest'];

function alvosDoScript(comando) {
  return String(comando)
    .split(/\s+/)
    .filter((token) => token && !token.startsWith('-') && token !== 'jest' && token !== 'npx');
}

/** Lista recursivamente quantos `*.test.js` existem sob um caminho. */
function contarTestes(rel) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) return 0;
  const stat = fs.statSync(abs);
  if (stat.isFile()) return /\.test\.js$/.test(abs) ? 1 : 0;
  let total = 0;
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
    total += contarTestes(path.join(rel, entrada.name));
  }
  return total;
}

describe('scripts oficiais de teste não podem passar com zero testes', () => {
  it('os três scripts oficiais existem no package.json', () => {
    for (const nome of SCRIPTS_OFICIAIS) {
      expect(typeof pkg.scripts[nome]).toBe('string');
    }
  });

  it.each(SCRIPTS_OFICIAIS)('%s não usa --passWithNoTests', (nome) => {
    expect(pkg.scripts[nome]).not.toMatch(/--passWithNoTests/);
  });

  it.each(SCRIPTS_OFICIAIS)('%s seleciona ao menos um diretório com arquivos de teste', (nome) => {
    const alvos = alvosDoScript(pkg.scripts[nome]);
    expect(alvos.length).toBeGreaterThan(0);
    const total = alvos.reduce((soma, alvo) => soma + contarTestes(alvo), 0);
    expect(total).toBeGreaterThan(0);
  });

  it('CONTROLE NEGATIVO: a detecção de suíte vazia funciona (tests/flow sozinho é vazio)', () => {
    // Se `tests/flow` passar a conter testes, este controle perde o sentido — o teste avisa em vez
    // de silenciar, e o `test:flow` continua válido pelos outros alvos.
    expect(contarTestes('tests/flow')).toBe(0);
    expect(contarTestes('engine/__tests__')).toBeGreaterThan(0);
  });
});
