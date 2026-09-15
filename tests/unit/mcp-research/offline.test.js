'use strict';

/**
 * Contrato do modo OFFLINE — zero egress, snapshot local, MESMO contrato MCP.
 *
 * Provas:
 *  - fetch lê o snapshot por URL (mesmo envelope do ONLINE: content, hash,
 *    sanitização, providerMetadata.mode='OFFLINE');
 *  - search busca no índice local com filtros de domínio e freshness real
 *    (o snapshot carrega retrievedAt — freshness é EXEQÚÍVEL offline);
 *  - documento ausente → erro tipado research_offline_snapshot_miss (nunca
 *    fallback para rede — o provider de rede nem é instanciado);
 *  - inspect/evidence funcionam offline (funções puras) com a mesma ligação
 *    de hash;
 *  - readiness real: snapshot ilegível → 503.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  silent,
  TEST_TOKEN,
  SNAPSHOT_DIR,
  startRealService,
  researchConnectionConfig,
  buildRealHub,
  buildReadyHub,
} = require('./helpers');
const { createService } = require('../../../services/mcp-research/src/index.js');

const DOC_URL = 'https://docs.acme-fitness.example/platform';
const INJECTION_DOC_URL = 'https://docs.acme-fitness.example/security-notes';

function parseToolResult(result) {
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { isError: result.isError === true, json: text ? JSON.parse(text) : null };
}

describe('mcp-research OFFLINE — snapshot local, zero egress', () => {
  let running;

  beforeAll(async () => {
    running = await startRealService({ mode: 'OFFLINE' });
  });

  afterAll(async () => {
    await running.stop();
  });

  test('tools/list real em OFFLINE (mesmo contrato MCP)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const { discovery } = await hub.discoverTools('mcp-research', { tenantId: 'system' });
    expect(discovery.tools.map((t) => t.name).sort()).toEqual([
      'research_capture_evidence', 'research_fetch', 'research_inspect_api_docs',
      'research_inspect_documentation', 'research_search',
    ]);
  });

  test('research_fetch lê o snapshot por URL (mesmo envelope do ONLINE)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const { isError, json } = parseToolResult(await hub.callTool(
      'mcp-research', 'research_fetch', { url: DOC_URL }, { tenantId: 'system' },
    ));
    expect(isError).toBe(false);
    expect(json.status).toBe(200);
    expect(json.url).toBe(DOC_URL);
    expect(json.canonicalUrl).toBe(DOC_URL);
    expect(json.title).toBe('ACME Fitness Platform — Docs');
    expect(json.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(json.providerMetadata.mode).toBe('OFFLINE');
    expect(json.sanitization.treatedAs).toBe('DATA_ONLY');
  });

  test('research_search busca no índice local com filtro de domínio', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const { json } = parseToolResult(await hub.callTool(
      'mcp-research', 'research_search', { query: 'fitness plataforma', maxResults: 5 }, { tenantId: 'system' },
    ));
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.candidates[0].url).toBe(DOC_URL);
    expect(json.candidates[0].domain).toBe('docs.acme-fitness.example');
    expect(json.candidates[0].sourceType).toBe('snapshot');
    expect(json.providerMetadata.backend).toBe('snapshot');
    expect(json.providerMetadata.mode).toBe('OFFLINE');

    const blocked = parseToolResult(await hub.callTool(
      'mcp-research', 'research_search',
      { query: 'fitness plataforma', blockedDomains: ['docs.acme-fitness.example'] },
      { tenantId: 'system' },
    ));
    expect(blocked.json.candidates).toHaveLength(0);

    // Freshness é EXEQÚÍVEL offline: o snapshot carrega retrievedAt
    // (2026-09-10) — janela de 1 dia exclui, janela de 1 ano mantém.
    const stale = parseToolResult(await hub.callTool(
      'mcp-research', 'research_search', { query: 'fitness plataforma', freshness: 'day' }, { tenantId: 'system' },
    ));
    expect(stale.json.providerMetadata.freshnessEnforced).toBe(true);
    expect(stale.json.candidates).toHaveLength(0);
    const fresh = parseToolResult(await hub.callTool(
      'mcp-research', 'research_search', { query: 'fitness plataforma', freshness: 'year' }, { tenantId: 'system' },
    ));
    expect(fresh.json.candidates.length).toBeGreaterThan(0);
  });

  test('documento ausente → research_offline_snapshot_miss (nunca rede)', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const { isError, json } = parseToolResult(await hub.callTool(
      'mcp-research', 'research_fetch', { url: 'https://nao-existe.example/x' }, { tenantId: 'system' },
    ));
    expect(isError).toBe(true);
    expect(json.code).toBe('research_offline_snapshot_miss');
  });

  test('inspeção e evidência funcionam OFFLINE com a mesma ligação de hash', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const fetched = parseToolResult(await hub.callTool(
      'mcp-research', 'research_fetch', { url: DOC_URL }, { tenantId: 'system' },
    )).json;

    const inspected = parseToolResult(await hub.callTool(
      'mcp-research', 'research_inspect_documentation',
      { content: fetched.content, contentHash: fetched.contentHash, url: fetched.canonicalUrl },
      { tenantId: 'system' },
    ));
    expect(inspected.isError).toBe(false);
    expect(inspected.json.sections).toContain('Recursos');
    expect(inspected.json.capabilities.length).toBeGreaterThan(0);
    expect(inspected.json.contentHash).toBe(fetched.contentHash);

    const evidence = parseToolResult(await hub.callTool(
      'mcp-research', 'research_capture_evidence',
      { url: fetched.canonicalUrl, contentHash: fetched.contentHash, locator: 'section:Recursos' },
      { tenantId: 'system' },
    ));
    expect(evidence.isError).toBe(false);
    expect(evidence.json.evidenceId).toMatch(/^ev-[0-9a-f]{40}$/);
    expect(evidence.json.locator).toBe('section:Recursos');
    expect(evidence.json.contentHash).toBe(fetched.contentHash);
  });

  test('prompt injection em documento do snapshot é neutralizado como DADO', async () => {
    const { hub } = await buildReadyHub(running.endpoint);
    const { json } = parseToolResult(await hub.callTool(
      'mcp-research', 'research_fetch', { url: INJECTION_DOC_URL }, { tenantId: 'system' },
    ));
    expect(json.sanitization.injectionDetected).toBe(true);
    expect(json.content).not.toContain('Ignore all previous instructions');
    expect(json.content).toContain('Conteúdo legítimo');
  });

  test('readiness REAL: snapshot ilegível → 503', async () => {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-research-empty-snapshot-'));
    const service = createService({
      env: {
        MCP_RESEARCH_TOKEN: TEST_TOKEN,
        MCP_RESEARCH_MODE: 'OFFLINE',
        MCP_RESEARCH_PORT: '0',
        MCP_RESEARCH_SNAPSHOT_DIR: missing,
      },
      logger: silent,
    });
    await service.http.start();
    try {
      const port = service.http.server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/readiness`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.checks.readiness).toBe('research_offline_snapshot_unavailable');
    } finally {
      await service.http.stop();
      fs.rmSync(missing, { recursive: true, force: true });
    }
  });
});
