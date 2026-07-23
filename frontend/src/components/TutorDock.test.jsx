import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

let capturedOnEvent = null;
const mockNavigate = vi.fn();

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: ({ onEvent }) => {
    capturedOnEvent = onEvent;
    return { connected: true, authenticated: true };
  },
}));

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: mockNavigate, currentPath: '/inbox' }),
}));

import { TutorDock } from './TutorDock';

describe('TutorDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnEvent = null;
  });

  it('não renderiza nada sem hint', () => {
    const { container } = render(<TutorDock />);
    expect(container.firstChild).toBeNull();
  });

  it('exibe cartão ao receber tutor.hint via WebSocket', () => {
    render(<TutorDock />);
    act(() => {
      capturedOnEvent('tutor.hint', { route: '/inbox', hint: 'Dica contextual da tela.', level: 1 });
    });

    expect(screen.getByTestId('tutor-dock')).toBeTruthy();
    expect(screen.getByText('Dica contextual da tela.')).toBeTruthy();
    expect(screen.getByText('/inbox')).toBeTruthy();
  });

  it('ignora eventos de outro tipo ou sem hint', () => {
    const { container } = render(<TutorDock />);
    act(() => {
      capturedOnEvent('ticket.updated', { id: 1 });
      capturedOnEvent('tutor.hint', { route: '/inbox' });
    });
    expect(container.firstChild).toBeNull();
  });

  it('botão fechar descarta o cartão', () => {
    render(<TutorDock />);
    act(() => {
      capturedOnEvent('tutor.hint', { route: '/inbox', hint: 'Dica.', level: 1 });
    });
    fireEvent.click(screen.getByLabelText('Fechar dica'));
    expect(screen.queryByTestId('tutor-dock')).toBeNull();
  });

  it('link "Ver minha evolução" navega para /academy e fecha', () => {
    render(<TutorDock />);
    act(() => {
      capturedOnEvent('tutor.hint', { route: '/inbox', hint: 'Dica.', level: 1 });
    });
    fireEvent.click(screen.getByText('Ver minha evolução'));
    expect(mockNavigate).toHaveBeenCalledWith('/academy');
    expect(screen.queryByTestId('tutor-dock')).toBeNull();
  });
});
