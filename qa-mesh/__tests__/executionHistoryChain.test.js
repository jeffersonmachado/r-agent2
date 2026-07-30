'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('executionHistoryChain — cadeia append-only de execuções do mesh', () => {
  let tmpDir;
  let chainPath;
  let chain;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-chain-'));
    chainPath = path.join(tmpDir, 'index.jsonl');
    process.env.QA_MESH_HISTORY_CHAIN_PATH = chainPath;
    chain = require('../executionHistoryChain');
  });

  afterEach(() => {
    delete process.env.QA_MESH_HISTORY_CHAIN_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildExecution(executionId, overrides = {}) {
    const historyPath = path.join(tmpDir, `${executionId}.json`);
    fs.writeFileSync(historyPath, JSON.stringify({ executionId, fake: true }), 'utf8');
    return {
      executionId,
      executionKind: 'run',
      executionOrigin: 'qa_waves_real',
      isCanonicalExecution: false,
      status: 'completed',
      historyPath,
      startedAt: '2026-07-30T23:00:00.000Z',
      finishedAt: '2026-07-30T23:01:00.000Z',
      summary: {
        goNoGo: 'GO',
        total: 10,
        executed: 10,
        passed: 9,
        failed: 1,
        flaky: 0,
        skipped: 0,
      },
      ...overrides,
    };
  }

  test('anexa registro com hash, prevHash, commit e sha256 do arquivo de histórico', () => {
    const record = chain.appendExecutionRecord(buildExecution('exec-a'));

    expect(record.type).toBe('wave-execution');
    expect(record.executionId).toBe('exec-a');
    expect(record.prevHash).toBe('GENESIS');
    expect(record.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(record.historyFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.metrics).toEqual({ total: 10, executed: 10, passed: 9, failed: 1, flaky: 0, skipped: 0 });
  });

  test('encadeia registros (prevHash do segundo = hash do primeiro) e verifica íntegro', () => {
    const first = chain.appendExecutionRecord(buildExecution('exec-a'));
    const second = chain.appendExecutionRecord(buildExecution('exec-b'));

    expect(second.prevHash).toBe(first.hash);
    expect(chain.verifyChain()).toEqual({ valid: true, brokenAt: null });
  });

  test('readChain retorna do mais recente para o mais antigo e respeita limit', () => {
    chain.appendExecutionRecord(buildExecution('exec-a'));
    chain.appendExecutionRecord(buildExecution('exec-b'));
    chain.appendExecutionRecord(buildExecution('exec-c'));

    expect(chain.readChain().map((r) => r.executionId)).toEqual(['exec-c', 'exec-b', 'exec-a']);
    expect(chain.readChain(2).map((r) => r.executionId)).toEqual(['exec-c', 'exec-b']);
  });

  test('detecta adulteração da cadeia (edição de registro quebra verifyChain)', () => {
    chain.appendExecutionRecord(buildExecution('exec-a'));
    chain.appendExecutionRecord(buildExecution('exec-b'));

    const lines = fs.readFileSync(chainPath, 'utf8').split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[0]);
    tampered.goNoGo = 'NO_GO';
    lines[0] = JSON.stringify(tampered);
    fs.writeFileSync(chainPath, `${lines.join('\n')}\n`, 'utf8');

    const result = chain.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  test('detecta adulteração do arquivo meshHistory referenciado', () => {
    chain.appendExecutionRecord(buildExecution('exec-a'));

    expect(chain.verifyHistoryFile('exec-a').valid).toBe(true);

    fs.writeFileSync(path.join(tmpDir, 'exec-a.json'), JSON.stringify({ executionId: 'exec-a', fake: 'EDITADO' }), 'utf8');

    expect(chain.verifyHistoryFile('exec-a').valid).toBe(false);
  });

  test('distingue arquivo podado pela retenção (missing) de adulteração', () => {
    chain.appendExecutionRecord(buildExecution('exec-a'));

    fs.unlinkSync(path.join(tmpDir, 'exec-a.json'));

    const result = chain.verifyHistoryFile('exec-a');
    expect(result.valid).toBe('missing');
    expect(result.reason).toContain('ausente');
  });

  test('não persiste campos fora da whitelist (defesa em profundidade com redaction do store)', () => {
    const execution = buildExecution('exec-a');
    execution.summary.accessToken = 'super-secret-token';
    chain.appendExecutionRecord(execution);

    const raw = fs.readFileSync(chainPath, 'utf8');
    expect(raw).not.toContain('super-secret-token');
    expect(raw).not.toContain('accessToken');
  });

  test('redaction do store subjacente mascara chaves sensíveis em registros genéricos', () => {
    const { createEvidenceStore } = require('../../qa/coverage/evidenceStore');
    const store = createEvidenceStore({ filePath: chainPath });
    store.appendRaw({ type: 'wave-execution', timestamp: new Date().toISOString(), apiKey: 'abc123' });

    const raw = fs.readFileSync(chainPath, 'utf8');
    expect(raw).not.toContain('abc123');
    expect(raw).toContain('[REDACTED]');
  });

  test('rejeita registro sem executionId', () => {
    expect(() => chain.appendExecutionRecord({ summary: {} }))
      .toThrow('execution_history_record_requires_executionId');
  });
});
