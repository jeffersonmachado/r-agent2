import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { InstallPwaPrompt } from './InstallPwaPrompt';

function dispatchBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt');
  event.prompt = vi.fn(async () => undefined);
  window.dispatchEvent(event);
  return event;
}

describe('components/InstallPwaPrompt', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  afterEach(() => {
    cleanup();
    delete window.matchMedia;
  });

  it('não renderiza nada antes do evento beforeinstallprompt', () => {
    render(<InstallPwaPrompt />);
    expect(screen.queryByTestId('install-pwa-prompt')).not.toBeInTheDocument();
  });

  it('exibe o prompt após beforeinstallprompt e dispara prompt() ao clicar em instalar', async () => {
    render(<InstallPwaPrompt />);

    let event;
    await act(async () => {
      event = dispatchBeforeInstallPrompt();
    });

    expect(screen.getByTestId('install-pwa-prompt')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Instalar app' }));
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('install-pwa-prompt')).not.toBeInTheDocument();
  });

  it('botão "Agora não" dispensa sem chamar prompt()', async () => {
    render(<InstallPwaPrompt />);

    let event;
    await act(async () => {
      event = dispatchBeforeInstallPrompt();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dispensar instalação' }));
    });

    expect(event.prompt).not.toHaveBeenCalled();
    expect(screen.queryByTestId('install-pwa-prompt')).not.toBeInTheDocument();
  });

  it('não registra listeners em modo standalone (app já instalado)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<InstallPwaPrompt />);

    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(screen.queryByTestId('install-pwa-prompt')).not.toBeInTheDocument();
  });

  it('some após appinstalled', async () => {
    render(<InstallPwaPrompt />);

    await act(async () => {
      dispatchBeforeInstallPrompt();
    });
    expect(screen.getByTestId('install-pwa-prompt')).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByTestId('install-pwa-prompt')).not.toBeInTheDocument();
  });
});
