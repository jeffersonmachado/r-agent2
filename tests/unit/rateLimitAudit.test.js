'use strict';

/**
 * Regressão de auditoria (achado 2026-08-03): auditEvent() em
 * infra/rate-limit/index.js reescrevia o arquivo JSON inteiro por request
 * (read-modify-write com cap de 1000 eventos) e era awaited no caminho do
 * request (checkRateLimit). Comportamento correto:
 * - formato append-only NDJSON: fs.appendFile, uma linha JSON por evento,
 *   sem leitura prévia nem stringify pretty nem rewrite do arquivo;
 * - fire-and-forget: checkRateLimit nunca espera a escrita de auditoria.
 */

const fs = require('fs').promises;

const logger = require('../../api/utils/logger');
const { auditEvent, checkRateLimit, clearLimitersCache } = require('../../infra/rate-limit');

describe('Rate Limit — auditoria append-only NDJSON e fire-and-forget', () => {
  let mkdirSpy;
  let appendSpy;
  let writeSpy;
  let readSpy;

  beforeEach(() => {
    mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    appendSpy = jest.spyOn(fs, 'appendFile').mockResolvedValue(undefined);
    writeSpy = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    readSpy = jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('readFile não deve ser chamado'));
    clearLimitersCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('auditEvent anexa uma linha NDJSON por evento, sem ler nem reescrever o arquivo', async () => {
    await auditEvent({
      userId: 'user-1',
      operationType: 'DRY_RUN',
      policy: { points: 50, duration: 60 },
      blocked: false,
      remainingPoints: 49,
      totalPoints: 50,
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();

    const [filePath, content] = appendSpy.mock.calls[0];
    expect(filePath).toMatch(/rate-limit-events\.json$/);
    expect(typeof content).toBe('string');
    expect(content.endsWith('\n')).toBe(true);
    // NDJSON: exatamente uma linha, JSON compacto (sem pretty print)
    expect(content.trim().split('\n')).toHaveLength(1);
    expect(content).not.toContain('\n  ');

    const event = JSON.parse(content);
    expect(event.userId).toBe('user-1');
    expect(event.operationType).toBe('DRY_RUN');
    expect(event.blocked).toBe(false);
    expect(event.remainingPoints).toBe(49);
    expect(event.timestamp).toBeDefined();
  });

  test('auditEvent nunca lança: falha de fs é apenas logada via logger central', async () => {
    appendSpy.mockRejectedValueOnce(new Error('disk full'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(auditEvent({ userId: 'u', operationType: 'DRY_RUN' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test('checkRateLimit não awaita a auditoria (fire-and-forget no caminho do request)', async () => {
    // Escrita de auditoria que nunca resolve: o request não pode ficar pendurado
    appendSpy.mockImplementation(() => new Promise(() => {}));

    const userId = `test-user-fire-and-forget-${Date.now()}-${Math.random()}`;
    const result = await checkRateLimit({ userId, operationType: 'DRY_RUN' });

    expect(result.allowed).toBe(true);

    // A escrita é agendada em background (sem await no request)
    await new Promise((resolve) => setImmediate(resolve));
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).toHaveBeenCalled();
  });
});
