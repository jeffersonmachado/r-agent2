'use strict';

const fs = require('fs');
const path = require('path');
const qaMeshService = require('../qaMeshService');

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '..', 'qa', 'mesh', 'intelligence', 'stabilitySnapshot.json');

describe('qaMeshService stability+learn accessors', () => {
  test('retorna snapshot de estabilidade com campos principais', () => {
    const snapshot = qaMeshService.getStabilitySnapshot();
    expect(snapshot).toBeTruthy();
    expect(snapshot.global).toBeTruthy();
    expect(snapshot.releaseGate).toBeTruthy();
  });

  test('snapshot é o rico gravado em disco (global/domains/channels/verticals/failures/releaseGate)', () => {
    const onDisk = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const snapshot = qaMeshService.getStabilitySnapshot();
    expect(snapshot).toEqual(onDisk);
    for (const key of ['global', 'domains', 'channels', 'verticals', 'failures', 'releaseGate']) {
      expect(snapshot).toHaveProperty(key);
    }
    expect(Array.isArray(snapshot.domains)).toBe(true);
    expect(Array.isArray(snapshot.channels)).toBe(true);
    expect(Array.isArray(snapshot.verticals)).toBe(true);
    expect(Array.isArray(snapshot.failures)).toBe(true);
  });

  test('global é coerente com o estado canônico (QA Mesh GO 139/139)', () => {
    const snapshot = qaMeshService.getStabilitySnapshot();
    expect(snapshot.global.stabilityScore).toBeGreaterThanOrEqual(95);
    expect(snapshot.global.releaseReadiness).toBeGreaterThanOrEqual(95);
    expect(snapshot.global.criticalFlowSuccess).toBe(100);
    expect(snapshot.global.flakyRate).toBe(0);
  });

  test('verticals inclui bakery (padaria) com seus 7 cenários, ready', () => {
    const snapshot = qaMeshService.getStabilitySnapshot();
    const names = snapshot.verticals.map((v) => v.name);
    // config/verticals.json (kind==="vertical"): beauty, fitness, food, services, bakery, clinic, market
    for (const expected of ['beauty', 'fitness', 'food', 'services', 'bakery', 'clinic', 'market']) {
      expect(names).toContain(expected);
    }
    const bakery = snapshot.verticals.find((v) => v.name === 'bakery');
    expect(bakery).toBeTruthy();
    expect(bakery.scenarios).toBe(7);
    expect(bakery.passed).toBe(7);
    expect(bakery.passRate).toBe(100);
    expect(bakery.readiness).toBe('ready');
  });

  test('history retorna snapshots[] no formato consumido pela StabilityPage', () => {
    const history = qaMeshService.getStabilityHistory();
    expect(history).toBeTruthy();
    expect(Array.isArray(history.snapshots)).toBe(true);
    expect(history.snapshots.length).toBeGreaterThan(0);
    const point = history.snapshots[0];
    // StabilityPage (StabilityTrendChart) lê: generatedAt, file, stabilityScore, releaseReadiness, failures
    expect(point).toHaveProperty('generatedAt');
    expect(point).toHaveProperty('file');
    expect(point).toHaveProperty('stabilityScore');
    expect(point).toHaveProperty('releaseReadiness');
    expect(point).toHaveProperty('failures');
    expect(typeof point.failures).toBe('number');
  });

  test('retorna sumario de learn com estrutura consistente', () => {
    const summary = qaMeshService.getLearnSummary();
    expect(summary).toBeTruthy();
    expect(summary).toHaveProperty('ranked');
    expect(summary).toHaveProperty('suggestions');
    expect(summary).toHaveProperty('plans');
  });
});
