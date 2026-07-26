'use strict';

/**
 * Regressão: replay sem `finishedAt` não pode contar como fresco.
 *
 * Falha observada (2026-07-26): os replays prod-like de qa/smoke/prod-like
 * têm `generatedAt` (2026-05-12) mas não `finishedAt`. O scanner ignorava
 * `generatedAt` e, pelo fallback do ternário, tratava replay sem timestamp
 * como `hasFreshReplay: true` — inflando o GO do operational-health com
 * evidência de meses atrás (scheduling, crm_updates, lead_capture e até a
 * capability canônica support_ticket_flow apareciam como "frescas").
 *
 * Comportamento correto:
 * - `generatedAt` é fallback de timestamp (latestFinishedAt o reflete);
 * - freshness exigida + sem timestamp confiável => hasFreshReplay false.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../../../api/services/qa/scanners/replayCapabilityScanner');

const OLD_ISO = '2026-05-12T18:31:23.031Z';

function writeReplay(dir, name, payload) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

describe('replayCapabilityScanner — freshness de replays', () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-freshness-'));
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test('replay com apenas generatedAt antiga não é fresco e expõe a data real', () => {
    writeReplay(fixtureDir, 'booking_flow-replay.json', {
      journeyId: 'booking_flow',
      scenarioId: 'booking_flow',
      generatedAt: OLD_ISO,
      steps: [{ id: 's1', screenshotAfter: 'x.png' }],
    });

    const result = scan({ replayDirs: [fixtureDir], replayFreshnessDays: 7 });
    const status = result.replayStatusByCapability.scheduling;

    expect(status).toBeDefined();
    expect(status.replayed).toBe(true);
    expect(status.latestFinishedAt).toBe(OLD_ISO);
    expect(status.hasFreshReplay).toBe(false);
  });

  test('replay sem nenhum timestamp não é fresco quando freshness é exigida', () => {
    writeReplay(fixtureDir, 'booking_flow-replay.json', {
      journeyId: 'booking_flow',
      scenarioId: 'booking_flow',
      steps: [{ id: 's1', screenshotAfter: 'x.png' }],
    });

    const result = scan({ replayDirs: [fixtureDir], replayFreshnessDays: 7 });
    const status = result.replayStatusByCapability.scheduling;

    expect(status.replayed).toBe(true);
    expect(status.latestFinishedAt).toBeNull();
    expect(status.hasFreshReplay).toBe(false);
  });

  test('replay com finishedAt dentro da janela é fresco', () => {
    writeReplay(fixtureDir, 'booking_flow-replay.json', {
      journeyId: 'booking_flow',
      scenarioId: 'booking_flow',
      finishedAt: new Date().toISOString(),
      steps: [{ id: 's1', screenshotAfter: 'x.png' }],
    });

    const result = scan({ replayDirs: [fixtureDir], replayFreshnessDays: 7 });
    const status = result.replayStatusByCapability.scheduling;

    expect(status.hasFreshReplay).toBe(true);
  });

  test('sem replayFreshnessDays explícito, aplica o default de 7 dias', () => {
    writeReplay(fixtureDir, 'booking_flow-replay.json', {
      journeyId: 'booking_flow',
      scenarioId: 'booking_flow',
      finishedAt: OLD_ISO,
      steps: [{ id: 's1', screenshotAfter: 'x.png' }],
    });

    const result = scan({ replayDirs: [fixtureDir] });
    const status = result.replayStatusByCapability.scheduling;

    expect(result.replayFreshnessDays).toBe(7);
    expect(status.hasFreshReplay).toBe(false);
  });
});
