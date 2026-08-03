/**
 * Teste do throttle de persistência de last_activity_at no validateToken:
 * o cache em memória é atualizado a cada chamada (timeout de inatividade
 * intacto), mas o write no Postgres é limitado a 1x por minuto por sessão.
 */

require('../helpers/authDbMock');
const { mockAuthDatabase } = require('../helpers/authDbMock');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/services/planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true })),
}));

const { createAgent, login, validateToken } = require('../../api/services/authService');
const { mockModels } = mockAuthDatabase();

const flushImmediate = () => new Promise((resolve) => setImmediate(resolve));

describe('authService - throttle de last_activity_at', () => {
  test('persiste no DB no máximo 1x por minuto por sessão', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const t0 = new Date('2026-08-03T12:00:00.000Z');
      jest.setSystemTime(t0);

      const agentResult = await createAgent({
        tenantId: 'tenant-throttle',
        username: 'throttle-user',
        email: 'throttle@example.com',
        password: 'password123',
        role: 'agent',
      });
      expect(agentResult.success).toBe(true);

      const loginResult = await login('throttle-user', 'password123', '127.0.0.1', 'jest');
      expect(loginResult.success).toBe(true);
      const token = loginResult.token;

      const sessionRow = mockModels.Session.__rows.find((r) => r.token === token);
      expect(sessionRow).toBeDefined();
      const persistedAtLogin = sessionRow.last_activity_at;

      // Dentro da janela de 60s: memória atualizada, DB intocado
      jest.setSystemTime(new Date(t0.getTime() + 10 * 1000));
      expect(validateToken(token).valid).toBe(true);
      await flushImmediate();
      expect(sessionRow.last_activity_at).toEqual(persistedAtLogin);

      // Após 61s desde a última persistência: grava no DB
      jest.setSystemTime(new Date(t0.getTime() + 61 * 1000));
      expect(validateToken(token).valid).toBe(true);
      await flushImmediate();
      expect(sessionRow.last_activity_at).toEqual(new Date(t0.getTime() + 61 * 1000));

      // Nova validação imediata: throttle novamente
      jest.setSystemTime(new Date(t0.getTime() + 70 * 1000));
      expect(validateToken(token).valid).toBe(true);
      await flushImmediate();
      expect(sessionRow.last_activity_at).toEqual(new Date(t0.getTime() + 61 * 1000));
    } finally {
      jest.useRealTimers();
    }
  });
});
