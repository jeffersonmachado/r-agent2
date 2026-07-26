'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadBlockingJourneyEvidence,
  resolveMaxAgeHours,
  DEFAULT_MAX_AGE_HOURS,
} = require('../blockingJourneyEvidence');

const NOW = Date.parse('2026-07-26T12:00:00.000Z');

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocking-evidence-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

function validSummary(overrides = {}) {
  return {
    generatedAt: '2026-07-26T11:08:28.186Z',
    status: 'GO',
    flows: [
      {
        journeyId: 'support_ticket_flow',
        replay: { id: 'replay-1', status: 'GO', screenshots: [{ id: 's1' }, { id: 's2' }] },
        audit: { valid: true },
        strictGovernance: { status: 'GO' },
      },
    ],
    ...overrides,
  };
}

describe('qa-mesh/blockingJourneyEvidence', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('arquivo inexistente => missing', () => {
    const result = loadBlockingJourneyEvidence('support_ticket_flow', {
      evidencePath: path.join(os.tmpdir(), 'nao-existe-blocking-evidence.json'),
      now: NOW,
    });
    expect(result.status).toBe('missing');
  });

  test('evidência fresca e GO => valid', () => {
    const file = writeEvidence(validSummary());
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('valid');
    expect(result.replayId).toBe('replay-1');
    expect(result.screenshots).toBe(2);
  });

  test('evidência mais velha que o frescor máximo => stale', () => {
    const file = writeEvidence(validSummary({ generatedAt: '2026-07-10T11:08:28.186Z' }));
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('stale');
    expect(result.maxAgeHours).toBe(DEFAULT_MAX_AGE_HOURS);
  });

  test('jornada ausente na evidência => missing', () => {
    const file = writeEvidence(validSummary());
    const result = loadBlockingJourneyEvidence('fitness_customer_checkin', { evidencePath: file, now: NOW });
    expect(result.status).toBe('missing');
  });

  test('replay NO_GO => not_go', () => {
    const summary = validSummary();
    summary.flows[0].replay.status = 'NO_GO';
    const file = writeEvidence(summary);
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('not_go');
    expect(result.detail.replayGo).toBe(false);
  });

  test('audit inválido => not_go', () => {
    const summary = validSummary();
    summary.flows[0].audit.valid = false;
    const file = writeEvidence(summary);
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('not_go');
  });

  test('sem screenshots (sem prova de browser) => not_go', () => {
    const summary = validSummary();
    summary.flows[0].replay.screenshots = [];
    const file = writeEvidence(summary);
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('not_go');
    expect(result.detail.screenshots).toBe(0);
  });

  test('generatedAt inválido => invalid', () => {
    const file = writeEvidence({ flows: [] });
    const result = loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW });
    expect(result.status).toBe('invalid');
  });

  test('frescor configurável por env MESH_BLOCKING_EVIDENCE_MAX_AGE_HOURS', () => {
    process.env.MESH_BLOCKING_EVIDENCE_MAX_AGE_HOURS = '1';
    expect(resolveMaxAgeHours({})).toBe(1);
    const file = writeEvidence(validSummary());
    // evidência de 52min atrás: válida com 1h, stale com 0.5h
    const recent = writeEvidence(validSummary({ generatedAt: '2026-07-26T11:10:00.000Z' }));
    expect(loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: recent, now: NOW }).status).toBe('valid');
    expect(
      loadBlockingJourneyEvidence('support_ticket_flow', { evidencePath: file, now: NOW, maxAgeHours: 0.5 }).status,
    ).toBe('stale');
  });
});
