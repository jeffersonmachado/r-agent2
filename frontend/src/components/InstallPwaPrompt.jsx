import React, { useEffect, useState } from 'react';
import { Button } from '../styles/Button';

/**
 * Prompt de instalação do PWA (mobile-first).
 *
 * Só aparece quando o navegador emite `beforeinstallprompt` (critérios de
 * instalabilidade atendidos) e o app ainda não está rodando em modo
 * standalone. Ao aceitar, dispara o prompt nativo do navegador.
 */
export function InstallPwaPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true;
    if (isStandalone) return undefined;

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const handleInstalled = () => setDeferredPrompt(null);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (!deferredPrompt) return null;

  const handleInstall = async () => {
    const promptEvent = deferredPrompt;
    setDeferredPrompt(null);
    try {
      await promptEvent.prompt();
    } catch (_err) {
      // Usuário fechou o prompt nativo — sem ação adicional.
    }
  };

  return (
    <div
      className="install-pwa-prompt"
      data-testid="install-pwa-prompt"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'var(--surface-elevated, #1a1a1a)',
        border: '1px solid var(--border-color, #333)',
        borderRadius: '8px',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <span>Instale o app para responder mais rápido, mesmo offline.</span>
      <Button size="sm" onClick={handleInstall}>Instalar app</Button>
      <Button size="sm" variant="ghost" onClick={() => setDeferredPrompt(null)} aria-label="Dispensar instalação">
        Agora não
      </Button>
    </div>
  );
}

export default InstallPwaPrompt;
