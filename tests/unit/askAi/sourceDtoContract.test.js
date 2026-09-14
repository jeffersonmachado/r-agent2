'use strict';

/**
 * TAREFA 22 + 35 + 46 — Contrato do DTO de fontes do Ask AI.
 *
 * RED (medido em 2026-09-14, evidência: auditoria do caminho de fontes):
 * `buildSources` (api/services/askAi/orchestrator.js:222) devolvia
 *   - dado vivo:      { type: 'OPERATIONAL_DATA', toolId, label }
 *   - conhecimento:   { type: 'KNOWLEDGE_DOCUMENT', documentId, title, score }
 * Nenhum campo de URL. O produtor real do RAG entrega `title = "Chunk 15"`
 * (rag-service/api/routes/query.py:558-563), e o `documentId` é o caminho interno
 * do arquivo slugificado (`src-docs-...-md`). O frontend imprimia isso como texto.
 *
 * Regras desta prova (missão: TAREFA 21/22/24/35/46):
 *   1. toda fonte exibida tem `url` navegável;
 *   2. rótulo é humano (nunca "Chunk N", nunca caminho de arquivo);
 *   3. identificadores internos (documentId, chunkId, score, toolId, path) NÃO
 *      chegam ao cliente;
 *   4. conhecimento aponta para rota INTERNA do RAP, não para filesystem.
 */

const { buildSources } = require('../../../api/services/askAi/orchestrator');

const FRIENDLY_DOC = {
  documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md',
  title: 'docs/roteiros/jornada-fitness-renovacao.md',
  score: 0.71,
};

const OPAQUE_CHUNK_TITLE = {
  documentId: 'src-docs-manual-verticals-beauty-html',
  title: 'Chunk 15',
  score: 0.66,
};

const TOOL_RESULTS = [
  { found: true, toolId: 'askai.billing.membershipHistory', label: undefined },
];

describe('buildSources — DTO de fonte exibível', () => {
  test('toda fonte exibível possui url navegável', () => {
    const sources = buildSources({ toolResults: [], knowledgeSources: [FRIENDLY_DOC] });
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(typeof source.url).toBe('string');
      expect(source.url.length).toBeGreaterThan(0);
    }
  });

  test('conhecimento aponta para rota INTERNA do RAP (nunca filesystem)', () => {
    const sources = buildSources({ toolResults: [], knowledgeSources: [FRIENDLY_DOC] });
    for (const source of sources) {
      expect(source.url.startsWith('/')).toBe(true);
      expect(source.url).not.toMatch(/^file:|^\/srv\/|^\/var\/|^\/opt\//);
      expect(source.url).not.toMatch(/\.md$/);
    }
  });

  test('rótulo é humano: nunca "Chunk N" nem caminho de arquivo', () => {
    const sources = buildSources({
      toolResults: [],
      knowledgeSources: [FRIENDLY_DOC, OPAQUE_CHUNK_TITLE],
    });
    for (const source of sources) {
      expect(String(source.label)).not.toMatch(/^chunk\s+\d+/i);
      expect(String(source.label)).not.toMatch(/\.md$|\.html$/i);
      expect(String(source.label)).not.toMatch(/\bdocs\//i);
      expect(String(source.label).trim().length).toBeGreaterThan(2);
    }
  });

  test('identificadores internos NÃO vão para o cliente', () => {
    const sources = buildSources({
      toolResults: TOOL_RESULTS,
      knowledgeSources: [FRIENDLY_DOC, OPAQUE_CHUNK_TITLE],
    });

    // Nenhum identificador como CAMPO de dado e nenhum caminho de arquivo.
    for (const source of sources) {
      expect(source).not.toHaveProperty('documentId');
      expect(source).not.toHaveProperty('chunkId');
      expect(source).not.toHaveProperty('score');
      expect(source).not.toHaveProperty('toolId');
      expect(source).not.toHaveProperty('title');
      // path de filesystem e artefato técnico não aparecem em lugar nenhum
      expect(JSON.stringify(source)).not.toMatch(/\.md("|$|\?)/i);
      expect(JSON.stringify(source)).not.toMatch(/docs\//i);
      expect(JSON.stringify(source)).not.toMatch(/^\s*\/|"\/(?:srv|var|opt|etc|home)\//i);
    }
    // score/chunkId/toolId não aparecem nem no payload serializado
    const serialized = JSON.stringify(sources);
    expect(serialized).not.toMatch(/"score"/);
    expect(serialized).not.toMatch(/chunkId/);
    expect(serialized).not.toMatch(/toolId/);
  });

  test('cada fonte declara seu tipo de origem', () => {
    const sources = buildSources({ toolResults: TOOL_RESULTS, knowledgeSources: [FRIENDLY_DOC] });
    for (const source of sources) {
      expect(typeof source.sourceType).toBe('string');
      expect(source.sourceType.length).toBeGreaterThan(0);
    }
  });

  test('fonte sem dado exibível não é inventada', () => {
    const sources = buildSources({
      toolResults: [{ failed: true, toolId: 'askai.billing.membershipHistory' }],
      knowledgeSources: [],
    });
    expect(sources).toEqual([]);
  });
});
