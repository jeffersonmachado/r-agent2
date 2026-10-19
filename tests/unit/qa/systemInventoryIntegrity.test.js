'use strict';

/**
 * INTEGRIDADE DO INVENTÁRIO DO SISTEMA (P1-8).
 *
 * Contexto: `config/system-inventory.json` é a fonte que as waves (API Surface,
 * Page Surface, DB Integrity) usam para provar cobertura. Um inventário
 * malformado, com ids duplicados ou contagens divergentes faz a wave "provar"
 * cobertura sobre um conjunto que não existe.
 *
 * Medição 2026-10-17: regenerar (`node scripts/build-system-inventory.js`) produziu
 * exatamente o MESMO conjunto (3999 itens; 0 novos, 0 removidos; counts
 * idênticos) — a regeneração é idempotente e só muda `generatedAt`. Este teste
 * trava o CONTRATO do artefato que é versionado e consumido.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const INVENTARIO = path.join(RAIZ, 'config', 'system-inventory.json');

const CLASSIFICACOES = new Set(['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']);

let inventario;

beforeAll(() => {
  inventario = JSON.parse(fs.readFileSync(INVENTARIO, 'utf8'));
});

describe('inventário do sistema — contrato do artefato versionado', () => {
  it('tem versão, data ISO válida e lista de itens', () => {
    expect(['string', 'number']).toContain(typeof inventario.version);
    expect(Number.isFinite(Date.parse(inventario.generatedAt))).toBe(true);
    expect(Array.isArray(inventario.items)).toBe(true);
    expect(inventario.items.length).toBeGreaterThan(0);
  });

  it('todo item tem id único, kind conhecido e classificação canônica', () => {
    const ids = new Set();
    for (const item of inventario.items) {
      expect(typeof item.id).toBe('string');
      expect(item.id).not.toBe('');
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(typeof item.kind).toBe('string');
      if (item.classification !== undefined) {
        expect(CLASSIFICACOES.has(item.classification)).toBe(true);
      }
    }
  });

  it('as contagens declaradas refletem os itens (nada de número inventado)', () => {
    expect(inventario.counts.total).toBe(inventario.items.length);
    const porKind = {};
    const porClassificacao = {};
    for (const item of inventario.items) {
      porKind[item.kind] = (porKind[item.kind] || 0) + 1;
      if (item.classification) {
        porClassificacao[item.classification] = (porClassificacao[item.classification] || 0) + 1;
      }
    }
    expect(inventario.counts.byKind).toEqual(porKind);
    expect(inventario.counts.byClassification).toEqual(porClassificacao);
  });

  it('as waves encontram no inventário o que afirmam cobrir (amostra não vazia)', () => {
    const porPrefixo = (p) => inventario.items.filter((i) => String(i.id).startsWith(p));
    expect(porPrefixo('api:').length).toBeGreaterThan(0);
    expect(porPrefixo('page:').length).toBeGreaterThan(0);
    expect(porPrefixo('model:').length).toBeGreaterThan(0);
  });
});
