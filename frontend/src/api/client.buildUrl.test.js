import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBasePathMock = vi.fn();

vi.mock('../utils/index', () => ({
  getBasePath: getBasePathMock,
  redirectToLogin: vi.fn(),
}));

vi.mock('./auth', () => ({
  getAuthHeaders: vi.fn(() => ({})),
  removeToken: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function setWindowLocation({ href, pathname, port = '', hostname = 'localhost' }) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href,
      pathname,
      port,
      hostname,
    },
  });
}

describe('api/client buildApiUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', '');
    getBasePathMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('nao trata a rota atual como base path da API', async () => {
    getBasePathMock.mockReturnValue('');
    setWindowLocation({
      href: 'http://localhost:15173/bpmn-editor',
      pathname: '/bpmn-editor',
      port: '15173',
    });

    const { buildApiUrl } = await import('./client');

    expect(buildApiUrl('/auth/me')).toBe('/auth/me');
  });

  it('prefixa com o base path real da aplicacao quando ele existe', async () => {
    getBasePathMock.mockReturnValue('/r-agent2');
    setWindowLocation({
      href: 'https://example.test/r-agent2/bpmn-editor',
      pathname: '/r-agent2/bpmn-editor',
      hostname: 'example.test',
    });

    const { buildApiUrl } = await import('./client');

    expect(buildApiUrl('/auth/me')).toBe('/r-agent2/auth/me');
  });
});