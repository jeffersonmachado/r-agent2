'use strict';

/**
 * engine/engineeringRouter/commandPolicy.js
 *
 * O modelo NÃO recebe liberdade irrestrita de shell. Todo comando executado pelo Test Runner
 * (declarado no Task Contract, nunca inventado livremente pelo LLM em runtime) passa por esta
 * policy: allowlist positiva de prefixo + blocklist de padrões perigosos (defesa em profundidade
 * — mesmo um prefixo permitido é rejeitado se a string completa contiver um padrão perigoso via
 * encadeamento de shell).
 *
 * Módulo puro (sem I/O, não executa nada).
 */

const { FAILURE_CODES } = require('./constants');

const DEFAULT_ALLOWED_PREFIXES = Object.freeze([
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run build',
  'npx jest',
  'jest ',
  'jest',
  'node scripts/',
  'node tests/',
  'git diff',
  'git status',
  'git apply --check',
]);

const DANGEROUS_PATTERNS = Object.freeze([
  /rm\s+-rf/i,
  /:\(\)\s*\{[^}]*\}\s*;/, // fork bomb
  /curl[^\n]*\|\s*sh/i,
  /wget[^\n]*\|\s*sh/i,
  /git\s+push/i,
  /git\s+merge/i,
  /git\s+reset\s+--hard/i,
  /npm\s+publish/i,
  /docker\s+push/i,
  /docker\s+system\s+prune/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /chmod\s+-R\s+777/i,
  />\s*\/dev\/sd/i,
  /\bdd\s+if=/i,
  /&&\s*rm\b/i,
  /;\s*rm\b/i,
  /\|\|\s*rm\b/i,
  /\bcredential/i,
  /\benv\s*\|/i, // dump de ambiente
  /\bprintenv\b/i,
]);

/**
 * @param {string} command
 * @param {{allowedPrefixes?: string[]}} [options]
 * @returns {{allowed:boolean, code?:string, reason?:string}}
 */
function checkCommand(command, { allowedPrefixes = DEFAULT_ALLOWED_PREFIXES } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: 'Comando vazio' };
  }

  const dangerous = DANGEROUS_PATTERNS.find((re) => re.test(cmd));
  if (dangerous) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: `Padrão perigoso detectado: ${dangerous}` };
  }

  const matchesAllowlist = allowedPrefixes.some((prefix) => cmd.startsWith(prefix));
  if (!matchesAllowlist) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: `Comando fora da allowlist: "${cmd}"` };
  }

  return { allowed: true };
}

/**
 * Valida uma lista de comandos de teste do Task Contract, retornando os que passam e os que
 * são rejeitados (com motivo), sem executar nada.
 */
function validateCommands(commands, options) {
  const accepted = [];
  const rejected = [];
  for (const command of commands || []) {
    const result = checkCommand(command, options);
    if (result.allowed) accepted.push(command);
    else rejected.push({ command, ...result });
  }
  return { accepted, rejected, ok: rejected.length === 0 };
}

module.exports = {
  DEFAULT_ALLOWED_PREFIXES,
  DANGEROUS_PATTERNS,
  checkCommand,
  validateCommands,
};
