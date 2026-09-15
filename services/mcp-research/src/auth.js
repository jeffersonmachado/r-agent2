'use strict';

/**
 * Autenticação serviço-a-serviço do MCP Research — bearer por REFERÊNCIA de
 * ambiente (MCP_RESEARCH_TOKEN), o mesmo padrão do RAG_INTERNAL_TOKEN:
 * o cliente (MCP Client Hub do RAP) envia `Authorization: Bearer <token>`
 * resolvido da env de mesmo nome; o container compara em tempo constante.
 *
 * O valor nunca é logado. Sem token configurado o servidor nem sobe
 * (config.js, fail-closed). /health e /readiness são não autenticados
 * (não expõem dado nem capability — apenas estado do processo).
 */

const crypto = require('crypto');

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) {
    // Compara contra si mesmo para manter tempo aproximadamente constante.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * Extrai e verifica o bearer do request. Retorna true apenas com match exato.
 */
function isAuthorized(req, expectedToken) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualString(match[1].trim(), expectedToken);
}

function writeUnauthorized(res) {
  const body = JSON.stringify({ error: 'unauthorized', code: 'mcp_research_unauthorized' });
  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

module.exports = { isAuthorized, writeUnauthorized, timingSafeEqualString };
