'use strict';

/**
 * engine/engineeringRouter/commandPolicy.js
 *
 * ERV1-CLOSE-001: o modelo NÃO recebe liberdade de shell. Antes, a "fronteira de segurança"
 * era `cmd.startsWith(prefix)` + uma blocklist de padrões perigosos específicos (ex.:
 * `&&\s*rm`) — não é fronteira nenhuma: qualquer metacaractere de shell que não combine com um
 * padrão da blocklist passava direto, e o Test Runner rodava a string inteira via
 * `spawn(cmd, {shell:true})`. `npm test; touch /tmp/x` começava com "npm test" (allowlist OK) e
 * não continha `rm` depois do `;` (blocklist não pegava) — o `touch` executava de verdade.
 *
 * A correção NÃO tenta parsear shell de verdade (proibido pela missão de fechamento). Em vez
 * disso: (1) qualquer metacaractere de shell na string inteira derruba o comando, sem exceção;
 * (2) o que sobra é tokenizado por espaço (sem shell, sem expansão) em `{executable, args}`;
 * (3) `executable`+`args` são validados contra uma policy estruturada por comando conhecido —
 * nunca uma string livre. O Test Runner executa com `spawn(executable, args, {shell:false})`.
 *
 * Módulo puro (sem I/O, não executa nada).
 */

const { FAILURE_CODES } = require('./constants');

// Qualquer um destes caracteres em QUALQUER posição da string derruba o comando inteiro, antes
// de qualquer outra checagem — é o que fecha injeção via `;`, `&&`, `||`, `$()`, backticks,
// pipe, redirecionamento, subshell, glob e newline. Não há "modo avançado" que reabra isso.
const FORBIDDEN_SHELL_CHARS_RE = /[;&|$`<>(){}\n\r*?~!#]/;

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

// Padrões perigosos mantidos como defesa em profundidade — não são mais a fronteira principal
// (isso agora é FORBIDDEN_SHELL_CHARS_RE + validação estruturada por executável), mas continuam
// úteis para pegar tentativas óbvias dentro de um único token (ex.: um "script" que é na
// verdade um caminho perigoso).
const DANGEROUS_PATTERNS = Object.freeze([
  /rm\s+-rf/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bcredential/i,
  /\benv\s*\|/i,
  /\bprintenv\b/i,
]);

function hasPathTraversal(token) {
  return String(token || '').split('/').includes('..');
}

function isSafeScriptName(token) {
  // Nome de script npm: alfanumérico, dois-pontos, hífen, underscore. Nada de caminho, nada de
  // flag disfarçada de nome de script.
  return /^[a-zA-Z0-9:_-]+$/.test(String(token || ''));
}

function isSafeRelativePath(token, allowedDirs) {
  const t = String(token || '');
  if (!t || t.startsWith('/') || t.startsWith('~')) return false;
  if (hasPathTraversal(t)) return false;
  return allowedDirs.some((dir) => t.startsWith(dir));
}

function isSafeFlagOrArg(token) {
  // Qualquer outro argumento (flags do jest, testPathPattern, etc.): sem caracteres de shell
  // (já garantido pelo filtro global), sem path traversal, sem caminho absoluto fora do repo.
  const t = String(token || '');
  if (hasPathTraversal(t)) return false;
  if (t.startsWith('/') || t.startsWith('~')) return false;
  return true;
}

/**
 * Tokeniza uma string JÁ validada como livre de metacaracteres de shell. Sem shell, sem
 * expansão, sem quoting — só espaços em branco. Suficiente porque FORBIDDEN_SHELL_CHARS_RE já
 * rejeitou qualquer coisa que precisaria de quoting real para este uso (test commands do Task
 * Contract, não comandos de usuário arbitrários).
 */
function tokenize(command) {
  return String(command || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Valida `{executable, args}` contra a policy estruturada por comando conhecido. Nunca aceita
 * um executável fora da lista fechada abaixo, e cada executável tem sua própria validação de
 * argumentos — não existe fallback "genérico" que aceite qualquer coisa.
 *
 * @returns {{ok:boolean, reason?:string}}
 */
function validateStructuredCommand(executable, args) {
  switch (executable) {
    case 'npm': {
      if (args[0] === 'test') return { ok: true };
      if (args[0] === 'run' && args[1] && isSafeScriptName(args[1])) {
        const allowedScripts = ['test', 'lint', 'build'];
        const scriptBase = args[1].split(':')[0];
        if (allowedScripts.includes(scriptBase) || allowedScripts.includes(args[1])) {
          return { ok: true };
        }
        return { ok: false, reason: `script npm não autorizado: "${args[1]}"` };
      }
      return { ok: false, reason: 'uso de npm não autorizado (só "npm test" ou "npm run test:*|lint|build")' };
    }
    case 'npx': {
      if (args[0] !== 'jest') return { ok: false, reason: 'npx só autorizado para "jest"' };
      return { ok: args.slice(1).every(isSafeFlagOrArg), reason: 'argumento de jest inválido' };
    }
    case 'jest': {
      return { ok: args.every(isSafeFlagOrArg), reason: 'argumento de jest inválido' };
    }
    case 'node': {
      if (args.length === 0) return { ok: false, reason: 'node exige um script alvo' };
      if (!isSafeRelativePath(args[0], ['scripts/', 'tests/'])) {
        return { ok: false, reason: `script node fora de scripts/ ou tests/: "${args[0]}"` };
      }
      return { ok: args.slice(1).every(isSafeFlagOrArg), reason: 'argumento de node inválido' };
    }
    case 'git': {
      if (args[0] === 'status' || args[0] === 'diff') {
        return { ok: args.slice(1).every(isSafeFlagOrArg), reason: 'argumento de git inválido' };
      }
      if (args[0] === 'apply' && args[1] === '--check') {
        return { ok: args.slice(2).every(isSafeFlagOrArg), reason: 'argumento de git apply inválido' };
      }
      return { ok: false, reason: `subcomando git não autorizado: "${args[0] || ''}"` };
    }
    default:
      return { ok: false, reason: `executável não autorizado: "${executable}"` };
  }
}

/**
 * Faz o parse seguro de um comando de teste: string inteira livre de metacaracteres de shell →
 * tokens → `{executable, args}` validados estruturalmente. Nunca aceita nada que dependesse de
 * shell de verdade (pipe, redirecionamento, subshell, encadeamento) — a string inteira é
 * rejeitada antes de qualquer tokenização se contiver esses caracteres.
 *
 * @param {string} command
 * @returns {{allowed:boolean, executable?:string, args?:string[], code?:string, reason?:string}}
 */
function parseCommand(command) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: 'Comando vazio' };
  }

  if (FORBIDDEN_SHELL_CHARS_RE.test(cmd)) {
    return {
      allowed: false,
      code: FAILURE_CODES.COMMAND_NOT_ALLOWED,
      reason: 'Metacaractere de shell não permitido (V1 não aceita sintaxe de shell — sem ";", "&&", "||", "|", "$()", crases, "<", ">", "()", "{}", "*", "~", quebras de linha)',
    };
  }

  const dangerous = DANGEROUS_PATTERNS.find((re) => re.test(cmd));
  if (dangerous) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: `Padrão perigoso detectado: ${dangerous}` };
  }

  const tokens = tokenize(cmd);
  const [executable, ...args] = tokens;

  const structured = validateStructuredCommand(executable, args);
  if (!structured.ok) {
    return { allowed: false, code: FAILURE_CODES.COMMAND_NOT_ALLOWED, reason: structured.reason || `Comando fora da allowlist: "${cmd}"` };
  }

  return { allowed: true, executable, args };
}

/**
 * Mantido para compatibilidade com chamadores existentes que só precisam do booleano de
 * permissão (ex.: validação prévia de Task Contract) — internamente usa a mesma fronteira real
 * de `parseCommand`, então qualquer string que dependeria de shell é rejeitada aqui também.
 *
 * @param {string} command
 * @param {{allowedPrefixes?: string[]}} [_options] - mantido na assinatura por compatibilidade;
 *   a allowlist real agora é estrutural (validateStructuredCommand), não mais por prefixo de
 *   string solto.
 * @returns {{allowed:boolean, code?:string, reason?:string}}
 */
function checkCommand(command, _options = {}) {
  const result = parseCommand(command);
  return { allowed: result.allowed, code: result.code, reason: result.reason };
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
  FORBIDDEN_SHELL_CHARS_RE,
  parseCommand,
  checkCommand,
  validateCommands,
};
