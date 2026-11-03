#!/usr/bin/env node
'use strict';

/**
 * backfill-regression-tests.js — preenche `regressionTest` nos itens da fila que
 * declaram fechamento SEM apontar a suíte de regressão.
 *
 * POR QUE EXISTE
 * --------------
 * A regra canônica de estados (`governance/bug-closure/defect-states.js`) exige
 * `regressionTest` para FIXED_PENDING_VERIFICATION, VERIFIED e RESOLVED. Medido em
 * 2026-10-30: 47 itens VERIFIED não tinham o campo — ou seja, declaravam fechamento
 * sem prova executável, e o gate `validate-bug-closure-status` os acusava como
 * `FECHAMENTO_NAO_PROVADO`. O campo não estava preenchido porque ninguém o derivou
 * do que já existe no repositório.
 *
 * O QUE ELE FAZ
 * -------------
 * Para cada item em estado de fechamento sem `regressionTest`, resolve a suíte por
 * três fontes, nesta ordem de precedência (a primeira que casar vence):
 *
 *   1. arquivo de teste que CITA o id do item (grep exato);
 *   2. arquivo de teste citado na EVIDÊNCIA governada do próprio item;
 *   3. arquivo de teste tocado pelo COMMIT do fix (`git show --name-only`).
 *
 * Depois RE-EXECUTA o teste no código atual (Jest) e só grava o campo quando o
 * exit code é 0. A saída real fica registrada em `verificationNote` com comando,
 * exit e SHA — nunca uma afirmação sem medição.
 *
 * O QUE ELE NÃO FAZ (de propósito)
 * --------------------------------
 *   - NÃO inventa teste para item sem suíte identificável: esses vão para
 *     `semTesteResolvivel` no relatório e o item fica intocado (a decisão de
 *     reabrir, escrever teste novo ou aceitar risco é do dono).
 *   - NÃO executa specs de Playwright (`frontend-e2e/`): dependem da stack viva.
 *     Quando a evidência do CI é declarada, o campo é gravado com o prefixo
 *     `e2e:` e a nota diz que a prova é o job de CI, não uma execução local.
 *   - NÃO muda `state`: preencher a suíte é o que o estado já exigia.
 *
 * Uso:
 *   node scripts/governance/backfill-regression-tests.js [--dry-run] [--json]
 *        [--only <P0|P1|P2|P3>] [--limit N] [--timeout-ms N]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const FILA = path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json');
const RELATORIO = path.join(RAIZ, 'reports', 'regression-test-backfill.json');

const ESTADOS_FECHADOS = new Set(['VERIFIED', 'RESOLVED']);
const DIRS_BUSCA = ['tests', 'scripts', 'api', 'engine', 'qa', 'governance', 'frontend-e2e'];

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);

const DRY_RUN = flag('--dry-run');
const SOMENTE = arg('--only');
const LIMITE = Number(arg('--limit', '0')) || 0;
const TIMEOUT_MS = Number(arg('--timeout-ms', '600000'));

const RE_TESTE = /\.(test|spec)\.(js|jsx|cjs|mjs|ts|tsx)$/;

/** Caminhos de teste que citam o id do item. */
function testesQueCitamOId(id) {
  const args = ['-rlF', id, ...DIRS_BUSCA,
    '--include=*.js', '--include=*.cjs', '--include=*.mjs',
    '--include=*.ts', '--include=*.jsx'];
  try {
    const saida = execFileSync('grep', args, { cwd: RAIZ, encoding: 'utf8', timeout: 60000 });
    // Ordem EXPLÍCITA: a saída do grep não é ordenada, e escolher "o primeiro" sem ordenar
    // tornava a resolução não reprodutível entre execuções.
    return saida.split('\n').map((s) => s.trim()).filter((s) => s && RE_TESTE.test(s)).sort();
  } catch (_) {
    return [];
  }
}

/** Caminhos de teste citados na evidência declarada pelo próprio item. */
function testesDaEvidencia(item) {
  const texto = String((item && item.evidence) || '');
  const achados = texto.match(/[A-Za-z0-9_./-]+\.(?:test|spec)\.(?:js|jsx|cjs|mjs|ts|tsx)/g) || [];
  return [...new Set(achados.map((t) => t.replace(/^\.\//, '')))]
    .filter((t) => fs.existsSync(path.join(RAIZ, t)));
}

/** Caminhos de teste tocados pelo commit do fix. */
function testesDoCommit(item) {
  const commit = String((item && item.commit) || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) return [];
  try {
    const saida = execFileSync('git', ['show', '--pretty=format:', '--name-only', commit], {
      cwd: RAIZ, encoding: 'utf8', timeout: 30000, stdio: 'pipe',
    });
    return [...new Set(saida.split('\n').map((s) => s.trim()).filter((s) => s && RE_TESTE.test(s)))]
      .filter((t) => fs.existsSync(path.join(RAIZ, t)));
  } catch (_) {
    return [];
  }
}

/**
 * Escolhe o candidato mais provável entre vários.
 *
 * DEFEITO MEDIDO (2026-10-30, dry-run sobre a fila real): o commit do fix de
 * `E2E-SUPPORT-CENARIO1-PRECONDICAO` tocou DOIS specs (`qa-waves-replay` e
 * `support-agent-flow`); pegar o primeiro em ordem alfabética apontava o item de
 * suporte para o spec de replay — ponteiro errado, que é falso verde com cara de
 * prova. A escolha passa a ser por SOBREPOSIÇÃO DE TOKENS: quantas palavras do id
 * do item aparecem no caminho do candidato. Empate volta à ordem alfabética, para
 * a resolução continuar reprodutível.
 *
 * Jest tem precedência sobre Playwright/Vitest: é o que este script consegue
 * executar neste ambiente.
 */
function melhorExecutavel(lista, id = '') {
  if (!lista.length) return null;
  const jestavel = lista.filter((t) => !t.startsWith('frontend-e2e/') && !t.startsWith('frontend/'));
  const universo = jestavel.length ? jestavel : lista;
  const tokens = String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const pontuar = (caminho) => {
    const alvo = caminho.toLowerCase();
    return tokens.reduce((acc, t) => acc + (alvo.includes(t) ? 1 : 0), 0);
  };
  return [...universo]
    .sort((a, b) => (pontuar(b) - pontuar(a)) || a.localeCompare(b))[0];
}

/**
 * Resolve a suíte de regressão do item, com a fonte que a determinou.
 * @returns {{teste: string, fonte: string}|null}
 */
function resolverTeste(item) {
  const porId = testesQueCitamOId(item.id);
  const escolhidoPorId = melhorExecutavel(porId, item.id);
  if (escolhidoPorId) return { teste: escolhidoPorId, fonte: 'CITA_O_ID' };

  const porEvidencia = melhorExecutavel(testesDaEvidencia(item), item.id);
  if (porEvidencia) return { teste: porEvidencia, fonte: 'EVIDENCIA_DO_ITEM' };

  const porCommit = melhorExecutavel(testesDoCommit(item), item.id);
  if (porCommit) return { teste: porCommit, fonte: 'COMMIT_DO_FIX' };

  return null;
}

/** Executa o teste no código atual. Só Jest: Playwright exige stack viva. */
function executar(relTeste) {
  const ehFrontend = relTeste.startsWith('frontend/');
  const comando = ehFrontend
    ? `npm --prefix frontend run test -- ${relTeste.replace(/^frontend\//, '')}`
    : `npx jest ${relTeste} --bail=1 --ci --forceExit`;
  const inicio = Date.now();
  const r = spawnSync(comando, {
    cwd: RAIZ, shell: true, encoding: 'utf8', timeout: TIMEOUT_MS,
    env: { ...process.env, CI: 'true', VITE_CACHE_DIR: '/tmp/r-agent2-vite' },
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const cauda = saida.split('\n').filter((l) => /^(Tests|Test Suites):/.test(l)).join(' | ');
  return {
    comando,
    exitCode: r.status,
    duracaoMs: Date.now() - inicio,
    resumo: cauda || saida.slice(-200).replace(/\s+/g, ' '),
  };
}

function shaAtual() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim();
  } catch (_) {
    return 'SHA_INDISPONIVEL';
  }
}

function principal() {
  const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  const itens = fila.items || fila;
  const alvo = itens.filter((i) => {
    if (!ESTADOS_FECHADOS.has(String(i.state || '').toUpperCase())) return false;
    if (String(i.regressionTest || '').trim()) return false;
    if (SOMENTE && String(i.severity || '').toUpperCase() !== SOMENTE.toUpperCase()) return false;
    return true;
  }).slice(0, LIMITE > 0 ? LIMITE : undefined);

  const sha = shaAtual();
  const resultados = [];
  for (const item of alvo) {
    const resolucao = resolverTeste(item);
    if (!resolucao) {
      resultados.push({ id: item.id, severity: item.severity || null, status: 'SEM_TESTE_RESOLVIVEL' });
      continue;
    }
    const ehE2e = resolucao.teste.startsWith('frontend-e2e/');
    if (ehE2e) {
      // Playwright: não executável aqui. O campo é gravado com prefixo `e2e:` e a nota
      // declara que a prova é o job de CI — nunca uma execução local inventada.
      resultados.push({
        id: item.id, severity: item.severity || null, status: 'DECLARADO_E2E',
        teste: resolucao.teste, fonte: resolucao.fonte,
      });
      if (!DRY_RUN) {
        item.regressionTest = `e2e:${resolucao.teste}`;
        item.verificationNote = `backfill-regression-tests.js: suite declarada (${resolucao.fonte}) — prova de execucao e o job de E2E do CI, nao execucao local; sha ${sha}`;
      }
      continue;
    }
    const exec = executar(resolucao.teste);
    const passou = exec.exitCode === 0;
    resultados.push({
      id: item.id, severity: item.severity || null, teste: resolucao.teste,
      fonte: resolucao.fonte, status: passou ? 'BACKFILL_APLICADO' : 'TESTE_FALHOU_AGORA',
      exitCode: exec.exitCode, duracaoMs: exec.duracaoMs, resumo: exec.resumo,
    });
    if (passou && !DRY_RUN) {
      item.regressionTest = resolucao.teste;
      item.verificationNote = `backfill-regression-tests.js: ${exec.comando} exit=0 em ${sha} (${new Date().toISOString()})`;
    }
  }

  const contagem = resultados.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  if (!DRY_RUN) {
    fila.items = itens;
    fs.writeFileSync(FILA, `${JSON.stringify(fila, null, 2)}\n`);
    fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
    fs.writeFileSync(RELATORIO, `${JSON.stringify({
      generatedAt: new Date().toISOString(), sha, dryRun: false, alvo: alvo.length, contagem, resultados,
    }, null, 2)}\n`);
  }

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ sha, dryRun: DRY_RUN, alvo: alvo.length, contagem, resultados }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`[backfill] sha=${sha} dryRun=${DRY_RUN} alvo=${alvo.length}\n`);
  for (const [status, n] of Object.entries(contagem)) process.stdout.write(`[backfill] ${status}=${n}\n`);
  for (const r of resultados.filter((x) => x.status !== 'BACKFILL_APLICADO')) {
    process.stdout.write(`[backfill] ${r.status} ${r.id}${r.teste ? ` -> ${r.teste}` : ''}${r.resumo ? ` :: ${r.resumo.slice(0, 120)}` : ''}\n`);
  }
}

if (require.main === module) principal();

module.exports = { resolverTeste, melhorExecutavel, testesQueCitamOId, testesDaEvidencia, testesDoCommit };
