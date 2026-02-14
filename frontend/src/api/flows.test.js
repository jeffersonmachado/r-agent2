import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Estes testes precisam isolar o módulo `./client` para evitar chamadas reais de rede
 * quando outros testes já carregaram o módulo antes deste arquivo.
 */

describe('api/flows', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setup() {
    vi.doMock('./client', () => ({
      fetchJson: vi.fn(),
    }));

    const flows = await import('./flows');
    const client = await import('./client');
    return { ...flows, fetchJson: client.fetchJson };
  }

  it('listFlows chama /flows com GET', async () => {
    const { listFlows, fetchJson } = await setup();
    const mockFetch = vi.mocked(fetchJson);
    mockFetch.mockResolvedValue([]);

    const result = await listFlows();

    expect(mockFetch).toHaveBeenCalled();
    const calls = mockFetch.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBe('/flows');
    expect(calls[0][1]).toMatchObject({ method: 'GET' });
    expect(result).toEqual([]);
  });

  it('getFlow chama /flows/:id com GET', async () => {
    const { getFlow, fetchJson } = await setup();
    vi.mocked(fetchJson).mockResolvedValue({ id: 'flow-1' });

    const result = await getFlow('flow-1');

    expect(fetchJson).toHaveBeenCalledWith('/flows/flow-1', { method: 'GET' });
    expect(result).toEqual({ id: 'flow-1' });
  });

  it('createFlow chama POST /flows com body', async () => {
    const { createFlow, fetchJson } = await setup();
    const flow = { id: 'new', nodes: [] };
    vi.mocked(fetchJson).mockResolvedValue(flow);

    const result = await createFlow(flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(flow);
  });

  it('updateFlow chama PUT /flows/:id com body', async () => {
    const { updateFlow, fetchJson } = await setup();
    const flow = { id: 'flow-1', nodes: [] };
    vi.mocked(fetchJson).mockResolvedValue(flow);

    const result = await updateFlow('flow-1', flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows/flow-1', {
      method: 'PUT',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(flow);
  });

  it('validateFlow chama POST /flows/validate', async () => {
    const { validateFlow, fetchJson } = await setup();
    const flow = { id: 'flow-1', nodes: [] };
    const validation = { valid: true, errors: [] };
    vi.mocked(fetchJson).mockResolvedValue(validation);

    const result = await validateFlow(flow);

    expect(fetchJson).toHaveBeenCalledWith('/flows/validate', {
      method: 'POST',
      body: JSON.stringify(flow),
    });
    expect(result).toEqual(validation);
  });

  it('simulateFlow chama POST /flows/simulate com flowId e options', async () => {
    const { simulateFlow, fetchJson } = await setup();
    const simulation = { steps: [] };
    vi.mocked(fetchJson).mockResolvedValue(simulation);

    const result = await simulateFlow('flow-1', { maxSteps: 10 });

    expect(fetchJson).toHaveBeenCalledWith('/flows/simulate', {
      method: 'POST',
      body: JSON.stringify({ flowId: 'flow-1', maxSteps: 10 }),
    });
    expect(result).toEqual(simulation);
  });

  it('generateFlowFromDescription usa timeout padrão 120s e inclui subflowMax/maxFixAttempts quando fornecidos', async () => {
    const { fetchJson } = await setup();
    const { generateFlowFromDescription } = await import('./flows');

    vi.mocked(fetchJson).mockResolvedValue({ success: true, flowDefinition: { id: 'f1', nodes: [] } });

    await generateFlowFromDescription('desc', {
      flowName: 'X',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
      subflowMax: 2,
      maxFixAttempts: 1,
    });

    expect(fetchJson).toHaveBeenCalled();
    const [path, init] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toBe('/flows/generate');
    expect(init.timeoutMs).toBe(120000);
    const body = JSON.parse(init.body);
    expect(body.subflowMax).toBe(2);
    expect(body.maxFixAttempts).toBe(1);
  });

  it('getReplay chama GET /replay/:sessionId', async () => {
    const { getReplay, fetchJson } = await setup();
    const replay = { messages: [] };
    vi.mocked(fetchJson).mockResolvedValue(replay);

    const result = await getReplay('sess-1');

    expect(fetchJson).toHaveBeenCalledWith('/replay/sess-1', {
      method: 'GET',
    });
    expect(result).toEqual(replay);
  });
});


