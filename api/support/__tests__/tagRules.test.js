'use strict';

const {
  normalizeTag,
  ensureRequiredTags,
  diffTags,
  splitTags,
  suggestTagsFromText,
  consolidateTags,
  validateCoherence,
  parseTag,
} = require('../tagRules');

describe('tagRules', () => {
  test('normalizeTag normaliza namespace/value', () => {
    expect(normalizeTag(' Intent : Suporte Urgente ')).toBe('intent:suporte_urgente');
    expect(normalizeTag('crm:Lead Qualificado')).toBe('crm:lead_qualificado');
    expect(normalizeTag('semNamespace')).toBe('topic:semnamespace');
  });

  test('ensureRequiredTags adiciona intent/severity quando ausentes', () => {
    const result = ensureRequiredTags(['topic:produto']);
    expect(result.tags).toEqual(expect.arrayContaining(['topic:produto', 'intent:support', 'severity:medium']));
    expect(result.warnings).toEqual(expect.arrayContaining(['required_tag_added:intent', 'required_tag_added:severity']));
  });

  test('diffTags retorna added/removed', () => {
    const oldTags = splitTags('intent:support, severity:medium, topic:foo');
    const nextTags = splitTags('intent:support, severity:high, topic:bar');
    const diff = diffTags(oldTags, nextTags);
    expect(diff.added).toEqual(expect.arrayContaining(['severity:high', 'topic:bar']));
    expect(diff.removed).toEqual(expect.arrayContaining(['severity:medium', 'topic:foo']));
  });

  test('suggestTagsFromText aceita tenantKeywords customizados', () => {
    const result = suggestTagsFromText('quero fazer upgrade do meu plano atual', {
      tenantKeywords: {
        sales: ['upgrade'],
      },
    });

    expect(result.tags).toEqual(expect.arrayContaining(['intent:sales', 'topic:comercial']));
  });

  test('caso 1: remove intent:unknown quando houver intent válido', () => {
    const result = consolidateTags(['intent:sales', 'intent:unknown']);
    expect(result.tags).toEqual(['intent:sales']);
  });

  test('caso 2: respeita precedência inbound > state para severity', () => {
    const result = consolidateTags([], {
      stateTags: ['severity:critical'],
      inboundTags: ['severity:medium'],
      sourceOrder: ['inbound', 'state'],
    });
    expect(result.tags).toEqual(['severity:medium']);
  });

  test('caso 3: mapeia aliases pt-BR para namespaces oficiais', () => {
    const tags = [
      normalizeTag('Intencao: Vendas'),
      normalizeTag('Severidade: Critica'),
      normalizeTag('Tema: Comercial'),
    ];
    expect(tags).toEqual(['intent:vendas', 'severity:critica', 'topic:comercial']);
  });

  test('caso 4: ensureRequiredTags adiciona defaults sem unknown e sem duplicar', () => {
    const result = ensureRequiredTags(['topic:produto', 'intent:unknown', 'severity:unknown']);
    expect(result.tags).toEqual(expect.arrayContaining(['intent:support', 'severity:medium', 'topic:produto']));
    expect(result.tags).not.toEqual(expect.arrayContaining(['intent:unknown', 'severity:unknown']));
  });

  test('caso 5: entradas inválidas são descartadas sem quebrar', () => {
    const result = consolidateTags([null, '', ':', 'intent:', 'Severidade:', { foo: 'bar' }]);
    expect(result.tags).toEqual([]);
    const validation = validateCoherence(result.tags);
    expect(validation.ok).toBe(true);
  });

  test('parseTag aceita objeto estruturado', () => {
    const out = parseTag({ namespace: 'Intenção', value: 'Vendas' });
    expect(out).toMatchObject({ ns: 'intent', value: 'vendas' });
  });
});
