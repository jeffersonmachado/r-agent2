import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('api/processRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setup() {
    vi.doMock('./client', () => ({
      fetchJson: vi.fn(),
    }));

    const api = await import('./processRuntime');
    const client = await import('./client');
    return { ...api, fetchJson: client.fetchJson };
  }

  it('getProcessInstanceHistory chama GET /api/process-instances/:id/history', async () => {
    const { getProcessInstanceHistory, fetchJson } = await setup();
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, history: [] });

    const result = await getProcessInstanceHistory('exec-1');

    expect(fetchJson).toHaveBeenCalledWith('/api/process-instances/exec-1/history', {
      method: 'GET',
    });
    expect(result).toEqual({ ok: true, history: [] });
  });

  it('getProcessInstanceHistory inclui filtros opcionais na querystring', async () => {
    const { getProcessInstanceHistory, fetchJson } = await setup();
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, history: [] });

    await getProcessInstanceHistory('exec-1', {
      eventType: 'NODE_WAITING',
      nodeId: 'human-approval',
      limit: 10,
    });

    expect(fetchJson).toHaveBeenCalledWith('/api/process-instances/exec-1/history?eventType=NODE_WAITING&nodeId=human-approval&limit=10', {
      method: 'GET',
    });
  });
});
