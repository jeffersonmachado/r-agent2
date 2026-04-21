jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const fs = require('fs');
const {
  resolveFrontendUrl,
  resolveApiUrl,
} = require('../../tools/rpa/run-all');

describe('rpa run-all URL resolution', () => {
  const originalEnv = { ...process.env };
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockImplementation(() => undefined);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('config ausente');
    });

    delete process.env.RPA_FRONTEND_URL;
    delete process.env.TEST_FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.RPA_API_URL;
    delete process.env.TEST_API_URL;
    delete process.env.TEST_BASE_URL;
    delete process.env.RPA_ALLOW_DEFAULT_URL_FALLBACK;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('prioriza frontend URL via variável de ambiente', () => {
    process.env.RPA_FRONTEND_URL = 'https://frontend.example';

    expect(resolveFrontendUrl()).toBe('https://frontend.example');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('usa API URL do config quando ambiente não está definido', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({
      urls: {
        api: 'https://api.example',
      },
    }));

    expect(resolveApiUrl()).toBe('https://api.example');
  });

  test('falha explicitamente quando frontend URL não está configurada', () => {
    expect(() => resolveFrontendUrl()).toThrow(
      'frontend URL não configurada'
    );
  });

  test('permite localhost apenas com fallback explícito habilitado', () => {
    process.env.RPA_ALLOW_DEFAULT_URL_FALLBACK = '1';

    expect(resolveFrontendUrl()).toBe('http://localhost:5173');
    expect(resolveApiUrl()).toBe('http://localhost:3000');
  });
});