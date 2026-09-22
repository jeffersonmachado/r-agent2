'use strict';

/**
 * Autenticação serviço-a-serviço do Engineering Runner — bearer por REFERÊNCIA de ambiente
 * (ENGINEERING_RUNNER_TOKEN), o mesmo padrão de services/mcp-research/src/auth.js e do
 * RAG_INTERNAL_TOKEN: o cliente (chatbot-api) envia `Authorization: Bearer <token>` resolvido
 * da env de mesmo nome; o runner compara em tempo constante.
 *
 * O valor nunca é logado. Sem token configurado o servidor nem sobe (config.js, fail-closed).
 * /health não é autenticado (não expõe dado nem capability — apenas estado do processo).
 */

const crypto = require('crypto');

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isAuthorized(req, expectedToken) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualString(match[1].trim(), expectedToken);
}

function writeUnauthorized(res) {
  const body = JSON.stringify({ error: 'unauthorized', code: 'engineering_runner_unauthorized' });
  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

module.exports = { isAuthorized, writeUnauthorized, timingSafeEqualString };
