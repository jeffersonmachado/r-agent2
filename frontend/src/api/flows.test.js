import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listFlows,
  getFlow,
  createFlow,
  updateFlow,
  validateFlow,
  simulateFlow,
  getReplay,
} from './flows';

vi.mock('./client', () => ({
  fetchJson: vi.fn(),
}));

// eslint-disable-next-line import/first
import { fetchJson } from './client';

describe('api/flows', () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it('listFlows chama /flows com GET', async () => {
    fetchJson.mockResolvedValue([]);

    const result = await listFlows();

    expect(fetchJson).toHaveBeenCalledWith('/flows', { method: 'GET' });
    expect(result).toEqual([]);
  });

  it('getFlow chama /flows/:id com GET', async () => {
    fetchJson.mockResolvedValue({ id: 'flow-1' });

    const result = await getFlow('flow-1');

    expect(fetchJson).toHaveBeenCalledWith('/flows/flow-1', { method: 'GET' });
    expect(result).toEqual({ id: 'flow-1' });
  });

  it('createFlow chama POST /flows com body', async () => {
    const flow = { id: 'new', nodes: [] };
    fetchJson.mockResolvedValue(flow);

    const result = await createFlow(flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(flow);
  });

  it('updateFlow chama PUT /flows/:id com body', async () => {
    const flow = { id: 'flow-1', nodes: [] };
    fetchJson.mockResolvedValue(flow);

    const result = await updateFlow('flow-1', flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows/flow-1', {
      method: 'PUT',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(flow);
  });

  it('validateFlow chama POST /flows/validate', async () => {
    const flow = { id: 'flow-1', nodes: [] };
    const validation = { valid: true, errors: [] };
    fetchJson.mockResolvedValue(validation);

    const result = await validateFlow(flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows/validate', {
      method: 'POST',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(validation);
  });

  it('simulateFlow chama POST /flows/simulate com flowId e options', async () => {
    const simulation = { steps: [] };
    fetchJson.mockResolvedValue(simulation);

    const result = await simulateFlow('flow-1', { maxSteps: 10 });

    expect(fetchJson).toHaveBeenCalledWith('/flows/simulate', {
      method: 'POST',
      body: JSON.stringify({ flowId: 'flow-1', maxSteps: 10 }),
    });
    expect(result).toEqual(simulation);
  });

  it('getReplay chama GET /replay/:sessionId', async () => {
    const replay = { messages: [] };
    fetchJson.mockResolvedValue(replay);

    const result = await getReplay('sess-1');

    expect(fetchJson).toHaveBeenCalledWith('/replay/sess-1', {
      method: 'GET',
    });
    expect(result).toEqual(replay);
  });
});


