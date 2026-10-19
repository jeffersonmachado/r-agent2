#!/usr/bin/env node
'use strict';

/**
 * checkpoint.js — grava um CHECKPOINT auditável de desenvolvimento.
 *
 * Por que existe
 * --------------
 * A auditoria incremental (externa, ex.: GPT-6) precisa que cada commit responda,
 * sem arqueologia: qual era a base, o que mudou, quais testes rodaram, com que
 * resultado, e qual problema foi corrigido. Este gravador DERIVA tudo do estado
 * real (git + execução dos testes) e **recusa-se a escrever quando qualquer teste
 * falha** — é impossível registrar um checkpoint verde a partir de testes vermelhos.
 *
 * Garantias (implementadas, não narradas):
 *   - nunca roda em `main`/`master` (o desenvolvimento acontece em branch de dev);
 *   - recusa `--tests` vazio (checkpoint sem teste não é checkpoint);
 *   - falha ANTES de escrever se qualquer teste sair != 0 (fail-closed);
 *   - registra comando, exit code, duração e sha256 da saída de cada teste;
 *   - `id` do checkpoint = sha256 determinístico do conteúdo registrado, para
 *     conferência independente pelo auditor.
 *
 * Uso:
 *   node tools/audit/checkpoint.js \
 *     --title "audit: gravador de checkpoint" \
 *     --problem "nao havia registro verificavel por commit" \
 *     --tests "npx jest tests/unit/audit/checkpointTool.test.js"
 *
 * Posição: `tools/audit/` — fora de SOURCE_ROOTS, não altera o sourceFingerprint.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DESTINO = path.join(ROOT, 'AI_MEMORY/evidence/checkpoints.md');
const BRANCHES_PROIBIDAS = new Set(['main', 'master']);

const CABECALHO = `# Checkpoints de desenvolvimento (auditoria incremental)

Registro versionado, um item por commit de desenvolvimento. Cada item traz: branch, SHA de
base, arquivos modificados, testes EXECUTADOS com exit code e hash da saída, e o problema
corrigido. Gerado por \`tools/audit/checkpoint.js\` — nada escrito à mão.

O commit que carrega um checkpoint é sempre:

\`\`\`bash
git log -1 --format=%H -- AI_MEMORY/evidence/checkpoints.md
\`\`\`

O \`id\` de cada item é o sha256 do bloco registrado (base + arquivos + testes + problema),
portanto o auditor pode recalculá-lo sem confiar neste arquivo.

---

`;

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function argsTodos(nome) {
  const out = [];
  for (let i = 0; i < process.argv.length - 1; i += 1) {
    if (process.argv[i] === `--${nome}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

/** Roda um comando de teste e devolve resultado derivado (nunca inventado). */
function rodarTeste(comando) {
  const inicio = Date.now();
  const r = spawnSync(comando, { cwd: ROOT, encoding: 'utf8', shell: true, env: process.env });
  const duracaoMs = Date.now() - inicio;
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const linhas = saida.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return {
    comando,
    exitCode: typeof r.status === 'number' ? r.status : null,
    sinal: r.signal || null,
    duracaoMs,
    sha256Saida: crypto.createHash('sha256').update(saida).digest('hex'),
    ultimasLinhas: linhas.slice(-12),
  };
}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function montarItem({ titulo, problema, notas, baseSha, branch, arquivos, testes, quando }) {
  const blocoId = [
    `title=${titulo}`,
    `problem=${problema || ''}`,
    `baseSha=${baseSha}`,
    `branch=${branch}`,
    ...arquivos.map((a) => `file=${a}`),
    ...testes.map((t) => `test=${t.comando}|exit=${t.exitCode}|sha=${t.sha256Saida}`),
  ].join('\n');

  const linhas = [];
  linhas.push(`## CKPT ${sha256(blocoId).slice(0, 12)} — ${titulo}`);
  linhas.push('');
  linhas.push(`- **Quando**: ${quando}`);
  linhas.push(`- **Branch**: \`${branch}\``);
  linhas.push(`- **SHA de base** (HEAD antes deste commit): \`${baseSha}\``);
  linhas.push(`- **id** (sha256 do conteúdo do checkpoint): \`${sha256(blocoId)}\``);
  linhas.push('');
  linhas.push(`**Problema corrigido:** ${problema || '(não declarado)'}`);
  linhas.push('');
  if (notas) {
    linhas.push(`**Notas:** ${notas}`);
    linhas.push('');
  }
  linhas.push('**Arquivos modificados (estado no momento do checkpoint):**');
  linhas.push('');
  if (arquivos.length === 0) {
    linhas.push('- (nenhum — worktree limpo)');
  } else {
    for (const a of arquivos) linhas.push(`- \`${a}\``);
  }
  linhas.push('');
  linhas.push('**Testes executados (saída real, exit code real):**');
  linhas.push('');
  linhas.push('| comando | exit | duração | sha256 da saída (12) |');
  linhas.push('|---|---|---|---|');
  for (const t of testes) {
    linhas.push(`| \`${t.comando}\` | ${t.exitCode}${t.sinal ? ` (${t.sinal})` : ''} | ${(t.duracaoMs / 1000).toFixed(1)} s | ${t.sha256Saida.slice(0, 12)} |`);
  }
  linhas.push('');
  for (const t of testes) {
    linhas.push(`<details><summary>últimas linhas — <code>${t.comando}</code></summary>`);
    linhas.push('');
    linhas.push('```');
    for (const l of t.ultimasLinhas) linhas.push(l);
    linhas.push('```');
    linhas.push('');
    linhas.push('</details>');
    linhas.push('');
  }
  linhas.push('---');
  linhas.push('');
  return linhas.join('\n');
}

function main() {
  const titulo = arg('title');
  const problema = arg('problem');
  const notas = arg('note');
  const testesCmd = argsTodos('tests');

  if (!titulo) {
    console.error('erro: --title é obrigatório');
    process.exit(2);
  }
  if (testesCmd.length === 0) {
    console.error('erro: informe ao menos um --tests "<comando>" — checkpoint sem teste não é checkpoint');
    process.exit(2);
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) {
    console.error('erro: não foi possível ler a branch atual');
    process.exit(2);
  }
  if (BRANCHES_PROIBIDAS.has(branch)) {
    console.error(`erro: checkpoint não roda em \`${branch}\` — use uma branch de desenvolvimento`);
    process.exit(2);
  }

  const baseSha = git(['rev-parse', 'HEAD']);
  const quando = new Date().toISOString();
  const arquivos = (git(['status', '--porcelain']) || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^..\s+/, ''));

  console.log(`[checkpoint] branch=${branch} base=${baseSha}`);
  console.log(`[checkpoint] arquivos no estado atual: ${arquivos.length}`);
  console.log(`[checkpoint] executando ${testesCmd.length} comando(s) de teste...`);

  const testes = [];
  let falhas = 0;
  for (const cmd of testesCmd) {
    process.stdout.write(`[checkpoint]   -> ${cmd} ... `);
    const t = rodarTeste(cmd);
    testes.push(t);
    const ok = t.exitCode === 0;
    if (!ok) falhas += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} (exit ${t.exitCode}, ${(t.duracaoMs / 1000).toFixed(1)} s)`);
  }

  if (falhas > 0) {
    console.error('');
    console.error(`[checkpoint] RECUSADO: ${falhas} de ${testes.length} teste(s) falharam.`);
    for (const t of testes.filter((x) => x.exitCode !== 0)) {
      console.error(`  - ${t.comando} (exit ${t.exitCode})`);
      for (const l of t.ultimasLinhas.slice(-8)) console.error(`      ${l}`);
    }
    console.error('[checkpoint] Nada foi escrito — nenhum checkpoint verde pode nascer de teste vermelho.');
    process.exit(1);
  }

  const item = montarItem({ titulo, problema, notas, baseSha, branch, arquivos, testes, quando });
  const conteudoAtual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : CABECALHO;
  fs.writeFileSync(DESTINO, conteudoAtual + item);

  const registro = /## CKPT (\S+) —/.exec(item);
  console.log('');
  console.log('[checkpoint] ESCRITO (todos os testes PASS)');
  console.log(`[checkpoint] id=${registro ? registro[1] : '?'} arquivo=${path.relative(ROOT, DESTINO)}`);
  console.log('[checkpoint] commit deste checkpoint: git log -1 --format=%H -- AI_MEMORY/evidence/checkpoints.md');
}

module.exports = { rodarTeste, montarItem, sha256, BRANCHES_PROIBIDAS };

if (require.main === module) main();
