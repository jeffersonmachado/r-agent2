'use strict';

/**
 * Contratos de CI que já foram violados uma vez (medidos), agora travados por teste.
 *
 *   - `P1-CI-SEM-INTEGRACAO`: o pipeline rodava só unit/flow; `tests/integration` (que é onde
 *     os P0 de isolamento de tenant provam comportamento com Postgres real) nunca executava.
 *   - `CI-MAIN-JEST-AMBIENTE`: o job principal rodava `npm test` sem preparar o ambiente
 *     canônico (bootstrap + migrations) — suíte verde por ausência de pré-requisito.
 *   - `CI-WAVE-REFRESH-SEM-RUN-GOVERNADO`: o refresh agendado de waves produzia evidência SEM
 *     run governado, e os produtores (fail-closed) morriam com LINEAGE_RUN_UNDEFINED; as
 *     evidências venciam e o coverage gate degradava VALIDATED -> STALE.
 *
 * A "implementação" desses três itens É o arquivo de workflow, então a verificação correta é
 * sobre a estrutura e a ORDEM dos passos — não sobre a prosa dos comentários.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const pkg = () => JSON.parse(ler('package.json'));

const JEST = ler('.github/workflows/jest.yml');
const WAVES = ler('.github/workflows/wave-reports.yml');

/** Índice da PRIMEIRA ocorrência (falha alto se o marcador desaparecer). */
const pos = (texto, agulha) => {
  const i = texto.indexOf(agulha);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};

describe('P1-CI-SEM-INTEGRACAO — integração roda no pipeline, com Postgres real', () => {
  test('existe job de integração declarado', () => {
    expect(JEST).toMatch(/Jest Integration|tests\/integration/);
  });

  test('o job de integração sobe serviço Postgres (não simula banco)', () => {
    const inicio = pos(JEST, 'Integration');
    const trecho = JEST.slice(inicio, inicio + 4000);
    expect(trecho).toMatch(/postgres:/);
    expect(trecho).toMatch(/POSTGRES_USER/);
    expect(trecho).toMatch(/pg_isready/);
  });

  test('o comando de integração aponta para uma suíte que existe no repositório', () => {
    // Os cenários de integração existem de verdade (não é comando decorativo).
    const dir = path.join(RAIZ, 'tests', 'integration');
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
    expect(arquivos.length).toBeGreaterThan(0);
    expect(JEST).toMatch(/tests\/integration|test:integration|test:system/);
  });
});

describe('CI-MAIN-JEST-AMBIENTE — o job principal prepara o ambiente antes de testar', () => {
  test('`npm test` é executado (suíte oficial), nunca um subconjunto silencioso', () => {
    expect(JEST).toMatch(/run: npm test\b/);
  });

  test('bootstrap canônico e migrations vêm ANTES do `npm test`', () => {
    const bootstrap = pos(JEST, 'npm run ci:bootstrap');
    const migrate = pos(JEST, 'npm run db:migrate');
    const testes = pos(JEST, 'run: npm test');
    expect(bootstrap).toBeLessThan(testes);
    expect(migrate).toBeLessThan(testes);
  });

  test('os comandos de preparo existem no package.json (não são nomes inventados)', () => {
    const scripts = pkg().scripts || {};
    expect(typeof scripts['ci:bootstrap']).toBe('string');
    expect(typeof scripts['db:migrate']).toBe('string');
    expect(typeof scripts.test).toBe('string');
  });
});

describe('CI-WAVE-REFRESH-SEM-RUN-GOVERNADO — evidência de wave só nasce DENTRO de um run', () => {
  test('o run governado é aberto ANTES da primeira wave', () => {
    const abrir = pos(WAVES, 'create-governed-run.js');
    // `run:` explícito: comentário NÃO satisfaz contrato de pipeline.
    const primeiraWave = pos(WAVES, 'run: npm run wave:');
    expect(abrir).toBeLessThan(primeiraWave);
  });

  test('o run é fechado ao final, mesmo quando uma wave falha (`if: always()`)', () => {
    const fechar = pos(WAVES, 'close-run-context.js');
    expect(fechar).toBeGreaterThan(pos(WAVES, 'run: npm run wave:'));
    // Fechamento incondicional: run órfão é a classe de defeito do H20.
    const trecho = WAVES.slice(Math.max(0, fechar - 1200), fechar);
    expect(trecho).toMatch(/if: always\(\)/);
  });

  test('o fechamento declara status, motivo e evidência (não fecha em silêncio)', () => {
    const inicio = pos(WAVES, 'close-run-context.js');
    const trecho = WAVES.slice(inicio, inicio + 900);
    expect(trecho).toMatch(/--status\s+SUPERSEDED/);
    expect(trecho).toMatch(/--reason\s+"/);
    expect(trecho).toMatch(/--evidence\s+"/);
  });

  test('as três waves rodam depois do run aberto', () => {
    const abrir = pos(WAVES, 'create-governed-run.js');
    for (const wave of ['run: npm run wave:db-integrity', 'run: npm run wave:api-surface', 'run: npm run wave:page-surface']) {
      expect(pos(WAVES, wave)).toBeGreaterThan(abrir);
    }
  });

  test('o ponteiro do run NÃO entra no commit (só os relatórios) e o commit usa [skip ci]', () => {
    const commit = pos(WAVES, 'git commit');
    const trecho = WAVES.slice(commit, commit + 600);
    expect(trecho).toMatch(/skip ci/);
    expect(trecho).not.toMatch(/git add[^\n]*\.current-run\.json/);
  });
});
