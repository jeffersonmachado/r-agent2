/**
 * Testes do rate limit de handshakes WebSocket por cliente.
 *
 * Contexto: em 2026-09-30 um cliente (Electron/VS Code) ficou em loop de
 * reconexão (~12 conexões/min por horas) porque o servidor aceitava o upgrade e
 * só depois fechava conexões sem token válido (4401/4403). Este limite é a rede
 * de segurança: bloqueia o handshake com 429 antes de consumir recursos.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// O limite é opt-in (padrão 0 = desligado); aqui habilitamos para testar.
process.env.RATE_LIMIT_WS_POINTS = '6';

const websocketService = require('../../api/services/websocketService');

const DEFAULT_POINTS = Number.parseInt(process.env.RATE_LIMIT_WS_POINTS ?? '6', 10);

describe('websocketService - rate limit de handshakes', () => {
  const { resolveClientIp, isWsConnectRateLimited, wsConnectAttempts } = websocketService._internal;

  afterEach(() => {
    wsConnectAttempts.clear();
  });

  describe('resolveClientIp', () => {
    it('usa o primeiro IP do X-Forwarded-For (cliente atrás de proxy)', () => {
      const ip = resolveClientIp({
        headers: { 'x-forwarded-for': '187.38.100.201, 10.10.2.30' },
        socket: { remoteAddress: '10.10.2.30' },
      });
      expect(ip).toBe('187.38.100.201');
    });

    it('cai no endereço do socket quando não há X-Forwarded-For', () => {
      const ip = resolveClientIp({
        headers: {},
        socket: { remoteAddress: '10.10.2.50' },
      });
      expect(ip).toBe('10.10.2.50');
    });

    it('não quebra com requisição hostil', () => {
      expect(resolveClientIp(undefined)).toBe('unknown');
      expect(resolveClientIp({ headers: {}, socket: undefined })).toBe('unknown');
    });
  });

  describe('isWsConnectRateLimited', () => {
    it(`permite até ${DEFAULT_POINTS} handshakes por janela e bloqueia o excedente`, () => {
      const ip = '198.51.100.10';

      for (let i = 1; i <= DEFAULT_POINTS; i += 1) {
        expect(isWsConnectRateLimited(ip)).toBe(false);
      }

      expect(isWsConnectRateLimited(ip)).toBe(true);
      expect(isWsConnectRateLimited(ip)).toBe(true);
    });

    it('mantém contadores independentes por IP', () => {
      const abusive = '198.51.100.20';
      const healthy = '198.51.100.21';

      for (let i = 0; i <= DEFAULT_POINTS; i += 1) {
        isWsConnectRateLimited(abusive);
      }

      expect(isWsConnectRateLimited(abusive)).toBe(true);
      expect(isWsConnectRateLimited(healthy)).toBe(false);
    });
  });
});
