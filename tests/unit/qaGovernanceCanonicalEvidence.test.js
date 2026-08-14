'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateCanonicalEvidence,
} = require('../../scripts/governance/validate-qa-governance');

describe('QA governance canonical evidence', () => {
  let root;
  const executionId = 'mesh-2026-08-14T12-00-00-000Z';
  const now = Date.parse('2026-08-14T13:00:00.000Z');

  const mesh = {
    executionId,
    isCanonicalExecution: true,
    status: 'GO',
    totals: { registryTotal: 12 },
  };

  const promotion = {
    executionId,
    registryTotal: 12,
    goNoGo: 'GO',
    promotedAt: '2026-08-14T12:05:00.000Z',
    historyPath: `/old/workspace/qa-mesh/meshHistory/${executionId}.json`,
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-governance-'));
    fs.mkdirSync(path.join(root, 'qa-mesh', 'meshHistory'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeHistory(overrides = {}) {
    const history = {
      executionId,
      isCanonicalExecution: true,
      startedAt: '2026-08-14T12:00:00.000Z',
      finishedAt: '2026-08-14T12:04:00.000Z',
      summary: {
        executionId,
        isCanonicalExecution: true,
        registryTotal: 12,
        goNoGo: 'GO',
      },
      ...overrides,
    };
    fs.writeFileSync(
      path.join(root, 'qa-mesh', 'meshHistory', `${executionId}.json`),
      JSON.stringify(history),
      'utf8'
    );
  }

  test('accepts a present, coherent and fresh canonical history', () => {
    writeHistory();
    const result = validateCanonicalEvidence({ mesh, promotion, root, now });
    expect(result.issues).toEqual([]);
  });

  test('fails closed when the promoted history file is missing', () => {
    const result = validateCanonicalEvidence({ mesh, promotion, root, now });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'qa_canonical_history_missing' }),
    ]));
  });

  test('rejects a history from another execution or with a non-GO decision', () => {
    writeHistory({
      executionId: 'mesh-other',
      summary: {
        executionId: 'mesh-other',
        isCanonicalExecution: true,
        registryTotal: 12,
        goNoGo: 'NO_GO',
      },
    });
    const result = validateCanonicalEvidence({ mesh, promotion, root, now });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'qa_canonical_history_execution_mismatch' }),
      expect.objectContaining({ code: 'qa_canonical_history_no_go' }),
    ]));
  });

  test('rejects stale canonical evidence', () => {
    writeHistory();
    const result = validateCanonicalEvidence({
      mesh,
      promotion: { ...promotion, promotedAt: '2026-08-01T12:00:00.000Z' },
      root,
      now,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'qa_canonical_history_stale' }),
    ]));
  });
});
