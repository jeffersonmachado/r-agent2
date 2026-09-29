'use strict';

/**
 * engine/engineeringMission/bugFinding/fingerprint.js
 *
 * IDENTIDADE ESTÁVEL DE UM BUG. O fingerprint é o que impede "200 bugs iguais": duas ocorrências da
 * MESMA classe de falha (mesmo erro, mesmo ponto do código, mesmo subsistema) compartilham o
 * fingerprint mesmo que tenham timestamps, ids de execução e números de linha diferentes — e o
 * registro incrementa `occurrences` em vez de criar um finding novo.
 *
 * Módulo PURO: nenhum acesso a relógio, random ou I/O. O hash é determinístico para a mesma entrada
 * e NÃO inclui nada volátil (timestamp, id de missão/task, contagem de ocorrências).
 */

const crypto = require('crypto');
const { FINGERPRINT_VERSION } = require('./constants');

/** Padrões voláteis que NUNCA podem entrar na identidade da falha. */
const VOLATILE_PATTERNS = Object.freeze([
  // ISO timestamps e datas
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  // UUIDs
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // hashes hex longos (sha1/sha256)
  /\b[0-9a-f]{16,}\b/gi,
  // números de linha `file.js:123:45`
  /:\d+:\d+\b/g,
  /:\d+\b/g,
]);

/** Reduz um texto a uma assinatura estável (sem ids, números, caminhos absolutos ou espaços extras). */
function normalizeSignature(text) {
  if (typeof text !== 'string' || text.trim() === '') return '';
  let out = text;
  for (const pattern of VOLATILE_PATTERNS) out = out.replace(pattern, '<n>');
  out = out
    .replace(/\\+/g, '/')
    // caminhos absolutos → apenas o nome do arquivo (o mesmo bug em /a/b/x.js e /c/d/x.js é o mesmo)
    .replace(/(?:^|[\s('"])\/(?:[\w.\-@+]+\/)+([\w.\-@+]+)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return out.slice(0, 400);
}

/**
 * Extrai a ASSINATURA DE STACK: as primeiras `maxFrames` linhas de stack que pareçam frames reais,
 * normalizadas (sem números de linha). É isso que faz dois crashes no mesmo ponto terem o mesmo
 * fingerprint.
 */
function stackSignature(stack, { maxFrames = 5 } = {}) {
  if (typeof stack !== 'string' || stack.trim() === '') return '';
  const frames = stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\s*at\s+/.test(line))
    .slice(0, maxFrames)
    .map((line) => normalizeSignature(line.replace(/^\s*at\s+/, '')));
  return frames.join('|');
}

/** Chave de deduplicação: campos RELEVANTES (na ordem de especificidade), ignorando os vazios. */
function fingerprintParts(input = {}) {
  const test = input.test || input.testId || input.testFile || '';
  const route = input.route || input.endpoint || (Array.isArray(input.routes) ? input.routes[0] : '') || '';
  return {
    errorType: input.errorType || input.errorName || input.code || '',
    stackSignature: input.stackSignature || stackSignature(input.stack || input.stackTrace || ''),
    subsystem: input.subsystem || (Array.isArray(input.affectedSubsystems) ? input.affectedSubsystems[0] : '') || '',
    symbol: input.symbol || input.functionName || input.operator || '',
    invariant: input.invariant || input.invariantId || '',
    test: test,
    route: route,
    source: input.source || '',
    category: input.category || '',
    title: input.title || '',
  };
}

/** Serialização CANÔNICA (chaves ordenadas, campos vazios omitidos) — o hash depende só disso. */
function canonicalize(parts) {
  const entries = Object.keys(parts)
    .sort()
    .map((key) => [key, normalizeSignature(String(parts[key] ?? ''))])
    .filter(([, value]) => value !== '');
  return JSON.stringify({ v: FINGERPRINT_VERSION, parts: entries });
}

/**
 * Fingerprint determinístico. Sem nenhum campo relevante, cai para o TÍTULO normalizado (ainda
 * estável); sem nada, é `null` e o registro exige pelo menos um identificador.
 */
function computeFingerprint(input = {}) {
  const parts = fingerprintParts(input);
  const canonical = canonicalize(parts);
  if (canonical === JSON.stringify({ v: FINGERPRINT_VERSION, parts: [] })) return null;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = {
  normalizeSignature,
  stackSignature,
  fingerprintParts,
  canonicalize,
  computeFingerprint,
};
