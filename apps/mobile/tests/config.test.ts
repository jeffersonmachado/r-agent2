import { DEFAULT_API_BASE_URL, DEFAULT_API_PORT, resolveApiBaseUrl, resolveApiBaseUrlWithMeta } from '../src/config';

describe('config', () => {
  it('usa EXPO_PUBLIC_API_BASE_URL quando definida', () => {
    expect(resolveApiBaseUrl({ envBaseUrl: '  https://api.exemplo.com/ ' })).toBe('https://api.exemplo.com');
  });

  it('usa host do Metro automaticamente em dispositivo físico', () => {
    expect(
      resolveApiBaseUrl({
        platform: 'android',
        isPhysicalDevice: true,
        packagerHost: '192.168.0.55:8081',
      }),
    ).toBe(`http://192.168.0.55:${DEFAULT_API_PORT}`);
  });

  it('expõe metadados da origem quando usa host do Metro', () => {
    expect(
      resolveApiBaseUrlWithMeta({
        platform: 'android',
        isPhysicalDevice: true,
        packagerHost: '192.168.0.55:8081',
      }),
    ).toEqual({
      baseUrl: `http://192.168.0.55:${DEFAULT_API_PORT}`,
      source: 'metro-host',
      port: DEFAULT_API_PORT,
      detectedHost: '192.168.0.55',
    });
  });

  it('usa 10.0.2.2 no emulador Android quando não há host do Metro', () => {
    expect(
      resolveApiBaseUrl({
        platform: 'android',
        isPhysicalDevice: false,
      }),
    ).toBe(`http://10.0.2.2:${DEFAULT_API_PORT}`);
  });

  it('usa localhost no simulador iOS quando não há host do Metro', () => {
    expect(
      resolveApiBaseUrl({
        platform: 'ios',
        isPhysicalDevice: false,
      }),
    ).toBe(`http://127.0.0.1:${DEFAULT_API_PORT}`);
  });

  it('permite sobrescrever a porta com EXPO_PUBLIC_API_PORT', () => {
    expect(
      resolveApiBaseUrl({
        platform: 'android',
        isPhysicalDevice: false,
        envPort: '4000',
      }),
    ).toBe('http://10.0.2.2:4000');
  });
});
