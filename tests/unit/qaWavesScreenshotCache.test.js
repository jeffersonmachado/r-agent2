'use strict';

describe('qaWavesService - cap do cache de screenshots', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('cache limita entradas e evita o mais antigo (FIFO)', () => {
    const { _internal } = require('../../api/services/qaWavesService');
    const { screenshotDataUrlCache, cacheScreenshotDataUrl, MAX_SCREENSHOT_CACHE_ENTRIES } = _internal;

    expect(MAX_SCREENSHOT_CACHE_ENTRIES).toBe(20);

    for (let i = 0; i < MAX_SCREENSHOT_CACHE_ENTRIES; i += 1) {
      cacheScreenshotDataUrl(`shot-${i}`, `data:image/png;base64,${i}`);
    }
    expect(screenshotDataUrlCache.size).toBe(MAX_SCREENSHOT_CACHE_ENTRIES);

    // 21ª entrada evicta a mais antiga (shot-0)
    cacheScreenshotDataUrl('shot-new', 'data:image/png;base64,new');

    expect(screenshotDataUrlCache.size).toBe(MAX_SCREENSHOT_CACHE_ENTRIES);
    expect(screenshotDataUrlCache.has('shot-0')).toBe(false);
    expect(screenshotDataUrlCache.has('shot-1')).toBe(true);
    expect(screenshotDataUrlCache.get('shot-new')).toBe('data:image/png;base64,new');
  });

  test('atualizar chave existente não evicta outras entradas', () => {
    const { _internal } = require('../../api/services/qaWavesService');
    const { screenshotDataUrlCache, cacheScreenshotDataUrl, MAX_SCREENSHOT_CACHE_ENTRIES } = _internal;

    for (let i = 0; i < MAX_SCREENSHOT_CACHE_ENTRIES; i += 1) {
      cacheScreenshotDataUrl(`shot-${i}`, null);
    }
    cacheScreenshotDataUrl('shot-0', 'data:image/png;base64,updated');

    expect(screenshotDataUrlCache.size).toBe(MAX_SCREENSHOT_CACHE_ENTRIES);
    expect(screenshotDataUrlCache.get('shot-0')).toBe('data:image/png;base64,updated');
    expect(screenshotDataUrlCache.has('shot-1')).toBe(true);
  });
});
