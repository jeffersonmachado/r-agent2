/**
 * Testes do índice invertido pré-computado (configPath -> envVars) usado por
 * config.get: preserva a semântica exata de precedência (env > config file),
 * incluindo múltiplas envs mapeadas para o mesmo path.
 */

'use strict';

describe('config.get - lookup de env pré-computado', () => {
  const ENV_KEYS = [
    'FRONTEND_PORT',
    'NOTIFICATION_EMAIL_ENABLED',
    'RATE_LIMIT_REDIS_URL',
    'REDIS_URL',
  ];

  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function loadConfig() {
    return require('../../api/utils/config');
  }

  test('coage valor numérico de env', () => {
    process.env.FRONTEND_PORT = '5173';
    expect(loadConfig().get('frontend.port')).toBe(5173);
  });

  test('coage valor booleano de env', () => {
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    expect(loadConfig().get('notifications.email.enabled')).toBe(true);
  });

  test('múltiplas envs no mesmo path: a primeira da ordem do mapa vence', () => {
    process.env.RATE_LIMIT_REDIS_URL = 'redis://primary:6379';
    process.env.REDIS_URL = 'redis://secondary:6379';
    expect(loadConfig().get('rateLimit.redis.url')).toBe('redis://primary:6379');
  });

  test('múltiplas envs no mesmo path: fallback para a segunda quando a primeira não está definida', () => {
    process.env.REDIS_URL = 'redis://secondary:6379';
    expect(loadConfig().get('rateLimit.redis.url')).toBe('redis://secondary:6379');
  });

  test('env definida vence valor do config file (precedência env > file)', () => {
    process.env.FRONTEND_PORT = '9999';
    const config = loadConfig();
    // Independente do valor no arquivo, a env prevalece
    expect(config.get('frontend.port')).toBe(9999);
    expect(config.getFromFile('frontend.port')).not.toBe(9999);
  });

  test('path sem env mapeada e ausente no arquivo retorna default', () => {
    expect(loadConfig().get('path.inexistente.xyz', 'fallback')).toBe('fallback');
  });
});
