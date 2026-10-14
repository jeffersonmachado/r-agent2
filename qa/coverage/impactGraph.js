'use strict';

/**
 * Grafo de impacto por imports — MISSÃO A / L1.
 *
 * Módulo PURO (zero I/O, zero relógio, zero aleatório): recebe arquivos
 * `{ path, source }` já lidos e devolve o grafo e a seleção de testes afetados.
 *
 * Motivação medida (2026-10-14):
 *   - `qa/impact-map.json` cobre 28/2488 arquivos = 1,13% (vocabulário de 7
 *     escopos que quase nunca casa com os 26 escopos declarados nos cenários);
 *   - inventário (`config/system-inventory.json`, 3999 itens) só enxerga rotas:
 *     arquivo→jornada alcança 9,0% dos arquivos; `api/services` 1,5%, `api/db`
 *     0%, `engine/*` 0%;
 *   - o mapa de imports DIRETOS dos testes alcança 34,9%;
 *   - o FECHO TRANSITIVO reverso alcança **73,6%** dos arquivos de produção.
 *
 * O elo que faltava não era um orquestrador: eram os DADOS DE LIGAÇÃO. Este
 * módulo os deriva de forma determinística a partir do que os arquivos já
 * declaram (os próprios `require`/`import`).
 */

const path = require('path');

/** Extensões tentadas na resolução de um spec relativo, na ordem. */
const EXTENSOES = Object.freeze(['', '.js', '.jsx', '.mjs', '.cjs', '.json']);

/** Índices de entrada em um diretório. */
const INDICES = Object.freeze(['index.js', 'index.jsx', 'index.mjs']);

/** Profundidade máxima do fecho transitivo (proteção contra ciclos patológicos). */
const PROFUNDIDADE_MAXIMA = 25;

const TESTE_RE = /\.(test|spec)\.(js|jsx|mjs|cjs)$/;

/**
 * Um caminho é arquivo de teste?
 * @param {string} caminho
 * @returns {boolean}
 */
function isTestFile(caminho) {
  return TESTE_RE.test(String(caminho || ''));
}

/**
 * Extrai specs de import/require de um fonte.
 * Cobre `require('x')`, `import ... from 'x'`, `import('x')` e `export ... from 'x'`.
 * @param {string} source
 * @returns {string[]} specs (com duplicatas removidas, na ordem de aparição)
 */
function extractImportSpecs(source) {
  const specs = [];
  const vistos = new Set();
  const re = /(?:require\s*\(\s*|(?:^|[^\w$.])(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1];
    if (!spec || vistos.has(spec)) continue;
    vistos.add(spec);
    specs.push(spec);
  }
  return specs;
}

/**
 * Constrói o conjunto de candidatos absolutos para um spec relativo.
 * @param {string} deDir
 * @param {string} spec
 * @returns {string[]}
 */
function candidatosPara(deDir, spec) {
  // normaliza separadores POSIX (o repositório é validado em POSIX)
  const base = path.posix.normalize(path.posix.join(deDir, spec));
  const cands = EXTENSOES.map((e) => base + e);
  INDICES.forEach((i) => cands.push(path.posix.join(base, i)));
  return cands;
}

/**
 * Constrói o grafo de imports de um conjunto de arquivos.
 *
 * @param {object} input
 * @param {Array<{path: string, source: string}>} input.files arquivos com fonte
 * @param {(caminho: string) => boolean} [input.existe] predicado de existência
 *   (injetado para manter o módulo puro; default: o arquivo está no conjunto)
 * @returns {{nodes: string[], edges: Object<string, string[]>, reverse: Object<string, string[]>}}
 */
function buildImportGraph({ files = [], existe } = {}) {
  const porCaminho = new Map();
  for (const f of files) {
    if (!f || !f.path) continue;
    porCaminho.set(normalizar(f.path), f);
  }

  const existeFn =
    typeof existe === 'function'
      ? existe
      : (c) => porCaminho.has(c);

  const edges = {};
  const reverse = {};
  const nodes = [...porCaminho.keys()].sort();

  for (const [caminho, arquivo] of porCaminho) {
    const deps = new Set();
    for (const spec of extractImportSpecs(arquivo.source || '')) {
      if (!spec.startsWith('.')) continue; // só imports internos
      const deDir = path.posix.dirname(caminho);
      const alvo = candidatosPara(deDir, spec).find((c) => existeFn(c));
      if (alvo && alvo !== caminho) deps.add(alvo);
    }
    edges[caminho] = [...deps].sort();
    for (const d of deps) {
      if (!reverse[d]) reverse[d] = [];
      reverse[d].push(caminho);
    }
  }
  for (const k of Object.keys(reverse)) reverse[k].sort();

  return { nodes, edges, reverse };
}

/**
 * Normaliza um caminho para a forma canônica do grafo.
 * @param {string} p
 * @returns {string}
 */
function normalizar(p) {
  return path.posix.normalize(String(p || '').replace(/^\.\//, '').replace(/\\/g, '/'));
}

/**
 * Fecho transitivo reverso: quem depende (direta ou indiretamente) dos alvos.
 *
 * Implementação BFS por níveis, determinística (ordem de visita estável) e
 * limitada por `PROFUNDIDADE_MAXIMA` para não travar em ciclos.
 *
 * @param {object} input
 * @param {Object<string, string[]>} input.reverse grafo reverso
 * @param {string[]} input.targets caminhos alterados
 * @param {number} [input.profundidadeMaxima]
 * @returns {{dependents: string[], tests: string[], depth: number}}
 *   `dependents` é o impacto TOTAL (inclui os arquivos de teste, para auditoria e
 *   rastreabilidade); `tests` é o subconjunto executável. Os alvos nunca
 *   aparecem entre os dependentes, mesmo havendo ciclo.
 */
function collectDependents({ reverse = {}, targets = [], profundidadeMaxima = PROFUNDIDADE_MAXIMA } = {}) {
  const vistos = new Set(targets.map(normalizar));
  const testes = new Set();
  let nivel = [...vistos].sort();
  let profundidade = 0;

  while (nivel.length > 0 && profundidade < profundidadeMaxima) {
    const proximo = [];
    for (const no of nivel) {
      const dependentes = reverse[no] || [];
      for (const dep of dependentes) {
        if (vistos.has(dep)) continue;
        vistos.add(dep);
        if (isTestFile(dep)) testes.add(dep);
        else proximo.push(dep);
      }
    }
    nivel = proximo.sort();
    profundidade += 1;
  }

  const dependents = [...vistos].filter((n) => !targets.map(normalizar).includes(n)).sort();
  return { dependents, tests: [...testes].sort(), depth: profundidade };
}

module.exports = {
  EXTENSOES,
  INDICES,
  PROFUNDIDADE_MAXIMA,
  TESTE_RE,
  isTestFile,
  normalizar,
  extractImportSpecs,
  candidatosPara,
  buildImportGraph,
  collectDependents,
};
