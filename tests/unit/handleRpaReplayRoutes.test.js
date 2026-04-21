describe('handleRpaReplayRoutes', () => {
  function makeReq(overrides = {}) {
    return {
      url: '/tests/rpa/replay',
      tenantId: 'system',
      ...overrides,
    };
  }

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      sendJson: jest.fn(),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      path: require('path'),
      fs: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /tests/rpa/replay pagina diretório grande com leitura parcial dos arquivos', async () => {
    const { handleRpaReplayRoutes } = require('../../api/modules/rpa-tests/handleRpaReplayRoutes');

    const totalFiles = 600;
    const entries = Array.from({ length: totalFiles }, (_, index) => ({
      name: `replay-${String(index + 1).padStart(4, '0')}.json`,
      isFile: () => true,
    }));
    const readSync = jest.fn((fd, buffer, offset, length) => {
      const index = Number(fd);
      const body = JSON.stringify({
        id: `replay-${index}`,
        recordingId: `recording-${index}`,
        startTime: '2026-04-11T10:00:00.000Z',
        endTime: '2026-04-11T10:00:01.000Z',
        result: index % 2 === 0 ? 'success' : 'failed',
      });
      buffer.write(body, offset, Math.min(Buffer.byteLength(body), length), 'utf8');
      return Buffer.byteLength(body);
    });
    const fsMock = {
      existsSync: jest.fn((targetPath) => targetPath.endsWith('/tests/rpa/replay')),
      readdirSync: jest.fn(() => entries),
      statSync: jest.fn((filePath) => {
        const match = String(filePath).match(/replay-(\d+)\.json$/);
        const index = Number(match?.[1] || 0);
        const timestamp = new Date(Date.UTC(2026, 3, 11, 10, 0, Math.max(0, totalFiles - index)));
        return {
          size: 1024 + index,
          mtime: timestamp,
          birthtime: timestamp,
        };
      }),
      openSync: jest.fn((filePath) => Number(String(filePath).match(/replay-(\d+)\.json$/)?.[1] || 0)),
      readSync,
      closeSync: jest.fn(),
      readFileSync: jest.fn(() => {
        throw new Error('readFileSync não deve ser usado na listagem de replay');
      }),
    };
    const deps = makeDeps({ fs: fsMock });
    const res = {};

    const handled = await handleRpaReplayRoutes({
      req: makeReq({ url: '/tests/rpa/replay?limit=50&offset=50&sortBy=date&sortOrder=desc' }),
      res,
      method: 'GET',
      pathname: '/tests/rpa/replay',
      deps,
    });

    expect(handled).toBe(true);
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(readSync).toHaveBeenCalled();
    expect(readSync.mock.calls.every(([, , , length]) => length === 16 * 1024)).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledTimes(1);

    const [, statusCode, payload] = deps.sendJson.mock.calls[0];
    expect(statusCode).toBe(200);
    expect(payload.files).toHaveLength(50);
    expect(payload.pagination).toEqual({
      total: totalFiles,
      limit: 50,
      offset: 50,
      hasMore: true,
    });
    expect(payload.files[0]).toMatchObject({
      filename: 'replay-0051.json',
      recordingId: 'recording-51',
    });
  });
});