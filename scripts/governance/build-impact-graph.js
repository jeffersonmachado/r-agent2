'use strict';

/**
 * Produtor do grafo de impacto (MISSÃO A / L1).
 *
 * Lê o código versionado, constrói o grafo de imports e persiste o artefato
 * consumido pela seleção de validação. Determinístico: a mesma árvore produz o
 * mesmo artefato (os caminhos são ordenados e não há relógio no conteúdo).
 *
 * O artefato vive em `reports/` de propósito: `reports/` está FORA de
 * SOURCE_ROOTS, então regenerá-lo não invalida o release entregue.
 *
 * Uso: node scripts/governance/build-impact-graph.js [--check] [--out <caminho>]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildImportGraph, isTestFile, normalizar } = require('../../qa/coverage/impactGraph');

const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA_PADRAO = path.join(RAIZ, 'reports', 'impact-graph.json');
const EXT_RE = /\.(js|jsx|mjs|cjs)$/;
const TAMANHO_MAX_FONTE = 2 * 1024 * 1024; // ignora fontes patológicas

/**
 * Lista os arquivos versionados relevantes.
 * @returns {string[]}
 */
function listarArquivos() {
  const saida = execFileSync(
    'git',
    ['ls-files', 'api', 'engine', 'frontend/src', 'tests', 'qa', 'scripts', 'governance', 'lib', 'core', 'pipeline', 'tools'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  return saida
    .trim()
    .split('\n')
    .filter((f) => f && EXT_RE.test(f))
    .map(normalizar)
    .sort();
}

/**
 * Lê os arquivos e monta o insumo do grafo.
 * @param {string[]} caminhos
 * @returns {Array<{path: string, source: string}>}
 */
function lerFontes(caminhos) {
  const arquivos = [];
  for (const rel of caminhos) {
    const abs = path.join(RAIZ, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > TAMANHO_MAX_FONTE) continue;
    try {
      arquivos.push({ path: rel, source: fs.readFileSync(abs, 'utf8') });
    } catch {
      /* arquivo ilegível: fica fora do grafo e vira fail-closed na seleção */
    }
  }
  return arquivos;
}

/**
 * Constrói o artefato serializável.
 * @returns {object}
 */
function construir() {
  const caminhos = listarArquivos();
  const arquivos = lerFontes(caminhos);
  const grafo = buildImportGraph({ files: arquivos });

  const testeFiles = grafo.nodes.filter(isTestFile);
  const producao = grafo.nodes.filter((n) => !isTestFile(n));
  const alcancamAlgo = producao.filter((p) => (grafo.reverse[p] || []).length > 0);

  return {
    schemaVersion: 1,
    kind: 'impact-graph',
    // Sem `generatedAt`: o artefato é função pura da árvore versionada, o que
    // permite comparação byte-a-byte em `--check`.
    counts: {
      nodes: grafo.nodes.length,
      edges: Object.values(grafo.edges).reduce((s, l) => s + l.length, 0),
      productionFiles: producao.length,
      testFiles: testeFiles.length,
      productionFilesWithDependents: alcancamAlgo.length,
    },
    reverse: grafo.reverse,
    edges: grafo.edges,
  };
}

/**
 * Executa o produtor.
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const iOut = argv.indexOf('--out');
  const destino = iOut >= 0 && argv[iOut + 1] ? path.resolve(argv[iOut + 1]) : SAIDA_PADRAO;

  const artefato = construir();
  const conteudo = JSON.stringify(artefato, null, 1);
  const c = artefato.counts;
  const pct = ((c.productionFilesWithDependents / (c.productionFiles || 1)) * 100).toFixed(1);

  process.stdout.write(
    `[impact-graph] nós=${c.nodes} arestas=${c.edges} produção=${c.productionFiles} testes=${c.testFiles}\n` +
      `[impact-graph] arquivos de produção com dependentes: ${c.productionFilesWithDependents} (${pct}%)\n`
  );

  if (check) {
    const existente = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : null;
    if (existente === null) {
      process.stderr.write(`[impact-graph] FALHA: artefato ausente em ${destino}\n`);
      return 1;
    }
    if (existente !== conteudo) {
      process.stderr.write('[impact-graph] FALHA: artefato desatualizado (rode sem --check para regenerar)\n');
      return 1;
    }
    process.stdout.write('[impact-graph] artefato atualizado\n');
    return 0;
  }

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, 'utf8');
  process.stdout.write(`[impact-graph] escrito em ${path.relative(RAIZ, destino)} (${(conteudo.length / 1024).toFixed(0)} kB)\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { construir, listarArquivos, lerFontes, main, SAIDA_PADRAO };
