'use strict';

/**
 * engine/engineeringRouter/testRemovalPolicy.js
 *
 * REGRA DE PRODUÇÃO: um patch de missão NÃO PODE APAGAR CASOS DE TESTE.
 *
 * DEFEITO MEDIDO (2026-10-20, terceira rodada de mutilação de worktree)
 * ---------------------------------------------------------------------
 * O padrão que reaparece é sempre o mesmo: para "fazer a suíte passar", o
 * agente remove o caso de teste em vez de corrigir o comportamento. Medição
 * real: 35 blocos `it/describe` apagados em 62 arquivos, com a suíte verde.
 * A única barreira existente (`INTEGRITY_CRITICAL_PATH_PATTERNS`, em
 * `patchValidator.js`) impede tocar o MAQUINÁRIO de verificação, mas não
 * impedia apagar o TESTE dentro de um arquivo de teste.
 *
 * REGRA
 * -----
 * Conta declarações de teste removidas e adicionadas por arquivo. Se um arquivo
 * perde mais casos do que ganha, o patch é recusado — fail-closed, sem tentar
 * adivinhar se a remoção "faz sentido". Autorização só por campo EXPLÍCITO de
 * contrato (`allowTestRemovalAuthorization === true`), definido por política
 * aprovada por humano, nunca inferido.
 *
 * Módulo PURO: recebe texto de diff, devolve dados. Sem I/O.
 */

const TEST_DECLARATION_RE = /^\s*(?:it|test|describe)(?:\.(?:only|skip|each|concurrent))?\s*\(/;

/**
 * @param {string} diffText unified diff
 * @returns {Array<{path:string, removedTests:number, addedTests:number}>}
 *   Apenas arquivos que PERDEM casos de teste (removedTests > addedTests).
 */
function findRemovedTestCases(diffText) {
  const text = String(diffText || '');
  if (!text.trim()) return [];

  const perFile = new Map();
  let currentPath = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = match ? (match[2] || match[1]) : null;
      if (currentPath && !perFile.has(currentPath)) {
        perFile.set(currentPath, { path: currentPath, removedTests: 0, addedTests: 0 });
      }
      continue;
    }
    if (!currentPath) continue;
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;

    const entry = perFile.get(currentPath);
    if (line.startsWith('-')) {
      if (TEST_DECLARATION_RE.test(line.slice(1))) entry.removedTests += 1;
      continue;
    }
    if (line.startsWith('+')) {
      if (TEST_DECLARATION_RE.test(line.slice(1))) entry.addedTests += 1;
    }
  }

  return [...perFile.values()].filter((entry) => entry.removedTests > entry.addedTests);
}

module.exports = { findRemovedTestCases, TEST_DECLARATION_RE };
