'use strict';

/**
 * L-1 (2026-10-20) — FECHAMENTO DE DEPENDÊNCIAS DO CONTAINER DO ENGINEERING RUNNER.
 *
 * DEFEITO MEDIDO (duas vezes, mesma classe): o `services/engineering-runner/Dockerfile` copia
 * arquivos à MÃO. Quando `api/services/engineeringRouter/executionSandbox.js` passou a fazer
 * `require('../../../governance/bug-closure/command-policy')`, o `COPY` correspondente não foi
 * adicionado — e o container real passou a responder
 *
 *   {"error":"Cannot find module '../../../governance/bug-closure/command-policy'","code":"MODULE_NOT_FOUND"}
 *
 * em TODA execução de sandbox. Reproduzido ao vivo em 2026-10-20
 * (`docker run … r-agent2-engineering-runner:sealfix002-e2e-test` + POST /execute). Rodando o
 * mesmo código como processo bare no host (Jest) o `require()` resolve contra o monorepo real e
 * MASCARA a ausência — por isso o defeito só aparece em container, e por isso ele voltou.
 *
 * Prevenção (não prosa): este teste calcula o FECHAMENTO TRANSITIVO de `require()` relativo a
 * partir das entradas reais do runner e exige que CADA arquivo alcançado esteja coberto por
 * algum `COPY` do Dockerfile. Adicionar um `require` relativo novo sem copiar o arquivo passa a
 * falhar em teste unitário, antes de virar container quebrado.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCKERFILE = path.join(REPO_ROOT, 'services', 'engineering-runner', 'Dockerfile');

const ENTRY_POINTS = [
  'services/engineering-runner/src/index.js',
  'services/engineering-runner/src/httpServer.js',
];

/** Builtins do Node e qualquer `node_modules` ficam fora do fechamento (imagem tem node base). */
const BUILTINS = new Set(require('module').builtinModules);

/**
 * Remove COMENTÁRIOS preservando strings e o comprimento relativo do texto.
 *
 * Por que um scanner e não regex: `api/utils/logger.js`/`api/utils/config.js` documentam o uso com
 * `const logger = require('./utils/logger');` dentro de bloco de comentário — sem remover comentário
 * o fechamento acusa dependências inexistentes (falso positivo medido). Por outro lado, heurística
 * de "último `/*` antes do índice" erra quando o arquivo contém marcador de comentário dentro de
 * string/comentário aninhado (medido em `services/engineering-runner/src/httpServer.js`, que tem 4
 * requires REAIS tratados como comentário). Scanner por estado resolve os dois casos.
 */
function stripComments(sourceText) {
  let out = '';
  let i = 0;
  const n = sourceText.length;
  while (i < n) {
    const ch = sourceText[i];
    const next = sourceText[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && sourceText[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(sourceText[i] === '*' && sourceText[i + 1] === '/')) { out += sourceText[i] === '\n' ? '\n' : ' '; i += 1; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = sourceText[i];
        if (c === '\\') { out += sourceText.slice(i, i + 2); i += 2; continue; }
        out += c;
        i += 1;
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Extrai os especificadores de `require('...')` REAIS (fora de comentário) de um arquivo.
 * @param {string} sourceText
 * @returns {string[]}
 */
function requireSpecifiers(sourceText) {
  const code = stripComments(sourceText);
  const found = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match = re.exec(code);
  while (match) {
    found.push(match[1]);
    match = re.exec(code);
  }
  return found;
}

/** Resolve um require relativo para um caminho REAL do repositório (arquivo ou diretório/index). */
function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null; // builtin, pacote npm ou caminho absoluto
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) { /* tenta o próximo */ }
  }
  return { missing: base };
}

/**
 * Fechamento transitivo a partir das entradas do runner.
 * @returns {{files:string[], unresolved:string[]}}
 */
function computeRequireClosure(entries) {
  const seen = new Set();
  const unresolved = [];
  const queue = entries.map((rel) => path.join(REPO_ROOT, rel));

  while (queue.length > 0) {
    const abs = queue.shift();
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!abs.endsWith('.js')) continue; // .json não tem require próprio

    const sourceText = fs.readFileSync(abs, 'utf8');
    for (const specifier of requireSpecifiers(sourceText)) {
      if (BUILTINS.has(specifier)) continue;
      if (specifier.startsWith('/')) continue; // caminho absoluto: não é do repositório
      const resolved = resolveRelative(abs, specifier);
      if (resolved === null) continue;
      if (typeof resolved === 'string') {
        queue.push(resolved);
      } else {
        unresolved.push({ from: rel, specifier });
      }
    }
  }

  return { files: [...seen].sort(), unresolved };
}

/**
 * Fontes de `COPY` do Dockerfile (apenas origem; destino é irrelevante para a checagem).
 * @returns {string[]}
 */
function dockerfileCopySources(dockerfileText) {
  const sources = [];
  for (const rawLine of dockerfileText.split('\n')) {
    const line = rawLine.trim();
    if (!/^COPY\s/i.test(line)) continue;
    // Ignora flags (--chown=…): o que importa são origem e destino.
    const parts = line.split(/\s+/).filter((token) => !token.startsWith('--')).slice(1);
    if (parts.length < 2) continue;
    sources.push(...parts.slice(0, -1).map((part) => part.replace(/^\.\//, '').replace(/\/$/, '')));
  }
  return sources;
}

/** Um arquivo está coberto se for a própria origem ou estiver dentro de uma origem-diretório. */
function isCovered(relFile, copySources) {
  return copySources.some((source) => relFile === source || relFile.startsWith(`${source}/`));
}

describe('Engineering Runner — o Dockerfile cobre TODO o fechamento de require do runner', () => {
  test('nenhum require relativo fica sem COPY (defeito do command-policy, 2026-10-20)', () => {
    const { files, unresolved } = computeRequireClosure(ENTRY_POINTS);

    // Require relativo que nem existe no repositório é erro de código, não de Dockerfile —
    // declarado para diagnóstico, nunca silenciado.
    expect(unresolved).toEqual([]);

    const copySources = dockerfileCopySources(fs.readFileSync(DOCKERFILE, 'utf8'));
    expect(copySources.length).toBeGreaterThan(0);

    const uncovered = files.filter((relFile) => !isCovered(relFile, copySources));

    expect(uncovered).toEqual([]);
  });

  test('o fechamento inclui a cadeia que quebrou o container (prova de que o teste olha o lugar certo)', () => {
    const { files } = computeRequireClosure(ENTRY_POINTS);

    // `executionSandbox` → `governance/bug-closure/command-policy` → `eligibility`/`defect-registry`
    // → `defect-states`; e `operationDeadline` → `engine/shared/executionDeadline` + `logger`.
    expect(files).toEqual(expect.arrayContaining([
      'api/services/engineeringRouter/executionSandbox.js',
      'governance/bug-closure/command-policy.js',
      'governance/bug-closure/eligibility.js',
      'governance/bug-closure/defect-registry.js',
      'governance/bug-closure/defect-states.js',
      'api/utils/operationDeadline.js',
      'engine/shared/executionDeadline.js',
      'config/timeout-policy.json',
    ]));
  });
});
