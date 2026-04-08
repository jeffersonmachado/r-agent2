'use strict';

const fs = require('fs');
const { generateStabilitySnapshot, SNAPSHOT_PATH } = require('../stabilityEngine');

describe('stabilityEngine', () => {
  test('gera snapshot com estrutura minima obrigatoria', () => {
    const { snapshot, outputPath } = generateStabilitySnapshot();
    expect(snapshot).toBeTruthy();
    expect(snapshot.global).toBeTruthy();
    expect(Array.isArray(snapshot.domains)).toBe(true);
    expect(Array.isArray(snapshot.channels)).toBe(true);
    expect(Array.isArray(snapshot.verticals)).toBe(true);
    expect(snapshot.releaseGate).toBeTruthy();
    expect(outputPath).toBe(SNAPSHOT_PATH);
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
