import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationsPage } from './AutomationsPage';

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
  }),
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

const showToastMock = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
    ToastContainer: () => null,
  }),
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../api/automations', () => ({
  listAutomations: vi.fn(),
  upsertAutomation: vi.fn(),
  publishAutomation: vi.fn(),
  runAutomation: vi.fn(),
}));

vi.mock('../api/processRuntime', () => ({
  listProcessInstances: vi.fn(),
  getProcessInstance: vi.fn(),
  getProcessInstanceHistory: vi.fn(),
  cancelProcessInstance: vi.fn(),
  resumeProcessInstance: vi.fn(),
}));

import * as automationsApi from '../api/automations';
import * as processRuntimeApi from '../api/processRuntime';

describe('pages/AutomationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    automationsApi.listAutomations.mockResolvedValue({ automations: [] });
    processRuntimeApi.listProcessInstances.mockResolvedValue({
      items: [
        {
          executionId: 'exec-1',
          processId: 'flow-1',
          status: 'waiting',
          currentNodeId: 'human-approval',
        },
      ],
    });
  });

  it('renderiza detalhes operacionais da instância inspecionada', async () => {
    processRuntimeApi.getProcessInstance.mockResolvedValue({
      instance: {
        executionId: 'exec-1',
        processId: 'flow-1',
        status: 'waiting',
        currentNodeId: 'human-approval',
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T10:05:00.000Z',
      },
      waitingState: {
        type: 'message',
        correlationKey: 'ticket-123',
        payload: { channel: 'whatsapp' },
      },
      stopped: {
        reason: 'waiting_external_event',
        detail: 'Aguardando resposta humana',
      },
      path: ['start', 'task-ai-1', 'human-approval'],
      history: [],
    });
    processRuntimeApi.getProcessInstanceHistory.mockResolvedValue({
      history: [
        {
          sequence: 1,
          timestamp: '2026-03-12T10:00:10.000Z',
          eventType: 'PROCESS_STARTED',
          nodeId: 'start',
          status: 'completed',
          metadata: { processVersion: 1 },
        },
        {
          sequence: 2,
          timestamp: '2026-03-12T10:01:10.000Z',
          eventType: 'NODE_WAITING',
          nodeId: 'human-approval',
          status: 'waiting',
          metadata: { assignee: 'agent-1' },
        },
      ],
    });

    render(<AutomationsPage />);

    await waitFor(() => {
      expect(screen.getByText('exec-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Ver'));

    await waitFor(() => {
      expect(screen.getByText('Histórico operacional')).toBeInTheDocument();
      expect(screen.getByText('Estado de espera')).toBeInTheDocument();
      expect(screen.getByText('Parada / resumo')).toBeInTheDocument();
      expect(screen.getByText('waiting_external_event')).toBeInTheDocument();
      expect(screen.getByText('Aguardando resposta humana')).toBeInTheDocument();
      expect(screen.getByText('start -> task-ai-1 -> human-approval')).toBeInTheDocument();
      expect(screen.getByText('PROCESS_STARTED')).toBeInTheDocument();
      expect(screen.getByText('NODE_WAITING')).toBeInTheDocument();
      expect(screen.getByText('ticket-123')).toBeInTheDocument();
      expect(processRuntimeApi.getProcessInstanceHistory).toHaveBeenCalledWith('exec-1', {
        eventType: null,
        nodeId: null,
        limit: 50,
      });
    });
  });

  it('aplica filtros ao consultar histórico dedicado', async () => {
    processRuntimeApi.getProcessInstance.mockResolvedValue({
      instance: {
        executionId: 'exec-1',
        processId: 'flow-1',
        status: 'waiting',
      },
      waitingState: null,
      stopped: { reason: 'waiting' },
      path: [],
      history: [],
    });
    processRuntimeApi.getProcessInstanceHistory.mockResolvedValue({ history: [] });

    render(<AutomationsPage />);

    await waitFor(() => {
      expect(screen.getByText('exec-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Ver'));
    await waitFor(() => {
      expect(processRuntimeApi.getProcessInstanceHistory).toHaveBeenCalledWith('exec-1', {
        eventType: null,
        nodeId: null,
        limit: 50,
      });
    });

    await userEvent.clear(screen.getByPlaceholderText('eventType'));
    await userEvent.type(screen.getByPlaceholderText('eventType'), 'NODE_WAITING');
    await userEvent.clear(screen.getByPlaceholderText('nodeId'));
    await userEvent.type(screen.getByPlaceholderText('nodeId'), 'human-approval');
    await userEvent.clear(screen.getByPlaceholderText('limit'));
    await userEvent.type(screen.getByPlaceholderText('limit'), '10');
    await userEvent.click(screen.getByText('Aplicar filtros'));

    await waitFor(() => {
      expect(processRuntimeApi.getProcessInstanceHistory).toHaveBeenLastCalledWith('exec-1', {
        eventType: 'NODE_WAITING',
        nodeId: 'human-approval',
        limit: 10,
      });
    });
  });
});
