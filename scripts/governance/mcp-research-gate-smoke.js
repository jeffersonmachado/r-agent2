#!/usr/bin/env node
'use strict';

/**
 * Smoke em-processo do gate mcp-research: sobe o servidor REAL do container
 * (modo OFFLINE, snapshot de fixture) numa porta efêmera e executa o protocolo
 * MCP por HTTP cru (initialize → tools/list → tools/call research_fetch),
 * mais as recusas de segurança (sem bearer → 401; snapshot miss tipado).
 *
 * Saída: JSON em stdout com { ok, checks }. Exit 1 em qualquer falha.
 * Usado por scripts/governance/validate-mcp-research.js.
 */

const path = require('path');

const { createService } = require('../../services/mcp-research/src/index.js');

const TOKEN = 'gate-smoke-token';
const SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', 'tests', 'unit', 'mcp-research', 'fixtures', 'snapshot');
const DOC_URL = 'https://docs.acme-fitness.example/platform';

async function rpc(base, method, params, { token = TOKEN, id = 1 } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  return { status: res.status, body: dataLine ? JSON.parse(dataLine.slice(6)) : text };
}

async function main() {
  const service = createService({
    env: {
      MCP_RESEARCH_TOKEN: TOKEN,
      MCP_RESEARCH_MODE: 'OFFLINE',
      MCP_RESEARCH_PORT: '0',
      MCP_RESEARCH_HOST: '127.0.0.1',
      MCP_RESEARCH_SNAPSHOT_DIR: SNAPSHOT_DIR,
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  await service.http.start();
  const port = service.http.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const checks = {};
  try {
    const health = await fetch(`${base}/health`);
    checks.health = health.status === 200;

    const init = await rpc(base, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gate', version: '1.0.0' },
    });
    checks.initialize = init.status === 200 && init.body?.result?.serverInfo?.name === 'rap-mcp-research';

    const list = await rpc(base, 'tools/list', {});
    const names = (list.body?.result?.tools || []).map((tool) => tool.name).sort();
    checks.toolsList = list.status === 200 && names.length === 5 && names.includes('research_fetch');

    const fetchCall = await rpc(base, 'tools/call', { name: 'research_fetch', arguments: { url: DOC_URL } });
    const fetchText = fetchCall.body?.result?.content?.[0]?.text || '';
    const fetchOut = fetchText ? JSON.parse(fetchText) : {};
    checks.offlineFetch = fetchCall.status === 200
      && fetchCall.body?.result?.isError === false
      && typeof fetchOut.contentHash === 'string'
      && fetchOut.contentHash.startsWith('sha256:')
      && fetchOut.providerMetadata?.mode === 'OFFLINE';

    const miss = await rpc(base, 'tools/call', { name: 'research_fetch', arguments: { url: 'https://absent.example/x' } });
    const missText = miss.body?.result?.content?.[0]?.text || '';
    checks.snapshotMissTyped = miss.body?.result?.isError === true
      && missText.includes('research_offline_snapshot_miss');

    const noauth = await rpc(base, 'tools/list', {}, { token: null });
    checks.unauthorizedRejected = noauth.status === 401;
  } finally {
    await service.http.stop();
  }

  const ok = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
});
