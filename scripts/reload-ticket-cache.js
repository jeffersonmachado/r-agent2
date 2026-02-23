#!/usr/bin/env node
/**
 * Recarrega o cache de tickets no backend via endpoint protegido.
 *
 * Uso:
 *   API_URL=http://localhost:3000 \
 *   AUTH_TOKEN=seu_token \
 *   TENANT_ID=tenant_key \
 *   node scripts/reload-ticket-cache.js
 */

const http = require('http');
const https = require('https');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TENANT_ID = process.env.TENANT_ID || '';

function requestReload() {
  return new Promise((resolve, reject) => {
    const url = new URL('/tickets/reload-cache', API_URL);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
          ...(TENANT_ID ? { 'x-tenant-id': TENANT_ID } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, body: data });
            return;
          }
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  if (!AUTH_TOKEN) {
    console.error('AUTH_TOKEN é obrigatório.');
    process.exit(1);
  }
  if (!TENANT_ID) {
    console.error('TENANT_ID é obrigatório.');
    process.exit(1);
  }

  try {
    const result = await requestReload();
    console.log('Cache recarregado com sucesso.', result.status);
    if (result.body) console.log(result.body);
    process.exit(0);
  } catch (err) {
    console.error('Falha ao recarregar cache:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
