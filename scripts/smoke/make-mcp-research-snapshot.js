#!/usr/bin/env node
'use strict';

/**
 * make-mcp-research-snapshot.js — gera um SNAPSHOT válido para o E2E REAL do
 * container `mcp-research` em modo OFFLINE.
 *
 * O snapshot é a ÚNICA fonte de conteúdo do modo OFFLINE: sem egress, o
 * container responde `research_fetch` a partir deste diretório. O layout é o
 * documentado em `services/mcp-research/src/snapshotStore.js`:
 *
 *   <dir>/index.json
 *   <dir>/documents/<sha256(url normalizada)>.json
 *
 * O nome do arquivo é DERIVADO da URL (nunca composto por ela) — o gerador usa
 * a MESMA derivação do store para que o teste falhe se os dois divergirem.
 *
 * Uso: node scripts/smoke/make-mcp-research-snapshot.js <dir>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://docs.acme-fitness.example/platform';

const CONTENT = [
  '<html><body>',
  '<h1>Plataforma Acme Fitness</h1>',
  '<h2>Matrículas</h2>',
  '<p>Gestão de matrículas, planos e contratos com congelamento de até 30 dias.</p>',
  '<h2>Cobrança</h2>',
  '<p>Cobrança recorrente de mensalidades com fatura e multa por atraso.</p>',
  '<h2>Acesso</h2>',
  '<p>Check-in por catraca e pelo aplicativo do aluno.</p>',
  '</body></html>',
].join('\n');

function normalizeUrlKey(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

function snapshotFileName(url) {
  return `${crypto.createHash('sha256').update(normalizeUrlKey(url), 'utf8').digest('hex')}.json`;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('uso: node scripts/smoke/make-mcp-research-snapshot.js <dir>');
    process.exit(1);
  }

  const docsDir = path.join(dir, 'documents');
  fs.mkdirSync(docsDir, { recursive: true });

  const index = {
    version: 1,
    documents: [
      {
        url: TARGET_URL,
        canonicalUrl: TARGET_URL,
        title: 'Plataforma Acme Fitness — documentação oficial',
        snippet: 'Matrículas, cobrança recorrente, congelamento de contrato e check-in.',
        contentType: 'text/html; charset=utf-8',
        retrievedAt: '2026-09-01T00:00:00.000Z',
        domain: 'docs.acme-fitness.example',
        sourceType: 'snapshot',
        queryTerms: ['fitness', 'matricula', 'billing', 'checkin', 'plataforma'],
      },
    ],
  };

  const document = {
    url: TARGET_URL,
    canonicalUrl: TARGET_URL,
    contentType: 'text/html; charset=utf-8',
    retrievedAt: '2026-09-01T00:00:00.000Z',
    content: CONTENT,
  };

  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(docsDir, snapshotFileName(TARGET_URL)), `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  console.log(`[snapshot] pronto em ${dir}`);
  console.log(`[snapshot] documento: ${snapshotFileName(TARGET_URL)}`);
}

if (require.main === module) main();

module.exports = { TARGET_URL, CONTENT, normalizeUrlKey, snapshotFileName };
