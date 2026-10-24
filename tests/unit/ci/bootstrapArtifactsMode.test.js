'use strict';

/**
 * MODO `--artifacts-only` DO BOOTSTRAP DE CI (`npm run ci:artifacts`).
 *
 * DEFEITO MEDIDO (2026-10-24, duas árvores idênticas — mesmo Node 22.12.0, mesmo lockfile, mesmo
 * `.env`): `jest tests/unit` NÃO é autossuficiente. Sem os artefatos ignorados pelo git
 * (`reports/*.json`, `governance/json-persistence-audit.json`, `qa-mesh/meshRegistry.json`) o L0
 * reprovava 23 testes (baseline `484eee478`) e 20 testes (branch do PR #16), com `ENOENT`,
 * `GRAPH_ABSENT` e validador rodando com exit != 0 — nenhuma dessas falhas era defeito de produto.
 * Com os artefatos produzidos pelos produtores canônicos, sobrou 1 único teste
 * (`modelDrivenE2e`), cuja prova só existe depois do job `prod-like-smoke` do CI.
 *
 * O que este arquivo trava (comportamento, não texto):
 *  1. o modo existe e é o ÚNICO acionável por flag — o modo completo continua o padrão;
 *  2. o modo executa os 12 produtores canônicos, na ordem declarada, e NUNCA `system:bootstrap`,
 *     seed ou preflight/conectividade (é isso que o torna utilizável numa árvore só com deps);
 *  3. um produtor que NÃO cria o artefato prometido leva o veredito a `INCOMPLETE` (exit 1) —
 *     o modo não fabrica artefato nem converte ausência em READY;
 *  4. veredito de produtor (ex.: `NO_GO`) é registrado como está, nunca reescrito como PASS;
 *  5. a raiz de execução pode ser trocada só fora de produção (auditável no relatório).
 *
 * O teste NÃO executa produtor real: monta uma raiz descartável com produtores falsos que só
 * escrevem arquivos-sentinela, via `CI_BOOTSTRAP_ROOT` (recusado quando `NODE_ENV=production`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'ci', 'bootstrap-ci-environment.js');
const { ARTEFATOS_OBRIGATORIOS, parseArgs } = require(SCRIPT);

/**
 * Ordem canônica dos produtores (id do passo no relatório ⇒ script npm que o executa).
 * `impact-graph` não é script npm: é `node scripts/governance/build-impact-graph.js`.
 */
const PRODUTORES_ESPERADOS = [
  ['mesh-registry', 'qa:mesh:refresh'],
  ['impact-graph', null],
  ['coverage-completeness', 'validate:coverage-completeness'],
  ['benchmark-sufficiency', 'validate:benchmark-sufficiency'],
  ['evo-contract', 'validate:evo-contract'],
  ['layer-conventions', 'validate:layer-conventions'],
  ['journey-projections', 'journey:projections'],
  ['json-persistence-audit', 'audit:json-persistence'],
  ['timeout-architecture', 'validate:timeout-architecture'],
  ['engineering-router-v2', 'validate:engineering-router-v2'],
  ['governance-summary', 'validate:governance-summary'],
  ['impact-validation', 'impact:validate'],
];

/**
 * Raiz descartável: `package.json` com os mesmos nomes de script do repositório, cada um
 * apenas anexando o próprio id em `executados.txt`. Nenhum produtor real é chamado.
 */
function criarRaizFalsa({ artefatosFaltando = [], vereditoDoProdutor = '' } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-artifacts-'));
  fs.writeFileSync(path.join(raiz, 'executados.txt'), '', 'utf8');

  const registrador = (id) => `node -e "require('fs').appendFileSync('executados.txt', '${id}\\n')${vereditoDoProdutor ? `;console.log('${vereditoDoProdutor}')` : ''}"`;
  const scripts = {};
  for (const [id, script] of PRODUTORES_ESPERADOS) {
    if (script) scripts[script] = registrador(id);
  }
  fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ name: 'raiz-falsa', version: '1.0.0', scripts }), 'utf8');

  // O passo `impact-graph` roda um ARQUIVO real (`node scripts/governance/build-impact-graph.js`).
  fs.mkdirSync(path.join(raiz, 'scripts', 'governance'), { recursive: true });
  fs.writeFileSync(
    path.join(raiz, 'scripts', 'governance', 'build-impact-graph.js'),
    "require('fs').appendFileSync('executados.txt', 'impact-graph\\n');\n",
    'utf8',
  );

  for (const item of ARTEFATOS_OBRIGATORIOS) {
    if (artefatosFaltando.includes(item.caminho)) continue;
    const destino = path.join(raiz, item.caminho);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, '{"produzido":"produtor-falso"}\n', 'utf8');
  }
  return { raiz, marcador: path.join(raiz, 'executados.txt') };
}

function rodarBootstrap(raiz, args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, CI_BOOTSTRAP_ROOT: raiz, NODE_ENV: 'test', ...env },
  });
}

function lerRelatorio(raiz) {
  return JSON.parse(fs.readFileSync(path.join(raiz, 'reports', 'ci-bootstrap-report.json'), 'utf8'));
}

describe('bootstrap de CI — modo artifacts-only', () => {
  const arvores = [];
  afterAll(() => {
    for (const raiz of arvores) fs.rmSync(raiz, { recursive: true, force: true });
  });
  const novaRaiz = (opcoes) => {
    const criada = criarRaizFalsa(opcoes);
    arvores.push(criada.raiz);
    return criada;
  };

  test('a flag existe e o padrão continua sendo o modo completo', () => {
    expect(parseArgs(['--artifacts-only'])).toEqual({ artifactsOnly: true });
    expect(parseArgs([])).toEqual({ artifactsOnly: false });
    expect(parseArgs(['--outra-coisa'])).toEqual({ artifactsOnly: false });
  });

  test('`npm run ci:artifacts` é o modo artifacts-only e `ci:bootstrap` continua completo', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['ci:artifacts']).toBe('node scripts/ci/bootstrap-ci-environment.js --artifacts-only');
    expect(pkg.scripts['ci:bootstrap']).toBe('node scripts/ci/bootstrap-ci-environment.js');
  });

  test('executa os 12 produtores canônicos, na ordem declarada', () => {
    const { raiz, marcador } = novaRaiz();
    const r = rodarBootstrap(raiz, ['--artifacts-only']);
    expect(r.status).toBe(0);
    const executados = fs.readFileSync(marcador, 'utf8').trim().split('\n').filter(Boolean);
    expect(executados).toEqual(PRODUTORES_ESPERADOS.map(([id]) => id));
  });

  test('NÃO executa system:bootstrap, seed sintético nem preflight/conectividade', () => {
    const { raiz, marcador } = novaRaiz();
    const r = rodarBootstrap(raiz, ['--artifacts-only']);
    expect(r.status).toBe(0);
    const saida = `${r.stdout}${r.stderr}`;
    expect(saida).not.toMatch(/system-bootstrap/);
    expect(saida).not.toMatch(/seed-sintetico/);
    expect(saida).not.toMatch(/conectividade-infra/);
    expect(fs.readFileSync(marcador, 'utf8')).not.toMatch(/system:bootstrap/);
  });

  test('artefato ausente ⇒ veredito INCOMPLETE e exit 1 (nunca fabrica a prova)', () => {
    const faltante = ARTEFATOS_OBRIGATORIOS[0].caminho;
    const { raiz } = novaRaiz({ artefatosFaltando: [faltante] });
    const r = rodarBootstrap(raiz, ['--artifacts-only']);
    expect(r.status).toBe(1);
    const relatorio = lerRelatorio(raiz);
    expect(relatorio.veredito).toBe('INCOMPLETE');
    expect(relatorio.modo).toBe('artifacts-only');
    const prova = relatorio.passos.find((p) => p.id === 'artefatos-obrigatorios');
    expect(prova.ok).toBe(false);
    expect(prova.faltando).toContain(faltante);
    expect(fs.existsSync(path.join(raiz, faltante))).toBe(false);
  });

  test('veredito NO_GO do produtor fica registrado como NO_GO (não vira PASS)', () => {
    const { raiz } = novaRaiz({ vereditoDoProdutor: 'NO_GO' });
    rodarBootstrap(raiz, ['--artifacts-only']);
    const relatorio = lerRelatorio(raiz);
    const comVeredito = relatorio.passos.filter((p) => p.veredito === 'NO_GO');
    expect(comVeredito.length).toBeGreaterThan(0);
    expect(comVeredito.every((p) => p.veredito !== 'PASS')).toBe(true);
  });

  test('a raiz efetiva e o override ficam auditáveis no relatório', () => {
    const { raiz } = novaRaiz();
    rodarBootstrap(raiz, ['--artifacts-only']);
    const relatorio = lerRelatorio(raiz);
    expect(relatorio.raiz).toBe(fs.realpathSync(raiz));
    expect(relatorio.raizOverride).toBe(true);
    expect(relatorio.fonteDeVerdadeDeGate).toMatch(/governance-score\.json/);
  });

  test('override de raiz é recusado com NODE_ENV=production', () => {
    const { raiz } = novaRaiz();
    const r = rodarBootstrap(raiz, ['--artifacts-only'], { NODE_ENV: 'production' });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/CI_BOOTSTRAP_ROOT recusado/);
    expect(fs.existsSync(path.join(raiz, 'reports', 'ci-bootstrap-report.json'))).toBe(false);
  });

  test('cada artefato obrigatório nomeia um consumidor que existe no repositório', () => {
    expect(ARTEFATOS_OBRIGATORIOS.length).toBeGreaterThanOrEqual(10);
    for (const item of ARTEFATOS_OBRIGATORIOS) {
      const consumidor = String(item.consumidor).split(' ')[0];
      if (!consumidor.endsWith('.js')) continue;
      expect(fs.existsSync(path.join(REPO_ROOT, consumidor))).toBe(true);
    }
  });
});
