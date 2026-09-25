'use strict';

/**
 * Orçamento do coletor de contexto (ADV-12): a varredura é LIMITADA e o truncamento é um FATO
 * explícito no enriquecimento — nunca uma falha silenciosa nem um consumo ilimitado de memória.
 */

const ORIGINAL_MAX = process.env.ENGINEERING_MISSION_SCAN_MAX_FILES;

function loadContextModule(maxFiles) {
  jest.resetModules();
  if (maxFiles === undefined) delete process.env.ENGINEERING_MISSION_SCAN_MAX_FILES;
  else process.env.ENGINEERING_MISSION_SCAN_MAX_FILES = String(maxFiles);
  // eslint-disable-next-line global-require
  return require('../../api/services/engineeringMission/missionContextService');
}

afterEach(() => {
  if (ORIGINAL_MAX === undefined) delete process.env.ENGINEERING_MISSION_SCAN_MAX_FILES;
  else process.env.ENGINEERING_MISSION_SCAN_MAX_FILES = ORIGINAL_MAX;
  jest.resetModules();
});

describe('missionContextService — orçamento de varredura', () => {
  test('ADV-12: varredura respeita o teto e marca truncamento explicitamente', () => {
    const ctx = loadContextModule(5);
    const result = ctx.scanRepository(['api']);
    expect(result.truncated).toBe(true);
    expect(result.filesScanned).toBeLessThanOrEqual(6); // teto + a leitura que detecta o estouro
    expect(Array.isArray(result.evidenceRefs)).toBe(true);
  });

  test('orçamento default cobre a árvore real (medido: 25.544 arquivos) e devolve evidências ordenadas', () => {
    const ctx = loadContextModule(undefined);
    const result = ctx.scanRepository(['missioncompiler']);
    expect(result.truncated).toBe(false);
    expect(result.filesScanned).toBeGreaterThan(10000);
    expect(result.evidenceRefs.length).toBeGreaterThan(0);
    // Ordem determinística: a varredura é estável, o que mantém o enriquecimento reprodutível.
    const again = ctx.scanRepository(['missioncompiler']);
    expect(again.evidenceRefs.map((e) => e.path)).toEqual(result.evidenceRefs.map((e) => e.path));
  });

  test('a varredura inclui tests/ (contexto "isso já é coberto?" para o enriquecimento)', () => {
    const ctx = loadContextModule(undefined);
    const result = ctx.scanRepository(['mathutils']);
    expect(result.evidenceRefs.length).toBeGreaterThan(0);
    // `some`, não `every`: com o enriquecimento CODE-AWARE, a varredura também traz evidências de
    // CONTEÚDO (arquivos que mencionam a palavra sem tê-la no nome) — e essas naturalmente vivem fora
    // de tests/. O propósito deste teste é garantir que a varredura ALCANCE tests/ ("isso já é
    // coberto?"), o que `some` verifica; `every` passou a ser uma expectativa do comportamento
    // antigo (path matching como único critério).
    expect(result.evidenceRefs.some((e) => e.path.startsWith('tests/'))).toBe(true);
  });

  test('tokenização descarta stopwords e ruído do texto da missão', () => {
    const ctx = loadContextModule();
    const tokens = ctx.tokenize('Corrija definitivamente o problema de importação do EVO e deixe tudo verde.');
    expect(tokens).toContain('importacao');
    expect(tokens).toContain('evo');
    expect(tokens).not.toContain('corrija');
    expect(tokens).not.toContain('deixe');
    expect(tokens).not.toContain('tudo');
  });

  test('detecção de fatos por texto é determinística e não inventa', () => {
    const ctx = loadContextModule();
    const facts = ctx.detectFactsFromText('Corrija a migration que quebra o tenant e não logue o token');
    expect(facts.touchesSchema).toBe(true);
    expect(facts.touchesMultiTenant).toBe(true);
    expect(facts.touchesSecrets).toBe(true);
    expect(facts.touchesFrontend).toBe(false);
    expect(facts.destructiveOperation).toBe(false);
  });

  test('truncamento chega aos fatos consumidos pelo enriquecimento', async () => {
    const ctx = loadContextModule(5);
    const { facts } = await ctx.collectContextFacts({ originalMission: 'corrija a importacao do evo', contextHints: {} });
    expect(facts.scanTruncated).toBe(true);
    expect(facts.filesScanned).toBeLessThanOrEqual(6);
    expect(facts.contextSources).toEqual(expect.arrayContaining(['REPOSITORY_INSPECTION']));
  });
});
