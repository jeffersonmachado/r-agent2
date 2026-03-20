import { describe, it, expect } from 'vitest';
import { buildWebSocketUrl } from './wsUrl';

describe('wsUrl/buildWebSocketUrl', () => {
  it('usa VITE_API_BASE_URL quando definido', () => {
    const url = buildWebSocketUrl({
      env: {
        VITE_API_BASE_URL: 'https://api.exemplo.com/',
      },
      location: {
        href: 'http://localhost:5173/r-agent2/',
        pathname: '/r-agent2/',
        protocol: 'http:',
        host: 'localhost:5173',
        hostname: 'localhost',
        port: '5173',
      },
    });

    expect(url).toBe('wss://api.exemplo.com/ws');
  });

  it('usa porta de dev quando estiver em runtime Vite', () => {
    const url = buildWebSocketUrl({
      env: {
        VITE_API_BASE_URL: '',
        VITE_API_DEV_PORT: '4321',
      },
      location: {
        href: 'http://localhost:5173/',
        pathname: '/',
        protocol: 'http:',
        host: 'localhost:5173',
        hostname: 'localhost',
        port: '5173',
      },
    });

    expect(url).toBe('ws://localhost:4321/ws');
  });

  it('em produção usa host atual com prefixo detectado', () => {
    const url = buildWebSocketUrl({
      env: {
        VITE_API_BASE_URL: '',
      },
      location: {
        href: 'https://app.exemplo.com/r-agent2/dashboard',
        pathname: '/r-agent2/dashboard',
        protocol: 'https:',
        host: 'app.exemplo.com',
        hostname: 'app.exemplo.com',
        port: '',
      },
    });

    expect(url).toBe('wss://app.exemplo.com/r-agent2/ws');
  });

  it('faz fallback para /ws quando location nao estiver disponivel', () => {
    const url = buildWebSocketUrl({
      env: {
        VITE_API_BASE_URL: '',
      },
      location: null,
    });

    expect(url).toBe('/ws');
  });
});
