import { useEffect } from 'react';
import {
  extractCurrentIndexBundlePath,
  extractIndexBundlePathFromHtml,
  shouldReloadForNewBundle,
} from '../utils/bundleVersionGuard';

const RELOAD_MARKER_KEY = 'bundle_version_guard_last_reload';

export function BundleVersionGuard() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function') {
      return undefined;
    }

    let cancelled = false;

    const verifyBundleVersion = async () => {
      const currentBundlePath = extractCurrentIndexBundlePath(
        Array.from(document.querySelectorAll('script[src]')).map((script) => script.src),
      );

      if (!currentBundlePath) return;

      try {
        const probeUrl = new URL(window.location.pathname || '/', window.location.origin);
        probeUrl.searchParams.set('__bundle_probe__', String(Date.now()));
        const response = await fetch(probeUrl.toString(), {
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
          },
        });
        const html = await response.text();
        if (cancelled) return;

        const latestBundlePath = extractIndexBundlePathFromHtml(html);
        if (!shouldReloadForNewBundle(currentBundlePath, latestBundlePath)) return;

        const reloadMarker = `${currentBundlePath}->${latestBundlePath}`;
        if (window.sessionStorage?.getItem(RELOAD_MARKER_KEY) === reloadMarker) return;

        window.sessionStorage?.setItem(RELOAD_MARKER_KEY, reloadMarker);
        window.location.reload();
      } catch {
        // Se a sonda falhar, mantém o app atual sem interromper o uso.
      }
    };

    verifyBundleVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
