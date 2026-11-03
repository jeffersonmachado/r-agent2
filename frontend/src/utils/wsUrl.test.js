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

  // DEFEITO MEDIDO 2026-10-31 (browser real em /dev/qa-waves): o resolvedor tratava o PRIMEIRO
  // SEGMENTO DO PATHNAME como prefixo de deployment. Servido na raiz, o pathname é a ROTA —
  // `/dev/qa-waves` virava `ws://host/dev/ws` e `/login` virava `ws://host/login/ws`, caminhos que
  // não existem (o servidor WS da API é `/ws`). Resultado: "WebSocket desconectado" em toda
  // instalação servida na raiz. O prefixo correto é o `base` do build (Vite `BASE_URL`).
  it('servido na RAIZ: rota não vira prefixo (usa /ws)', () => {
    const url = buildWebSocketUrl({
      env: { BASE_URL: '/', VITE_API_BASE_URL: '' },
      location: {
        href: 'http://127.0.0.1:5199/dev/qa-waves',
        pathname: '/dev/qa-waves',
        protocol: 'http:',
        host: '127.0.0.1:5199',
        hostname: '127.0.0.1',
        port: '5199',
      },
    });

    expect(url).toBe('ws://127.0.0.1:5199/ws');
  });

  it('servido na RAIZ em qualquer rota (login, workspace) → sempre /ws', () => {
    for (const pathname of ['/login', '/workspace', '/dev/rpa-replays']) {
      const url = buildWebSocketUrl({
        env: { BASE_URL: '/', VITE_API_BASE_URL: '' },
        location: {
          href: `http://127.0.0.1:5199${pathname}`,
          pathname,
          protocol: 'http:',
          host: '127.0.0.1:5199',
          hostname: '127.0.0.1',
          port: '5199',
        },
      });
      expect(url).toBe('ws://127.0.0.1:5199/ws');
    }
  });

  it('prefixo de deployment vem do BASE_URL do build (autoridade), não da rota', () => {
    const url = buildWebSocketUrl({
      env: { BASE_URL: '/r-agent2/', VITE_API_BASE_URL: '' },
      location: {
        href: 'https://app.exemplo.com/r-agent2/dev/qa-waves',
        pathname: '/r-agent2/dev/qa-waves',
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
