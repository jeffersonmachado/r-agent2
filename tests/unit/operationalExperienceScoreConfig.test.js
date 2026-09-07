'use strict';

/**
 * P4.14 — garante que o Operational Experience Score continua executável:
 * toda referência de probe (suíte ou artefato estático) precisa existir no
 * repositório; do contrário a dimensão mediria silenciosamente "fail".
 */

const fs = require('fs');
const path = require('path');

const { DIMENSIONS, ROOT } = require('../../scripts/product/operational-experience-score');

describe('operational-experience-score config', () => {
  it('declara as 15 dimensões da experiência operacional', () => {
    expect(DIMENSIONS).toHaveLength(15);
    const ids = DIMENSIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(15);
    for (const required of [
      'workspace-context',
      'inbox-speed',
      'next-best-action',
      'voice-digital',
      'vertical-depth',
      'manager-experience',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('toda referência de probe jest/vitest/artefato estático existe', () => {
    const dynamicArtifacts = new Set(['reports/experience-segregation-report.json']);
    const missing = [];
    for (const dimension of DIMENSIONS) {
      expect(dimension.probes.length).toBeGreaterThan(0);
      for (const probe of dimension.probes) {
        expect(['jest', 'vitest', 'artifact']).toContain(probe.kind);
        if (probe.kind === 'artifact' && dynamicArtifacts.has(probe.ref)) continue; // gerado pelo gate de segregação
        if (!fs.existsSync(path.join(ROOT, probe.ref))) {
          missing.push(`${dimension.id} -> ${probe.ref}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('probes de artefato declaram predicado expect()', () => {
    for (const dimension of DIMENSIONS) {
      for (const probe of dimension.probes) {
        if (probe.kind === 'artifact') {
          expect(typeof probe.expect).toBe('function');
        }
      }
    }
  });
});
