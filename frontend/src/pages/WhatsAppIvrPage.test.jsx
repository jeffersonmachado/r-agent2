import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppIvrPage } from './WhatsAppIvrPage';

let webSocketHookArgs = null;

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

vi.mock('../api/whatsappIvr', () => ({
  getWhatsAppIvr: vi.fn(async () => ({
    value: { enabled: true, departments: [], rules: [] },
  })),
  updateWhatsAppIvr: vi.fn(),
  upsertWhatsAppIvrDepartment: vi.fn(),
  upsertWhatsAppIvrRule: vi.fn(),
}));

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: (args = {}) => {
    webSocketHookArgs = args;
    return {
    connected: true,
    authenticated: true,
    authFailed: false,
    };
  },
}));

describe('WhatsAppIvrPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webSocketHookArgs = null;
  });

  it('deve renderizar indicador de status do WebSocket', async () => {
    render(<WhatsAppIvrPage />);

    await waitFor(() => {
      expect(screen.getByText('💬 URA WhatsApp')).toBeInTheDocument();
      expect(screen.getByText('Conectado')).toBeInTheDocument();
    });
  });

  it('deve atualizar a tela ao receber evento websocket de ivr', async () => {
    render(<WhatsAppIvrPage />);

    await waitFor(() => {
      expect(webSocketHookArgs).not.toBeNull();
      expect(typeof webSocketHookArgs.onEvent).toBe('function');
      expect(screen.getByText('Nenhum departamento')).toBeInTheDocument();
      expect(screen.getByText('Nenhuma regra')).toBeInTheDocument();
    });

    act(() => {
      webSocketHookArgs.onEvent('whatsapp.ivr.updated', {
        value: {
          enabled: false,
          departments: [
            { id: 'd-1', name: 'Financeiro', queue: 'fila-financeiro', enabled: true },
          ],
          rules: [
            { id: 'r-1', keyword: 'boleto', departmentId: 'd-1', priority: 2, enabled: true },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Financeiro').length).toBeGreaterThan(0);
      expect(screen.getByText('fila-financeiro')).toBeInTheDocument();
      expect(screen.getByText('boleto')).toBeInTheDocument();
      expect(screen.getAllByText('Inativo').length).toBeGreaterThan(0);
    });
  });
});
