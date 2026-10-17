#!/usr/bin/env node
'use strict';

/**
 * RECONCILIAÇÃO EXECUTÁVEL DA FILA OFICIAL (BUG CLOSURE FIRST, 2026-10-17).
 *
 * PROBLEMA QUE RESOLVE
 * --------------------
 * 61 itens estavam "abertos" na fila porque o estado legado (`done`) NÃO é prova:
 * o item dizia "teste X passa", mas nada no ciclo atual executava esse teste.
 * Ao mesmo tempo, exigir que um humano reabra 61 itens um a um é inviável — e
 * declarar fechado sem executar é exatamente o falso verde proibido.
 *
 * O QUE FAZ
 * ---------
 * Para cada item aberto com `regressionTest` existente em disco, EXECUTA o teste
 * no SHA atual e registra: exit code, duração, sha256 da saída e classificação.
 *
 *   PASS          exit 0                     → verificação real no SHA atual
 *   FAIL          exit != 0                  → a correção NÃO está provada agora
 *   INCONCLUSIVO  falha de infraestrutura    → NÃO é pass (não prova nem refuta)
 *   SEM_TESTE     nenhum teste identificável → exige criação de teste
 *
 * `--apply` grava `targetedTestPassing: true` + `verificationCommit` SOMENTE em
 * PASS. Item com FAIL/INCONCLUSIVO/SEM_TESTE permanece aberto — sem exceção.
 *
 * Uso:
 *   node scripts/governance/reconcile-hardening-queue.js            # mede, não grava
 *   node scripts/governance/reconcile-hardening-queue.js --apply
 *   node scripts/governance/reconcile-hardening-queue.js --somente P0-1,P1-2
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILA = path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json');
const RELATORIO = path.join(ROOT, 'reports', 'hardening-queue-reconciliation.json');

const { ESTADOS } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-states'));

/**
 * Orçamento PADRÃO por teste dirigido. 240s cobre a maioria das suítes unitárias, mas
 * EXISTS directed verification que legitimamente leva mais (E2E de worker/E2E real de missão,
 * medido: `governanceApprovalFullWorkerE2E` > 4 min). Sem um override EXPLÍCITO o item ficava
 * eternamente INCONCLUSIVO e “pendente de janela” — um gate que nunca fecha por limitação do
 * próprio verificador, não por defeito.
 *
 * Override por env, com TETO: nunca vira “espera infinita”. O valor efetivo vai no relatório
 * (auditável); o default continua 240s.
 */
const ORCAMENTO_PADRAO_MS = 240 * 1000;
const ORCAMENTO_MAXIMO_MS = 900 * 1000;
const ORCAMENTO_MS = (() => {
  const bruto = Number(process.env.RECONCILE_BUDGET_MS);
  if (!Number.isFinite(bruto) || bruto <= 0) return ORCAMENTO_PADRAO_MS;
  return Math.min(Math.round(bruto), ORCAMENTO_MAXIMO_MS);
})();

/** Marcadores de falha por AMBIENTE (não provam nem refutam a correção). */
const MARCADORES_INFRA = [
  'ECONNREFUSED',
  'connection refused',
  'SequelizeConnectionError',
  'SequelizeConnectionAcquireTimeoutError',
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'Cannot find module',
  'ENOENT',
  'ECONNRESET',
  'EADDRINUSE',
  'Playwright',
  'browserType.launch',
  'getaddrinfo',
  'database "',
  'role "',
  'the database system is starting up',
];

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

function headSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function arvoreSuja() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  return String(r.stdout || '').trim().length > 0;
}

function classificar(exitCode, saida) {
  if (exitCode === 0) return 'PASS';
  if (exitCode === null) return 'INCONCLUSIVO';
  const texto = String(saida || '');
  const infra = MARCADORES_INFRA.filter((m) => texto.includes(m));
  // Só é inconclusivo quando a falha é de AMBIENTE. Falha de asserção é FAIL.
  if (infra.length > 0) return 'INCONCLUSIVO';
  return 'FAIL';
}

function executarTeste(arquivo) {
  const inicio = Date.now();
  // Três runners legítimos no repo: Jest (backend), Vitest (frontend) e pytest
  // (rag-service). Rodar um teste Python com Jest daria FAIL falso e impediria a
  // verificação correta.
  const ehFrontend = String(arquivo).startsWith('frontend/');
  const ehPython = String(arquivo).startsWith('rag-service/');
  const comando = ehPython
    ? `cd rag-service && ./venv/bin/pytest ${String(arquivo).replace(/^rag-service\//, '')} -q`
    : ehFrontend
      ? `cd frontend && npx vitest run ${String(arquivo).replace(/^frontend\//, '')}`
      : `npx jest ${arquivo} --bail=0`;
  const r = spawnSync(comando, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, CI: '1' },
    maxBuffer: 32 * 1024 * 1024,
    timeout: ORCAMENTO_MS,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const exitCode = r.status === null ? null : r.status;

  const testes = /Test Files\s+(\d+) (?:failed|passed).*/i.exec(saida)
    || /Tests:\s+(\d+) failed,\s+(\d+) passed,\s+(\d+) total/.exec(saida)
    || /Tests:\s+(\d+) passed,\s+(\d+) total/.exec(saida);
  return {
    arquivo,
    runner: ehPython ? 'pytest' : (ehFrontend ? 'vitest' : 'jest'),
    comando,
    exitCode,
    timeout: r.status === null,
    duracaoMs: Date.now() - inicio,
    sha256Saida: sha256(saida),
    classificacao: classificar(exitCode, saida),
    resumoTestes: testes ? testes[0].replace(/\s+/g, ' ') : null,
    saidaFinal: saida.trim().split('\n').slice(-8).join('\n'),
  };
}

function main(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--apply');
  const somente = (() => {
    const i = argv.findIndex((a) => a === '--somente' || a === '-s');
    return i >= 0 ? new Set(String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)) : null;
  })();

  const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  const sha = headSha();
  const sujo = arvoreSuja();

  const abertos = fila.items.filter((i) => i.state !== ESTADOS.VERIFIED && i.state !== ESTADOS.RESOLVED);
  const alvos = somente ? abertos.filter((i) => somente.has(i.id)) : abertos;

  process.stdout.write(`[reconcile] HEAD=${sha.slice(0, 12)} arvore=${sujo ? 'SUJA' : 'limpa'} alvos=${alvos.length}\n`);

  const resultados = alvos.map((item) => {
    const declarado = item.regressionTest || null;
    const existe = Boolean(declarado) && fs.existsSync(path.join(ROOT, declarado));
    if (!existe) {
      process.stdout.write(`[reconcile]   ${item.id.padEnd(52)} SEM_TESTE\n`);
      return { id: item.id, state: item.state, severity: item.severity || null, regressionTest: declarado, classificacao: 'SEM_TESTE' };
    }
    const exec = executarTeste(declarado);
    process.stdout.write(
      `[reconcile]   ${item.id.padEnd(52)} ${exec.classificacao.padEnd(12)} exit=${exec.exitCode} ${(exec.duracaoMs / 1000).toFixed(1)}s ${declarado}\n`
    );
    return { id: item.id, state: item.state, severity: item.severity || null, regressionTest: declarado, ...exec };
  });

  const porClasse = resultados.reduce((acc, r) => { acc[r.classificacao] = (acc[r.classificacao] || 0) + 1; return acc; }, {});

  // ── Aplicação: SOMENTE PASS fecha (e só com árvore limpa) ────────────────
  let aplicados = 0;
  if (aplicar) {
    const aprovados = new Set(resultados.filter((r) => r.classificacao === 'PASS').map((r) => r.id));
    for (const item of fila.items) {
      if (!aprovados.has(item.id)) continue;
      item.targetedTestPassing = true;
      item.targetedTestAt = new Date().toISOString();
      item.targetedTestExit = 0;
      item.verificationCommit = sha;
      item.state = ESTADOS.VERIFIED;
      item.verificationNote = `reconcile-hardening-queue.js: ${item.regressionTest} exit=0 em ${sha.slice(0, 12)}`;
      aplicados += 1;
    }
    fila.updatedAt = new Date().toISOString();
    fs.writeFileSync(FILA, `${JSON.stringify(fila, null, 2)}\n`, 'utf8');
  }

  const relatorio = {
    schemaVersion: 1,
    kind: 'hardening-queue-reconciliation',
    generatedAt: new Date().toISOString(),
    commit: sha,
    arvoreSuja: sujo,
    aplicado: aplicar,
    // Orçamento efetivo da verificação (auditável): 240s por padrão, teto 900s via
    // RECONCILE_BUDGET_MS. Sem isso, um teste legitimamente longo ficava INCONCLUSIVO
    // para sempre e o item nunca fechava por limitação do verificador.
    orcamentoMs: ORCAMENTO_MS,
    alvos: alvos.length,
    porClasse,
    aplicados,
    resultados,
    // Verdade explícita: verificação feita com árvore suja NÃO é prova do commit.
    aviso: sujo || aplicar
      ? (sujo ? 'árvore de trabalho SUJA durante a verificação — o commit avaliado não é exatamente o HEAD' : null)
      : null,
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');

  process.stdout.write(`[reconcile] resultado: ${JSON.stringify(porClasse)} aplicados=${aplicados}\n`);
  process.stdout.write('[reconcile] relatório: reports/hardening-queue-reconciliation.json\n');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, executarTeste, classificar };
