import { describe, expect, it } from 'vitest';
import {
  extractCurrentIndexBundlePath,
  extractIndexBundlePathFromHtml,
  shouldReloadForNewBundle,
} from './bundleVersionGuard';

describe('bundleVersionGuard helpers', () => {
  it('extrai o bundle index do html publicado', () => {
    const html = '<script type="module" src="/r-agent2/assets/index-DZz9JO1p.js"></script>';
    expect(extractIndexBundlePathFromHtml(html)).toBe('assets/index-DZz9JO1p.js');
  });

  it('extrai o bundle index atualmente carregado', () => {
    const sources = [
      'https://www.results.com.br/r-agent2/assets/vendor-123.js',
      'https://www.results.com.br/r-agent2/assets/index-D4P2xTMs.js?cache=old',
    ];
    expect(extractCurrentIndexBundlePath(sources)).toBe('assets/index-D4P2xTMs.js');
  });

  it('detecta quando a aba precisa recarregar para um bundle novo', () => {
    expect(shouldReloadForNewBundle('assets/index-D4P2xTMs.js', 'assets/index-DZz9JO1p.js')).toBe(true);
    expect(shouldReloadForNewBundle('assets/index-DZz9JO1p.js', 'assets/index-DZz9JO1p.js')).toBe(false);
  });
});
