'use strict';

/**
 * governance/worktree-integrity.js
 *
 * GUARDA DE INTEGRIDADE DO WORKTREE — prevenção da MUTILAÇÃO RECORRENTE.
 *
 * DEFEITO MEDIDO (3 rodadas: 2026-10-09 x2, 2026-10-20)
 * ------------------------------------------------------
 * O worktree aparecia com dezenas de arquivos `M` cujo conteúdo era uma cópia
 * DEGRADADA de HEAD: guardas de governança apagadas, funções reimplementadas de
 * forma simplificada e — o sinal mais grave — CASOS DE TESTE REMOVIDOS. O
 * resultado engana duas vezes:
 *
 *   1. a suíte fica VERDE (o teste que reprovaria a deleção foi apagado);
 *   2. o diff agregado esconde a perda (o arquivo continua "modificado", não
 *      "quebrado").
 *
 * Medição de 2026-10-20: 62 arquivos, 856 inserções contra 5.565 deleções e 35
 * blocos `it/describe` removidos. `platform-readiness.js` perdeu
 * `loadChildGateViolations`; `engineeringRouterService.js` perdeu 721 linhas;
 * `waiverService.test.js` caiu de 25 para 12 testes.
 *
 * POR QUE UMA GUARDA NOVA
 * -----------------------
 * Os gates existentes julgam o PRODUTO (testes, relatórios, release). Nenhum
 * julgava a RELAÇÃO entre o worktree e a base: um worktree que apaga a prova
 * passa em todos eles. Esta guarda é sobre essa relação, e é determinística —
 * compara o diff real contra a base, sem heurística de intenção.
 *
 * CONTRATO
 * --------
 * `evaluateWorktree({ cwd, baseRef })` devolve:
 *   { verdict, violations, waived, files, totals, baseRef, headSha }
 *
 * Violações (todas fail-closed):
 *   - TEST_CASE_REMOVAL      arquivo perde casos de teste (`it`/`test`/`describe`)
 *   - SYMBOL_REMOVAL         função/const declarada some do arquivo
 *   - PURE_DELETION          deleção sem NENHUMA adição em caminho protegido
 *   - FILE_DELETED           arquivo protegido apagado
 *   - DELETION_DOMINANT      deleções ≥ 100 e adições ≤ 20% (qualquer código)
 *
 * WAIVER: explícito, por caminho, com motivo escrito. Não existe variável de
 * ambiente que desligue a guarda inteira — waiver é auditável no relatório.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIN_PURE_DELETION_LINES = 20;
const MIN_DOMINANT_DELETION_LINES = 100;
const DOMINANT_ADDITION_RATIO = 0.2;

/** Caminhos cuja perda é SEMPRE suspeita: é o maquinário que prova o GREEN. */
const PROTECTED_PATTERNS = Object.freeze([
  /^governance\//,
  /^scripts\/governance\//,
  /^tests\//,
  /^tools\/system\//,
  /^pipeline\//,
  /^\.github\//,
  /^engine\/engineeringRouter\//,
  /^engine\/engineeringMission\//,
  /^api\/services\/engineeringRouter\//,
  /^api\/services\/engineeringMission\//,
]);

const PROTECTED_FILES = Object.freeze([
  'jest.config.cjs',
  'config/engineering-router-v2-required-tests.json',
  'config/canonical-release-suites.json',
]);

const TEST_DECLARATION_RE = /^\s*(?:it|test|describe)(?:\.(?:only|skip|each|concurrent))?\s*\(/;
// Só declarações de ESCOPO DE MÓDULO (sem indentação): variáveis locais removidas
// são consequência normal de refactor e gerariam ruído que destrói a confiança
// na guarda. O sinal que importa é capacidade EXPORTADA/declarada que desaparece.
const FUNCTION_DECLARATION_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const BOUND_CONST_DECLARATION_RE = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/;

function isProtected(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  if (PROTECTED_FILES.includes(normalized)) return true;
  return PROTECTED_PATTERNS.some((re) => re.test(normalized));
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Lê o diff bruto contra a base (vazio = worktree idêntico à base). */
function collectDiff({ cwd, baseRef = 'HEAD' }) {
  return git(cwd, ['diff', '-U0', '--no-color', baseRef, '--']);
}

/**
 * Interpreta o diff em estruturas por arquivo. Não usa biblioteca de patch: só
 * precisa separar cabeçalho, linhas removidas e linhas adicionadas.
 */
function parseDiff(rawDiff) {
  const files = new Map();
  let current = null;

  for (const line of String(rawDiff || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const from = match ? match[1] : null;
      const to = match ? match[2] : null;
      current = {
        path: to || from,
        from,
        to,
        deleted: false,
        added: 0,
        removed: 0,
        removedTests: 0,
        addedTests: 0,
        removedSymbols: [],
      };
      files.set(current.path, current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('deleted file mode')) {
      current.deleted = true;
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;

    if (line.startsWith('-')) {
      current.removed += 1;
      const body = line.slice(1);
      if (TEST_DECLARATION_RE.test(body)) current.removedTests += 1;
      const fn = body.match(FUNCTION_DECLARATION_RE);
      if (fn) current.removedSymbols.push(fn[1]);
      const bound = body.match(BOUND_CONST_DECLARATION_RE);
      if (bound) current.removedSymbols.push(bound[1]);
      continue;
    }
    if (line.startsWith('+')) {
      current.added += 1;
      if (TEST_DECLARATION_RE.test(line.slice(1))) current.addedTests += 1;
    }
  }

  return [...files.values()];
}

function readCurrentFile(cwd, relPath) {
  try {
    return fs.readFileSync(path.join(cwd, relPath), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Avalia o worktree. `waiver` é uma lista de `{ path, reason }` — cada waiver
 * precisa de motivo não vazio; waiver sem motivo é ignorado (fail-closed).
 */
function evaluateWorktree({ cwd = process.cwd(), baseRef = 'HEAD', waiver = [] } = {}) {
  const activeWaivers = (Array.isArray(waiver) ? waiver : []).filter(
    (w) => w && typeof w.path === 'string' && typeof w.reason === 'string' && w.reason.trim().length >= 10,
  );
  const waivedPaths = new Set(activeWaivers.map((w) => w.path.replace(/\\/g, '/')));

  const headSha = (() => {
    try { return git(cwd, ['rev-parse', baseRef]).trim(); } catch { return null; }
  })();

  const rawDiff = collectDiff({ cwd, baseRef });
  const files = parseDiff(rawDiff);
  const violations = [];
  const waived = [];

  const push = (violation) => {
    if (waivedPaths.has(violation.path)) {
      waived.push({ ...violation, waiverReason: activeWaivers.find((w) => w.path.replace(/\\/g, '/') === violation.path).reason });
      return;
    }
    violations.push(violation);
  };

  for (const file of files) {
    const protectedPath = isProtected(file.path);

    if (file.deleted) {
      if (protectedPath) {
        push({
          code: 'FILE_DELETED',
          path: file.path,
          detail: 'arquivo protegido apagado — a prova de governança/teste não pode desaparecer por deleção',
        });
      }
      continue;
    }

    if (file.removedTests > file.addedTests) {
      push({
        code: 'TEST_CASE_REMOVAL',
        path: file.path,
        detail: `casos de teste removidos: ${file.removedTests} removidos x ${file.addedTests} adicionados`,
        removedTests: file.removedTests,
        addedTests: file.addedTests,
      });
    }

    if (file.removedSymbols.length > 0) {
      const content = readCurrentFile(cwd, file.path);
      if (content !== null) {
        const lost = [...new Set(file.removedSymbols)].filter(
          (name) => !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(content),
        );
        if (lost.length > 0) {
          push({
            code: 'SYMBOL_REMOVAL',
            path: file.path,
            detail: `símbolo(s) declarado(s) na base e ausente(s) agora: ${lost.join(', ')}`,
            symbols: lost,
          });
        }
      }
    }

    if (protectedPath && file.added === 0 && file.removed >= MIN_PURE_DELETION_LINES) {
      push({
        code: 'PURE_DELETION',
        path: file.path,
        detail: `deleção pura em caminho protegido: ${file.removed} linhas removidas, nenhuma adicionada`,
        removed: file.removed,
      });
    }

    if (file.removed >= MIN_DOMINANT_DELETION_LINES && file.added <= file.removed * DOMINANT_ADDITION_RATIO) {
      push({
        code: 'DELETION_DOMINANT',
        path: file.path,
        detail: `diff dominado por deleção: ${file.removed} removidas x ${file.added} adicionadas (${Math.round((file.added / file.removed) * 100)}%)`,
        removed: file.removed,
        added: file.added,
      });
    }
  }

  const totals = files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  );

  return {
    verdict: violations.length === 0 ? 'PASS' : 'FAIL',
    baseRef,
    headSha,
    filesChanged: files.length,
    totals,
    violations,
    waived,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  evaluateWorktree,
  parseDiff,
  isProtected,
  PROTECTED_PATTERNS,
  PROTECTED_FILES,
  MIN_PURE_DELETION_LINES,
  MIN_DOMINANT_DELETION_LINES,
};
