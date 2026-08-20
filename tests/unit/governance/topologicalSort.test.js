'use strict';

/**
 * Tests for topological sort direction in relational-seed-planner.
 *
 * Bug: in-degree was counting "how many things depend on me" instead of
 * "how many things I depend on", causing children to be provisioned before parents.
 */

const { topologicalSort } = require('../../../api/modules/agent-os/services/relational-seed-planner');

describe('topologicalSort — direction', () => {
  test('Parent before Child: Child belongsTo Parent', () => {
    const nodes = ['Parent', 'Child'];
    const edges = new Map([
      ['Parent', []],           // Parent has no dependencies
      ['Child', ['Parent']],    // Child depends on Parent
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles).toHaveLength(0);
    expect(order).toHaveLength(2);
    expect(order.indexOf('Parent')).toBeLessThan(order.indexOf('Child'));
  });

  test('A → B → C: linear chain A first', () => {
    const nodes = ['A', 'B', 'C'];
    const edges = new Map([
      ['A', []],       // A has no deps
      ['B', ['A']],    // B depends on A
      ['C', ['B']],    // C depends on B
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles).toHaveLength(0);
    expect(order).toHaveLength(3);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  test('multi-parent: C depends on A and B, A and B first', () => {
    const nodes = ['A', 'B', 'C'];
    const edges = new Map([
      ['A', []],
      ['B', []],
      ['C', ['A', 'B']],  // C depends on both A and B
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles).toHaveLength(0);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  test('independent nodes: all present, no cycles', () => {
    const nodes = ['X', 'Y', 'Z'];
    const edges = new Map([
      ['X', []],
      ['Y', []],
      ['Z', []],
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles).toHaveLength(0);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(['X', 'Y', 'Z']));
  });

  test('cycle detection: A→B→A', () => {
    const nodes = ['A', 'B'];
    const edges = new Map([
      ['A', ['B']],  // A depends on B
      ['B', ['A']],  // B depends on A → cycle
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('Tenant before Establishment before Professional: canonical domain order', () => {
    const nodes = ['Professional', 'Establishment', 'Tenant'];
    const edges = new Map([
      ['Tenant', []],
      ['Establishment', ['Tenant']],       // Establishment belongs to Tenant
      ['Professional', ['Establishment']], // Professional belongs to Establishment
    ]);
    const { order, cycles } = topologicalSort(nodes, edges);
    expect(cycles).toHaveLength(0);
    expect(order.indexOf('Tenant')).toBeLessThan(order.indexOf('Establishment'));
    expect(order.indexOf('Establishment')).toBeLessThan(order.indexOf('Professional'));
  });
});
