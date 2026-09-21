'use strict';

/**
 * engine/engineeringRouter/secretRedaction.js
 *
 * O ContextBuilder nunca envia automaticamente para o modelo: `.env`, arquivos de secret,
 * API keys, tokens, senhas, chaves privadas. Este módulo aplica duas camadas:
 *   1. Bloqueio total de arquivo por nome/caminho (nem o arquivo entra no contexto).
 *   2. Redação de linha por padrão de valor conhecido (para arquivos que passam pelo bloqueio
 *      de nome mas podem conter um segredo colado inline, ex.: um `.md` de runbook).
 *
 * Módulo puro (sem I/O) — recebe conteúdo já lido pela camada de serviço.
 */

const BLOCKED_FILENAME_PATTERNS = [
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)\.token\.env$/,
  /credentials\.json$/i,
  /(^|\/)secrets?\//i,
  /id_rsa$/, /id_ed25519$/, /\.pem$/, /\.pfx$/, /\.p12$/,
  /(^|\/)\.npmrc$/, /(^|\/)\.pypirc$/,
];

// ERV1-CLOSE-003: estes padrões casam conteúdo que atravessa VÁRIAS linhas (uma chave privada
// nunca cabe numa linha só). Precisam ser aplicados sobre o CONTEÚDO INTEIRO, antes de qualquer
// `split('\n')` — aplicados linha a linha (como o código fazia antes), nenhuma linha isolada
// contém "-----BEGIN" e "-----END" ao mesmo tempo, e o padrão nunca casa nada. O `[A-Z ]*` já
// cobre "RSA PRIVATE KEY" e "OPENSSH PRIVATE KEY" (prefixo em maiúsculas + espaço), então um
// único padrão serve para PEM genérico, RSA e OpenSSH.
const MULTILINE_BLOCK_PATTERNS = [
  { name: 'PRIVATE_KEY_BLOCK', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

// Estes cabem numa linha só — seguem sendo aplicados linha a linha, depois do bloco acima já
// ter sido removido do conteúdo inteiro.
const SECRET_VALUE_PATTERNS = [
  { name: 'AWS_ACCESS_KEY', re: /AKIA[0-9A-Z]{16}/g },
  // Mais específico (sk-ant-...) precisa ser testado antes do genérico (sk-...), senão o
  // genérico consome a string inteira primeiro.
  { name: 'ANTHROPIC_STYLE_KEY', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OPENAI_STYLE_KEY', re: /sk-(?!ant-)[A-Za-z0-9_-]{20,}/g },
  { name: 'GITHUB_TOKEN', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'SLACK_TOKEN', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'GOOGLE_API_KEY', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'BEARER_TOKEN', re: /\bBearer\s+[A-Za-z0-9_.\-]{20,}/g },
];

const ENV_ASSIGNMENT_RE = /^(\s*(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*)(.+)$/;
const PLACEHOLDER_VALUE_RE = /^["']?(\$\{?[A-Z0-9_]+\}?|<.*>|xxx+|changeme|your[-_ ]?key[-_ ]?here|placeholder|""|'')["']?\s*,?$/i;

function isBlockedFilename(path) {
  const p = String(path || '');
  return BLOCKED_FILENAME_PATTERNS.some((re) => re.test(p));
}

function redactLine(line) {
  const envMatch = ENV_ASSIGNMENT_RE.exec(line);
  if (envMatch) {
    const value = envMatch[2].trim();
    if (!PLACEHOLDER_VALUE_RE.test(value)) {
      return { line: `${envMatch[1]}[REDACTED:possible_secret]`, redacted: true };
    }
    return { line, redacted: false };
  }
  let redacted = false;
  let out = line;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.re.test(out)) {
      redacted = true;
      out = out.replace(pattern.re, `[REDACTED:${pattern.name}]`);
    }
    pattern.re.lastIndex = 0;
  }
  return { line: out, redacted };
}

/**
 * Redige blocos que atravessam múltiplas linhas (chaves privadas) sobre o CONTEÚDO INTEIRO.
 * Precisa rodar ANTES de qualquer split em linhas — ver nota em MULTILINE_BLOCK_PATTERNS.
 * @returns {{content:string, count:number}}
 */
function redactBlockSecrets(content) {
  let working = String(content || '');
  let count = 0;
  for (const pattern of MULTILINE_BLOCK_PATTERNS) {
    working = working.replace(pattern.re, () => {
      count += 1;
      return `[REDACTED:${pattern.name}]`;
    });
    pattern.re.lastIndex = 0;
  }
  return { content: working, count };
}

/**
 * Redige o conteúdo de um arquivo/texto. Pipeline: (1) blocos multiline sobre o conteúdo
 * inteiro — precisa vir antes do split, senão nenhum bloco de chave privada é detectado; (2)
 * atribuições env/tokens de uma linha só, linha a linha.
 * @returns {{content:string, redactedLineCount:number}}
 */
function redactContent(content) {
  const blockResult = redactBlockSecrets(content);
  const lines = blockResult.content.split('\n');
  let redactedLineCount = blockResult.count;
  const outLines = lines.map((line) => {
    const { line: outLine, redacted } = redactLine(line);
    if (redacted) redactedLineCount += 1;
    return outLine;
  });
  return { content: outLines.join('\n'), redactedLineCount };
}

/**
 * Atalho para redigir um texto arbitrário (ex.: stdout/stderr de subprocess, evidência textual)
 * quando só o conteúdo final importa, não a contagem de linhas redigidas — usado por
 * ERV1-CLOSE-002 antes de persistir/propagar qualquer saída de comando.
 * @returns {string}
 */
function redactText(text) {
  return redactContent(text).content;
}

/**
 * Aplica a política de redação/bloqueio a uma lista de arquivos candidatos ao contexto.
 * @param {{path:string, content:string}[]} files
 * @returns {{files: {path:string, content:string, redactedLineCount:number}[], blocked: {path:string, reason:string}[]}}
 */
function applySecretPolicy(files) {
  const kept = [];
  const blocked = [];
  for (const file of files || []) {
    if (isBlockedFilename(file.path)) {
      blocked.push({ path: file.path, reason: 'BLOCKED_FILENAME' });
      continue;
    }
    const { content, redactedLineCount } = redactContent(file.content);
    kept.push({ path: file.path, content, redactedLineCount });
  }
  return { files: kept, blocked };
}

module.exports = {
  isBlockedFilename,
  redactLine,
  redactBlockSecrets,
  redactContent,
  redactText,
  applySecretPolicy,
  MULTILINE_BLOCK_PATTERNS,
  SECRET_VALUE_PATTERNS,
};
