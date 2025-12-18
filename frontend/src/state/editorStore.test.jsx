import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorProvider, useEditor } from './editorStore';

vi.mock('../api/flows', () => ({
  getFlow: vi.fn(),
  createFlow: vi.fn(),
  updateFlow: vi.fn(),
  validateFlow: vi.fn(),
  simulateFlow: vi.fn(),
}));

vi.mock('../engine-mapper/engineMapper', () => ({
  engineFlowToReteJson: vi.fn(),
  reteJsonToEngineFlow: vi.fn(),
  mapValidationErrorsToUi: vi.fn(),
}));

// eslint-disable-next-line import/first
import * as flowsApi from '../api/flows';
// eslint-disable-next-line import/first
import * as mapper from '../engine-mapper/engineMapper';

function TestComponent() {
  const {
    currentFlow,
    editorJson,
    validation,
    simulation,
    loadFlow,
    validateCurrentFlow,
    simulateCurrentFlow,
  } = useEditor();

  return (
    <div>
      <div data-testid="flow-id">{currentFlow ? currentFlow.id : ''}</div>
      <div data-testid="has-editor-json">
        {editorJson ? 'yes' : 'no'}
      </div>
      <div data-testid="validation-valid">
        {validation ? String(validation.valid) : ''}
      </div>
      <div data-testid="has-simulation">
        {simulation ? 'yes' : 'no'}
      </div>

      <button type="button" onClick={() => loadFlow('flow-1')}>
        load-flow
      </button>
      <button type="button" onClick={() => validateCurrentFlow()}>
        validate-flow
      </button>
      <button type="button" onClick={() => simulateCurrentFlow()}>
        simulate-flow
      </button>
    </div>
  );
}

describe('state/editorStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loadFlow carrega fluxo e popula currentFlow e editorJson', async () => {
    const flow = { id: 'flow-1', tenantId: 't', name: 'Flow 1', nodes: [] };
    flowsApi.getFlow.mockResolvedValue(flow);
    mapper.engineFlowToReteJson.mockReturnValue({ nodes: [], connections: [] });

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await userEvent.click(screen.getAllByText('load-flow')[0]);

    await waitFor(() => {
      const flowIdEls = screen.getAllByTestId('flow-id');
      const editorJsonEls = screen.getAllByTestId('has-editor-json');
      expect(flowIdEls[0].textContent).toBe('flow-1');
      expect(editorJsonEls[0].textContent).toBe('yes');
    });
  });

  it('validateCurrentFlow chama API e preenche validation', async () => {
    const flow = { id: 'flow-1', tenantId: 't', name: 'Flow 1', nodes: [] };
    flowsApi.getFlow.mockResolvedValue(flow);
    mapper.engineFlowToReteJson.mockReturnValue({ nodes: [], connections: [] });
    mapper.reteJsonToEngineFlow.mockReturnValue(flow);
    const validationResponse = { valid: true, errors: [] };
    flowsApi.validateFlow.mockResolvedValue(validationResponse);
    mapper.mapValidationErrorsToUi.mockReturnValue([]);

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await userEvent.click(screen.getAllByText('load-flow')[0]);

    await waitFor(() => {
      const flowIdEls = screen.getAllByTestId('flow-id');
      expect(flowIdEls[0].textContent).toBe('flow-1');
    });

    await userEvent.click(screen.getAllByText('validate-flow')[0]);

    await waitFor(() => {
      expect(flowsApi.validateFlow).toHaveBeenCalledTimes(1);
    });
  });

  it('simulateCurrentFlow chama API e preenche simulation', async () => {
    const flow = { id: 'flow-1', tenantId: 't', name: 'Flow 1', nodes: [] };
    flowsApi.getFlow.mockResolvedValue(flow);
    mapper.engineFlowToReteJson.mockReturnValue({ nodes: [], connections: [] });
    mapper.reteJsonToEngineFlow.mockReturnValue(flow);
    const simulationResponse = { steps: [] };
    flowsApi.simulateFlow.mockResolvedValue(simulationResponse);

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await userEvent.click(screen.getAllByText('load-flow')[0]);

    await waitFor(() => {
      const flowIdEls = screen.getAllByTestId('flow-id');
      expect(flowIdEls[0].textContent).toBe('flow-1');
    });

    await userEvent.click(screen.getAllByText('simulate-flow')[0]);

    await waitFor(() => {
      expect(flowsApi.simulateFlow).toHaveBeenCalledTimes(1);
    });
  });
});


