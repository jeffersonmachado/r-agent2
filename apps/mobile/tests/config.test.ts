import { DEFAULT_API_BASE_URL, getApiBaseUrl } from '../src/config';

describe('config', () => {
  it('getApiBaseUrl usa default quando EXPO_PUBLIC_API_BASE_URL não está definida', () => {
  const previous = process.env.EXPO_PUBLIC_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_API_BASE_URL;

  try {
      expect(getApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  } finally {
    if (typeof previous === 'string') {
      process.env.EXPO_PUBLIC_API_BASE_URL = previous;
    } else {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    }
  }
  });

  it('getApiBaseUrl remove espaços e barra final da variável de ambiente', () => {
  const previous = process.env.EXPO_PUBLIC_API_BASE_URL;
  process.env.EXPO_PUBLIC_API_BASE_URL = '  https://api.exemplo.com/ ';

  try {
      expect(getApiBaseUrl()).toBe('https://api.exemplo.com');
  } finally {
    if (typeof previous === 'string') {
      process.env.EXPO_PUBLIC_API_BASE_URL = previous;
    } else {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    }
  }
  });
});
