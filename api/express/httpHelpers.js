'use strict';

/**
 * Helpers HTTP básicos reutilizáveis.
 * Extraídos do server.js para reduzir acoplamento estrutural.
 */

/**
 * Faz o parse do body JSON da requisição preservando o corpo bruto.
 * Inclui limite de tamanho para prevenir DoS.
 * O `raw` é a string exata do corpo (necessária para verificação de
 * assinatura HMAC de webhooks, ex.: X-Hub-Signature-256 da Meta).
 *
 * @param {http.IncomingMessage} req
 * @param {number} [maxSize=10*1024*1024]
 * @returns {Promise<{ body: any, raw: string }>}
 */
function parseJsonBodyWithRaw(req, maxSize = 10 * 1024 * 1024) {
  if (req.body !== undefined) {
    const body = req.body || {};
    return Promise.resolve({ body, raw: JSON.stringify(body) });
  }

  if (req.readableEnded || req.complete) {
    return Promise.resolve({ body: {}, raw: '' });
  }

  return new Promise((resolve, reject) => {
    let data = '';
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        reject(new Error(`Body excede o tamanho máximo de ${maxSize} bytes`));
        return;
      }
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({ body: {}, raw: '' });
        return;
      }
      try {
        const json = JSON.parse(data);
        resolve({ body: json, raw: data });
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Faz o parse do body JSON da requisição (somente o objeto parseado).
 *
 * @param {http.IncomingMessage} req
 * @param {number} [maxSize=10*1024*1024]
 * @returns {Promise<any>}
 */
function parseJsonBody(req, maxSize = 10 * 1024 * 1024) {
  return parseJsonBodyWithRaw(req, maxSize).then(({ body }) => body);
}

/**
 * Adiciona headers CORS e de segurança à resposta.
 *
 * @param {http.ServerResponse} res
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/**
 * Envia resposta JSON com status code.
 *
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Responde 404 padrão.
 *
 * @param {http.ServerResponse} res
 */
function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

/**
 * Responde 400 padrão.
 *
 * @param {http.ServerResponse} res
 * @param {string} msg
 */
function badRequest(res, msg) {
  sendJson(res, 400, { error: 'bad_request', message: msg });
}

/**
 * Valida se o Content-Type é application/json.
 *
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function hasJsonContentType(req) {
  const contentType = req.headers['content-type'] || '';
  return contentType.toLowerCase().includes('application/json');
}

module.exports = {
  parseJsonBody,
  parseJsonBodyWithRaw,
  setCorsHeaders,
  sendJson,
  notFound,
  badRequest,
  hasJsonContentType,
};
