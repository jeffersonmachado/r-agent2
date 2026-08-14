'use strict';

const { mirrorExecution, isEnabled } = require('../../qa-mesh/meshHistoryDb');

describe('qa-mesh/meshHistoryDb', () => {
  const original = process.env.MESH_HISTORY_DB;

  afterEach(() => {
    if (original === undefined) delete process.env.MESH_HISTORY_DB;
    else process.env.MESH_HISTORY_DB = original;
  });

  it('isEnabled é false por default', () => {
    delete process.env.MESH_HISTORY_DB;
    expect(isEnabled()).toBe(false);
  });

  it('isEnabled é true quando MESH_HISTORY_DB=1', () => {
    process.env.MESH_HISTORY_DB = '1';
    expect(isEnabled()).toBe(true);
  });

  it('mirrorExecution não escreve quando desabilitado', async () => {
    delete process.env.MESH_HISTORY_DB;
    const write = jest.fn();

    const result = await mirrorExecution({ executionId: 'mesh-x' }, { store: { write } });

    expect(result).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('mirrorExecution espelha a execução via store quando habilitado', async () => {
    process.env.MESH_HISTORY_DB = '1';
    const write = jest.fn().mockResolvedValue({ sha256: 'h' });
    const execution = {
      executionId: 'mesh-2026-08-13T00-00-00-000Z',
      summary: { goNoGo: 'GO' },
    };

    const result = await mirrorExecution(execution, { store: { write } });

    expect(write).toHaveBeenCalledWith({
      kind: 'mesh/history',
      refId: 'mesh-2026-08-13T00-00-00-000Z',
      tenantKey: 'system',
      payload: execution,
    });
    expect(result).toEqual({ sha256: 'h' });
  });
});
