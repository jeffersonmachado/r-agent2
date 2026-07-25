'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEvidenceStore } = require('../../../qa/coverage/evidenceStore');

function makeEvidence(overrides = {}) {
  return {
    evidenceId: 'ev-1',
    executionId: 'exec-1',
    waveId: 'wave-1',
    journeyId: 'journey-1',
    journeyFingerprint: 'abc123',
    commit: 'deadbeef',
    environment: 'qa-local',
    status: 'passed',
    assertions: [{ name: 'renders', passed: true }],
    observedElements: ['page:home'],
    expectedElements: ['page:home'],
    timestamp: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('coverage/evidenceStore', () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-'));
    filePath = path.join(dir, 'nested', 'evidence.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('append cria diretório pai e arquivo; verify válido com hash chain', () => {
    const store = createEvidenceStore({ filePath });
    const r1 = store.append(makeEvidence());
    const r2 = store.append(makeEvidence({ evidenceId: 'ev-2' }));

    expect(fs.existsSync(filePath)).toBe(true);
    expect(r1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.prevHash).toBe('GENESIS');
    expect(r2.prevHash).toBe(r1.hash);
    expect(store.verify()).toEqual({ valid: true, brokenAt: null });
  });

  test('verify detecta adulteração de uma linha do arquivo', () => {
    const store = createEvidenceStore({ filePath });
    store.append(makeEvidence());
    store.append(makeEvidence({ evidenceId: 'ev-2' }));

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.status = 'failed'; // adultera conteúdo sem recalcular hash
    lines[0] = JSON.stringify(tampered);
    fs.writeFileSync(filePath, lines.join('\n'));

    const result = store.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  test('verify detecta quebra de linkage prevHash', () => {
    const store = createEvidenceStore({ filePath });
    store.append(makeEvidence());
    store.append(makeEvidence({ evidenceId: 'ev-2' }));

    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const second = JSON.parse(lines[1]);
    second.prevHash = 'forged';
    // Recalcula o hash para isolar a falha no linkage.
    const { createEvidenceStore: fresh } = require('../../../qa/coverage/evidenceStore');
    expect(fresh).toBeDefined();
    second.hash = null;
    lines[1] = JSON.stringify(second);
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`);

    expect(store.verify().valid).toBe(false);
  });

  test('redaction recursiva de password/token/authorization aninhados', () => {
    const store = createEvidenceStore({ filePath });
    store.append(makeEvidence({
      assertions: [{
        name: 'login',
        passed: true,
        inputs: { password: 'super-secret', nested: { Authorization: 'Bearer abc' } },
      }],
      metadata: { api_token: 'tok-secret-value', CPF: '123.456.789-00', safe: 'ok' },
    }));

    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('Bearer abc');
    expect(raw).not.toContain('123.456.789-00');
    expect(raw).not.toContain('tok-secret-value');

    const record = store.readAll()[0];
    expect(record.assertions[0].inputs.password).toBe('[REDACTED]');
    expect(record.assertions[0].inputs.nested.Authorization).toBe('[REDACTED]');
    expect(record.metadata.api_token).toBe('[REDACTED]');
    expect(record.metadata.CPF).toBe('[REDACTED]');
    expect(record.metadata.safe).toBe('ok');
    expect(store.verify().valid).toBe(true);
  });

  test('markStale anexa stale-marker sem alterar o registro original', () => {
    const store = createEvidenceStore({ filePath });
    const original = store.append(makeEvidence());
    store.markStale('ev-1', 'journey fingerprint changed');

    const records = store.readAll();
    expect(records).toHaveLength(2);
    // Registro original intacto.
    expect(records[0].status).toBe('passed');
    expect(records[0].hash).toBe(original.hash);
    // Marcador encadeado.
    expect(records[1].type).toBe('stale-marker');
    expect(records[1].staleOf).toBe('ev-1');
    expect(records[1].reason).toBe('journey fingerprint changed');
    expect(records[1].prevHash).toBe(original.hash);
    expect(store.verify().valid).toBe(true);
  });

  test('campos obrigatórios ausentes geram erro explícito e nada é persistido', () => {
    const store = createEvidenceStore({ filePath });
    expect(() => store.append({ evidenceId: 'ev-x' }))
      .toThrow(/evidence_missing_required_fields/);
    expect(() => store.append(makeEvidence({ timestamp: undefined })))
      .toThrow(/evidence_missing_required_fields: timestamp/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('modo estritamente append: reabrir o store continua a cadeia sem truncar', () => {
    const store1 = createEvidenceStore({ filePath });
    const r1 = store1.append(makeEvidence());

    const store2 = createEvidenceStore({ filePath });
    const r2 = store2.append(makeEvidence({ evidenceId: 'ev-2' }));

    expect(store2.readAll()).toHaveLength(2);
    expect(r2.prevHash).toBe(r1.hash);
    expect(store2.verify().valid).toBe(true);
  });
});
