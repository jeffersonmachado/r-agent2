#!/usr/bin/env node
'use strict';

/**
 * branch-inventory.js — inventário AUDITÁVEL das branches locais.
 *
 * Por que existe
 * --------------
 * Medição de 2026-10-16: 2496 branches locais (2468 da família `engineering/missions/<uuid>`
 * criadas pelo loop autônomo do Engineering Router), 2112 já contidas em `origin/main`. Sem um
 * inventário derivado do estado real, a decisão de podar vira chute — e um auditor externo que
 * abre o repositório vê milhares de branches sem saber o que são.
 *
 * O relatório NÃO apaga nada: ele classifica e imprime os comandos (dry-run) para o dono decidir.
 *
 * Uso:
 *   node tools/audit/branch-inventory.js [--out <caminho.md>]
 *
 * Posição: `tools/audit/` — fora de SOURCE_ROOTS, não altera o sourceFingerprint.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_SANDBOX = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

/** Família = dois primeiros segmentos do nome (`a/b/resto` -> `a/b`), ou o nome inteiro. */
function familiaDe(branch) {
  const partes = String(branch).split('/');
  return partes.length > 1 ? `${partes[0]}/${partes[1]}` : partes[0];
}

/**
 * Classifica o trabalho de uma branch não-mergeada a partir dos arquivos que ela toca.
 * `sandbox_only` = tudo que ela muda é o fixture descartável do loop autônomo.
 */
function classificar(arquivos, fixture = FIXTURE_SANDBOX) {
  const lista = arquivos.filter(Boolean);
  if (lista.length === 0) return 'sem_arquivos';
  const fora = lista.filter((a) => a !== fixture);
  return fora.length === 0 ? 'sandbox_only' : 'toca_outros';
}

function montarRelatorio({ geradoEm, branchAtual, totalBranches, familias, mergeadas, naoMergeadas }) {
  const linhas = [];
  linhas.push('# Branch inventory (inventário auditável)');
  linhas.push('');
  linhas.push('> Artefato DERIVADO do estado real do git. Nada foi apagado. Gerado por');
  linhas.push('> `tools/audit/branch-inventory.js`.');
  linhas.push('');
  linhas.push(`- **Gerado em**: ${geradoEm}`);
  linhas.push(`- **Branch atual**: \`${branchAtual}\``);
  linhas.push(`- **Branches locais**: ${totalBranches}`);
  linhas.push(`- **Já contidas em \`origin/main\`** (podáveis com segurança): ${mergeadas.length}`);
  linhas.push(`- **Não contidas em \`origin/main\`** (exigem decisão): ${naoMergeadas.length}`);
  linhas.push('');
  linhas.push('## Famílias');
  linhas.push('');
  linhas.push('| família | branches | mergeadas | não mergeadas |');
  linhas.push('|---|---|---|---|');
  for (const f of familias) {
    linhas.push(`| \`${f.nome}\` | ${f.total} | ${f.mergeadas} | ${f.naoMergeadas} |`);
  }
  linhas.push('');
  linhas.push('## Branches mergeadas — comando sugerido (dry-run)');
  linhas.push('');
  linhas.push('`-d` (não `-D`): o próprio git recusa apagar branch não mergeada. Rode primeiro em modo lista:');
  linhas.push('');
  linhas.push('```bash');
  linhas.push("git branch --merged origin/main --format='%(refname:short)' | grep -v '^*' | head -20");
  linhas.push('```');
  linhas.push('');
  linhas.push('## Branches NÃO mergeadas — classificação pelo que elas tocam');
  linhas.push('');
  const soSandbox = naoMergeadas.filter((b) => b.classe === 'sandbox_only');
  const outros = naoMergeadas.filter((b) => b.classe === 'toca_outros');
  const semArquivos = naoMergeadas.filter((b) => b.classe === 'sem_arquivos');
  linhas.push(`- **Só o fixture sandbox** (\`${FIXTURE_SANDBOX}\` — artefato descartável do loop autônomo): ${soSandbox.length}`);
  linhas.push(`- **Tocam outros arquivos** (histórico de missões; revisar antes de descartar): ${outros.length}`);
  linhas.push(`- **Sem arquivos** (branch vazia em relação a \`origin/main\`): ${semArquivos.length}`);
  linhas.push('');
  if (outros.length > 0) {
    linhas.push('### Tocam outros arquivos');
    linhas.push('');
    linhas.push('| branch | commits à frente | arquivos fora do fixture (até 4) |');
    linhas.push('|---|---|---|');
    for (const b of outros.slice(0, 60)) {
      linhas.push(`| \`${b.nome}\` | ${b.commits} | ${b.arquivosFora.slice(0, 4).map((a) => `\`${a}\``).join(', ')} |`);
    }
    if (outros.length > 60) linhas.push(`| … | | (+${outros.length - 60} branches) |`);
    linhas.push('');
  }
  linhas.push('## Política');
  linhas.push('');
  linhas.push('- Nada é apagado por este script nem por automação: poda é decisão explícita do dono.');
  linhas.push('- Nunca `-D` em branch não mergeada sem antes confirmar que o conteúdo já está em `main`.');
  linhas.push('');
  return linhas.join('\n');
}

function main() {
  const branchAtual = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'DESCONHECIDA';
  const todas = (git(['branch', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const mergeadasSet = new Set((git(['branch', '--merged', 'origin/main', '--format=%(refname:short)']) || '').split('\n').filter(Boolean));

  const famMap = new Map();
  for (const b of todas) {
    const nome = familiaDe(b);
    const f = famMap.get(nome) || { nome, total: 0, mergeadas: 0, naoMergeadas: 0 };
    f.total += 1;
    if (mergeadasSet.has(b)) f.mergeadas += 1;
    else f.naoMergeadas += 1;
    famMap.set(nome, f);
  }
  const familias = [...famMap.values()].sort((a, b) => b.total - a.total);

  const mergeadas = todas.filter((b) => mergeadasSet.has(b));
  const naoMergeadas = [];
  for (const b of todas) {
    if (mergeadasSet.has(b)) continue;
    const commits = Number(git(['rev-list', '--count', `origin/main..${b}`]) || 0);
    const arquivos = (git(['log', '--format=', '--name-only', `origin/main..${b}`]) || '').split('\n').filter(Boolean);
    const unicos = [...new Set(arquivos)];
    naoMergeadas.push({
      nome: b,
      commits,
      classe: classificar(unicos),
      arquivosFora: unicos.filter((a) => a !== FIXTURE_SANDBOX),
    });
  }

  const relatorio = montarRelatorio({
    geradoEm: new Date().toISOString(),
    branchAtual,
    totalBranches: todas.length,
    familias,
    mergeadas,
    naoMergeadas,
  });

  const data = new Date().toISOString().slice(0, 10);
  const destino = path.resolve(ROOT, arg('out', `AI_MEMORY/evidence/branch-inventory-${data}.md`));
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, relatorio);

  console.log(`[branch-inventory] locais=${todas.length} mergeadas=${mergeadas.length} naoMergeadas=${naoMergeadas.length}`);
  console.log(`[branch-inventory] familias=${familias.length} (top: ${familias.slice(0, 3).map((f) => `${f.nome}=${f.total}`).join(', ')})`);
  console.log(`[branch-inventory] escrito: ${path.relative(ROOT, destino)}`);
  console.log('[branch-inventory] nada foi apagado');
}

module.exports = { familiaDe, classificar, montarRelatorio, FIXTURE_SANDBOX };

if (require.main === module) main();
