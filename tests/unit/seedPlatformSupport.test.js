jest.mock('../rpa/utils/rpaTokenManager', () => ({
  getOrCreateRpaToken: jest.fn(() => 'token-rpa-fixo'),
}));

const {
  buildSeedMatrix,
} = require('../rpa/seedPlatformSupport');

describe('seedPlatformSupport', () => {
  test('marca entradas funcionais como bloqueadas quando api/db não estão disponíveis', () => {
    const matrix = buildSeedMatrix({
      frontend: { reachable: true, url: 'http://localhost:5173' },
      api: { reachable: false, url: 'http://localhost:3001' },
      db: { reachable: false, host: 'localhost', port: 5432 },
      browser: { systemPath: null, candidates: [] },
    });

    const queueEntry = matrix.find((item) => item.seed === 'api:create-queues');
    expect(queueEntry.status).toBe('blocked');
    expect(queueEntry.blockers.join(' ')).toContain('API indisponível');
    expect(queueEntry.blockers.join(' ')).toContain('PostgreSQL indisponível');
  });

  test('marca smoke público de login como ready quando só o frontend está disponível', () => {
    const matrix = buildSeedMatrix({
      frontend: { reachable: true, url: 'http://localhost:5173' },
      api: { reachable: false, url: 'http://localhost:3001' },
      db: { reachable: false, host: 'localhost', port: 5432 },
      browser: { systemPath: null, candidates: [] },
    });

    const loginEntry = matrix.find((item) => item.seed === 'seed-platform-login.json');
    expect(loginEntry.status).toBe('ready');
  });
});
