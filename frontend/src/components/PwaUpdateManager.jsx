import { useEffect, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useToast } from './Toast';

const UPDATE_SNOOZE_MINUTES = 10;
const UPDATE_DISMISS_SNOOZE_MINUTES = 2;
const UPDATE_SNOOZE_KEY = 'pwa_update_snooze_until';
const OFFLINE_READY_SHOWN_KEY = 'pwa_offline_ready_shown_session';
const INSTALL_SHOWN_KEY = 'pwa_install_toast_shown_session';
const INSTALL_COOLDOWN_KEY = 'pwa_install_toast_cooldown_until';
const IOS_HINT_SHOWN_KEY = 'pwa_ios_hint_shown_session';
const IOS_HINT_COOLDOWN_KEY = 'pwa_ios_hint_cooldown_until';
const INSTALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let swRegistrationStarted = false;
let updateToastVisible = false;
let installToastVisible = false;
let iosToastVisible = false;

function isDebugPwaEnabled() {
  return import.meta.env.DEV || import.meta.env.VITE_DEBUG_PWA === 'true' || import.meta.env.DEBUG_PWA === 'true';
}

function logPwaDebug(message, data = null) {
  if (!isDebugPwaEnabled()) return;
  if (data) {
    console.log(`[PWA] ${message}`, data);
    return;
  }
  console.log(`[PWA] ${message}`);
}

function readTimestamp(storage, key) {
  if (!storage) return 0;
  const raw = storage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function setCooldown(storage, key, ms) {
  if (!storage) return;
  storage.setItem(key, String(Date.now() + ms));
}

function isCooldownActive(storage, key) {
  const until = readTimestamp(storage, key);
  return until > Date.now();
}

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false;
  const iosStandalone = window.navigator && window.navigator.standalone === true;
  return mediaStandalone || iosStandalone;
}

function isIosSafariLike() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  if (!isIos) return false;
  const isCriOS = ua.includes('crios');
  const isFxiOS = ua.includes('fxios');
  return !isCriOS && !isFxiOS;
}

export function PwaUpdateManager() {
  const { showToast } = useToast();
  const deferredInstallPromptRef = useRef(null);
  const updateSWRef = useRef(() => Promise.resolve());

  useEffect(() => {
    const shouldRegisterPwa = import.meta.env.PROD || import.meta.env.VITE_ENABLE_PWA_DEV === 'true';
    if (!shouldRegisterPwa) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (swRegistrationStarted) return;

    swRegistrationStarted = true;
    logPwaDebug('Inicializando registro do Service Worker', {
      baseUrl: import.meta.env.BASE_URL,
      prod: import.meta.env.PROD,
    });

    const maybeShowInstallToast = () => {
      if (installToastVisible) return;
      if (!deferredInstallPromptRef.current) return;
      if (isStandaloneMode()) return;

      const sessionStorage = window.sessionStorage;
      const localStorage = window.localStorage;
      if (sessionStorage?.getItem(INSTALL_SHOWN_KEY) === '1') return;
      if (isCooldownActive(localStorage, INSTALL_COOLDOWN_KEY)) return;

      installToastVisible = true;
      sessionStorage?.setItem(INSTALL_SHOWN_KEY, '1');
      showToast('Instalar aplicativo', 'info', {
        duration: 0,
        dismissLabel: 'Fechar aviso de instalação',
        onDismiss: () => {
          installToastVisible = false;
          setCooldown(localStorage, INSTALL_COOLDOWN_KEY, INSTALL_COOLDOWN_MS);
        },
        actions: [
          {
            label: 'Instalar',
            variant: 'primary',
            onClick: async () => {
              const deferred = deferredInstallPromptRef.current;
              deferredInstallPromptRef.current = null;
              if (!deferred) {
                installToastVisible = false;
                return;
              }
              try {
                await deferred.prompt();
                const choice = await deferred.userChoice;
                logPwaDebug('Resultado do beforeinstallprompt', choice);
              } catch (error) {
                console.error('Erro ao exibir prompt de instalação PWA:', error);
              } finally {
                installToastVisible = false;
              }
            },
          },
          {
            label: 'Agora não',
            variant: 'default',
            onClick: () => {
              installToastVisible = false;
              setCooldown(localStorage, INSTALL_COOLDOWN_KEY, INSTALL_COOLDOWN_MS);
            },
          },
        ],
      });
    };

    const maybeShowIosHintToast = () => {
      if (!isIosSafariLike()) return;
      if (isStandaloneMode()) return;
      if (iosToastVisible) return;

      const sessionStorage = window.sessionStorage;
      const localStorage = window.localStorage;
      if (sessionStorage?.getItem(IOS_HINT_SHOWN_KEY) === '1') return;
      if (isCooldownActive(localStorage, IOS_HINT_COOLDOWN_KEY)) return;

      iosToastVisible = true;
      sessionStorage?.setItem(IOS_HINT_SHOWN_KEY, '1');
      showToast('Para instalar no iOS: Compartilhar → Adicionar à Tela de Início.', 'info', {
        duration: 12000,
        dismissLabel: 'Fechar dica de instalação iOS',
        onDismiss: () => {
          iosToastVisible = false;
          setCooldown(localStorage, IOS_HINT_COOLDOWN_KEY, INSTALL_COOLDOWN_MS);
        },
        actions: [
          {
            label: 'Entendi',
            variant: 'default',
            onClick: () => {
              iosToastVisible = false;
              setCooldown(localStorage, IOS_HINT_COOLDOWN_KEY, INSTALL_COOLDOWN_MS);
            },
          },
        ],
      });
    };

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      deferredInstallPromptRef.current = event;
      logPwaDebug('beforeinstallprompt capturado');
      maybeShowInstallToast();
    };

    const onAppInstalled = () => {
      deferredInstallPromptRef.current = null;
      installToastVisible = false;
      iosToastVisible = false;
      logPwaDebug('Evento appinstalled recebido');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        logPwaDebug('onNeedRefresh disparado');
        if (updateToastVisible) return;
        if (isCooldownActive(window.sessionStorage, UPDATE_SNOOZE_KEY)) return;

        updateToastVisible = true;
        showToast('Nova versão disponível.', 'info', {
          duration: 0,
          dismissLabel: 'Fechar aviso de atualização',
          onDismiss: () => {
            updateToastVisible = false;
            setCooldown(window.sessionStorage, UPDATE_SNOOZE_KEY, UPDATE_DISMISS_SNOOZE_MINUTES * 60 * 1000);
          },
          actions: [
            {
              label: 'Atualizar agora',
              variant: 'primary',
              onClick: async () => {
                try {
                  await updateSW(true);
                  window.location.reload();
                } catch (error) {
                  console.error('Erro ao aplicar atualização da PWA:', error);
                } finally {
                  updateToastVisible = false;
                }
              },
            },
            {
              label: 'Depois',
              variant: 'default',
              onClick: () => {
                setCooldown(window.sessionStorage, UPDATE_SNOOZE_KEY, UPDATE_SNOOZE_MINUTES * 60 * 1000);
                updateToastVisible = false;
              },
            },
          ],
        });
      },
      onOfflineReady() {
        logPwaDebug('onOfflineReady disparado');
        if (window.sessionStorage?.getItem(OFFLINE_READY_SHOWN_KEY) === '1') return;
        window.sessionStorage?.setItem(OFFLINE_READY_SHOWN_KEY, '1');
        showToast('Disponível offline.', 'success', 5000);
      },
      onRegistered(registration) {
        updateSWRef.current = updateSW;
        logPwaDebug('Service Worker registrado', {
          scope: registration?.scope || null,
        });
        maybeShowIosHintToast();
        maybeShowInstallToast();
      },
      onRegisterError(error) {
        console.error('Erro ao registrar Service Worker:', error);
      },
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      deferredInstallPromptRef.current = null;
      updateSWRef.current = () => Promise.resolve();
    };
  }, [showToast]);

  return null;
}
