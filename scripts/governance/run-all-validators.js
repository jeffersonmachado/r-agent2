#!/usr/bin/env node
'use strict';

/**
 * run-all-validators.js — executa TODOS os validadores do gate agregado e
 * produz um relatório único, sem esconder nenhuma falha.
 *
 * DEFEITO QUE MOTIVA (medido 2026-10-13): `validate:governance-enforcement` usa
 * `&&`; a primeira falha aborta o resto. O log mostrou "1 FAIL"
 * (`release-governance`) enquanto a execução isolada dos 60 validadores revelou
 * **10 falhas** de causas diferentes. Operar assim custa um ciclo de ~1h por
 * descoberta.
 *
 * Este script é ADITIVO: não altera nem substitui o agregado canônico (que segue
 * fail-fast, por decisão de custo). Ele lê a MESMA lista (`package.json`) e roda
 * tudo, preservando o veredito individual.
 *
 * Uso:
 *   node scripts/governance/run-all-validators.js                    # roda todos
 *   node scripts/governance/run-all-validators.js --only=a,b         # subset (testes)
 *   node scripts/governance/run-all-validators.js --timeout-seconds=900
 *
 * Saída: reports/governance-enforcement-full-report.json
 * Exit: 0 só se TODOS passarem (fail-closed).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  listarValidadores,
  resumirSaida,
  comporRelatorio,
  calcularExit,
  filtrarValidadores,
  deveRevalidarAposCarimbo,
} = require('./lib/governance-enforcement-plan');
const { resolveRunLineage, applyOriginLineage } = require('./lib/resolve-run-lineage');

const args = process.argv.slice(2);
const lerArg = (nome) => {
  const comValor = args.find((a) => a.startsWith(`--${nome}=`));
  return comValor ? comValor.slice(nome.length + 3) : null;
};
const ONLY = lerArg('only');
const TIMEOUT_MS = Number(lerArg('timeout-seconds') || 900) * 1000;
// Rodar validadores FORA do converge regrava artefatos autoritativos sem lineage
// (medido 2026-10-13: 6 deles passavam a acusar INVALID_AUTHORITATIVE_ARTIFACT no
// `validate:current-run-temporal-integrity`, que roda logo depois na mesma lista,
// e derrubava `validate:required-tests` por tabela). Carimbar ao final devolve a
// coerência ao run corrente; `--no-stamp` desliga (ex.: quando o próprio operador
// vai rodar o converge na sequência).
const STAMP = !args.includes('--no-stamp');

/** Devolve a coerência de lineage dos artefatos regravados pelo runner. */
function carimbarLineage() {
  const script = path.join(__dirname, 'stamp-report-lineage.js');
  if (!fs.existsSync(script)) {
    console.log('[all-validators] stamp-report-lineage.js ausente — lineage não carimbado');
    return null;
  }
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS });
  const saida = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const ultima = saida.split('\n').filter(Boolean).pop() || '';
  try {
    return { exitCode: r.status === null ? 1 : r.status, resumo: JSON.parse(ultima) };
  } catch (_) {
    return { exitCode: r.status === null ? 1 : r.status, resumo: null, saida: ultima.slice(0, 200) };
  }
}

/**
 * Revalida APENAS os validadores que falharam por causa de lineage ausente.
 *
 * Por que é necessário: o `stamp-report-lineage` roda no FIM, mas o
 * `validate:current-run-temporal-integrity` está no MEIO da lista. Os
 * validadores anteriores a ele regravam artefatos autoritativos sem `runId`, e
 * ele os acusa (`INVALID_AUTHORITATIVE_ARTIFACT`); `validate:required-tests`
 * consome o relatório dele e cai por tabela. Sem esta revalidação, o relatório
 * mostraria 6 falhas onde existem 4 causas (as do pacote).
 *
 * A revalidação é RESTRITA a essa causa (mensagem explícita ou o consumidor
 * declarado) e marcada no relatório (`revalidatedAfterStamp`), para que ninguém
 * confunda reexecução pós-carimbo com um verde obtido por afrouxamento.
 */
function revalidarAposCarimbo(resultados) {
  const revalidados = [];
  for (const r of resultados) {
    if (!deveRevalidarAposCarimbo(r)) continue;
    const inicio = Date.now();
    const res = spawnSync('npm', ['run', '--silent', r.name], {
      cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
    });
    const novoExit = res.status === null ? 1 : res.status;
    revalidados.push({ name: r.name, exitCodeAntes: r.exitCode, exitCodeDepois: novoExit });
    r.exitCodeBeforeStamp = r.exitCode;
    r.exitCode = novoExit;
    r.durationMs += Date.now() - inicio;
    r.revalidatedAfterStamp = true;
    r.summary = resumirSaida(`${res.stdout || ''}\n${res.stderr || ''}`);
    console.log(`  ↻ ${r.name} revalidado após carimbo: ${r.exitCodeBeforeStamp} -> ${novoExit}`);
  }
  return revalidados;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const todos = listarValidadores(pkg);
  const alvos = filtrarValidadores(todos, ONLY);

  console.log(`[all-validators] executando ${alvos.length} de ${todos.length} validador(es)`);
  const resultados = [];
  for (const name of alvos) {
    const inicio = Date.now();
    const r = spawnSync('npm', ['run', '--silent', name], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    const duracaoMs = Date.now() - inicio;
    const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
    // Timeout do spawnSync mata o processo: sem este ajuste o exit viria null e o
    // validador pareceria "não falhou" (falso verde por ausência de código).
    const exitCode = r.error && r.error.code === 'ETIMEDOUT' ? 124 : (r.status === null ? 1 : r.status);
    resultados.push({
      name,
      exitCode,
      durationMs: duracaoMs,
      summary: resumirSaida(saida),
      timedOut: exitCode === 124,
    });
    const marca = exitCode === 0 ? '✓' : '✗';
    console.log(`  ${marca} ${name} (exit=${exitCode}, ${(duracaoMs / 1000).toFixed(1)}s)`);
  }

  const relatorio = applyOriginLineage(
    comporRelatorio(resultados),
    resolveRunLineage(ROOT),
  );
  if (STAMP) {
    const stamp = carimbarLineage();
    if (stamp) {
      relatorio.lineageStamp = stamp;
      const detalhe = stamp.resumo ? `stamped=${stamp.resumo.stamped} rejectedStale=${stamp.resumo.rejectedStale}` : `exit=${stamp.exitCode}`;
      console.log(`[all-validators] lineage carimbado (${detalhe})`);
    }
  } else {
    relatorio.lineageStamp = { skipped: true, reason: '--no-stamp' };
    console.log('[all-validators] lineage NÃO carimbado (--no-stamp)');
  }
  // Depois do carimbo, revalida SÓ o que falhou por ausência de lineage e
  // recomputa o veredito (o relatório é gravado com a decisão final).
  if (STAMP && relatorio.lineageStamp && relatorio.lineageStamp.exitCode === 0) {
    const revalidados = revalidarAposCarimbo(resultados);
    relatorio.revalidatedAfterStamp = revalidados;
    const finais = comporRelatorio(resultados, { origem: relatorio.origem });
    relatorio.total = finais.total;
    relatorio.pass = finais.pass;
    relatorio.fail = finais.fail;
    relatorio.status = finais.status;
    relatorio.falhas = finais.falhas;
  }
  const destino = path.join(ROOT, 'reports', 'governance-enforcement-full-report.json');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, `${JSON.stringify(relatorio, null, 2)}\n`);

  console.log(`[all-validators] status=${relatorio.status} pass=${relatorio.pass} fail=${relatorio.fail}`);
  if (relatorio.fail > 0) {
    console.log(`[all-validators] FALHARAM: ${relatorio.falhas.join(', ')}`);
    for (const f of relatorio.results.filter((r) => r.exitCode !== 0)) {
      const motivo = (f.summary || [])[f.summary.length - 1] || '(sem saída)';
      console.log(`  ✗ ${f.name}: ${String(motivo).slice(0, 160)}`);
    }
  }
  console.log(`[all-validators] relatório: ${destino}`);
  return calcularExit(relatorio);
}

try {
  process.exit(main());
} catch (erro) {
  console.error(`[all-validators] ERRO: ${erro.message}`);
  process.exit(1);
}
