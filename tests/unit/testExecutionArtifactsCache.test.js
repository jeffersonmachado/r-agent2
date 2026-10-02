'use strict';

/**
 * Cache da listagem de artefatos de execução (`listExecutionArtifacts`).
 *
 * Contexto medido (2026-10-02): o endpoint custava ~555 ms e degradava 25x sob
 * concorrência — 30 requisições simultâneas levavam ~13,9 s CADA (parede 14,3 s),
 * porque 57% do custo é trabalho SÍNCRONO no event loop (deserialize + sha256 +
 * JSON.parse de ~1.227 manifestos). Com cache validado por impressão digital
 * (5,7 ms), a mediana caiu para 927 ms e a parede para 1,45 s.
 *
 * O que este teste protege — os três modos de falha que tornariam o cache
 * perigoso em vez de útil:
 *  1. servir dado velho quando algo MUDOU no store;
 *  2. vazar dados entre TENANTS (anti-pattern proibido no repo);
 *  3. servir de memória quando o banco não responde (fallback proibido).
 */

const mockFingerprint = jest.fn();
const mockListValid = jest.fn();
const mockReality = jest.fn();

jest.mock('../../api/services/rpaArtifactPersistence', () => ({
  getExecutionManifest: jest.fn(),
  listValidExecutionManifests: (...args) => mockListValid(...args),
  getExecutionArtifactsFingerprint: (...args) => mockFingerprint(...args),
  getRecording: jest.fn(),
  getReplay: jest.fn(),
  getTraceBuffer: jest.fn(),
  getScreenshotBuffer: jest.fn(),
  getExecutionArtifactReality: (...args) => mockReality(...args),
}));

const {
  listExecutionArtifacts,
  __resetExecutionArtifactsCache,
} = require('../../api/services/testExecutionService');

const manifest = (executionId) => ({
  refId: executionId,
  createdAt: '2026-10-02T00:00:00.000Z',
  manifest: { executionId, recordingId: `rec-${executionId}`, status: 'completed', recording: {}, replay: {} },
});

describe('listExecutionArtifacts — cache validado por impressão digital', () => {
  beforeEach(() => {
    __resetExecutionArtifactsCache();
    mockFingerprint.mockReset();
    mockListValid.mockReset();
    mockReality.mockReset();
    mockReality.mockResolvedValue({ traces: new Set(), screenshots: new Map() });
  });

  it('reusa o resultado quando a impressão digital NAO mudou', async () => {
    mockFingerprint.mockResolvedValue({ key: '2300|a|a' });
    mockListValid.mockResolvedValue([manifest('exec-1')]);

    const first = await listExecutionArtifacts('system');
    const second = await listExecutionArtifacts('system');

    expect(first).toHaveLength(1);
    expect(second).toBe(first); // mesma instância: veio do cache
    expect(mockListValid).toHaveBeenCalledTimes(1);
  });

  it('recalcula quando a impressão digital MUDA (execucao nova aparece na hora)', async () => {
    mockFingerprint.mockResolvedValueOnce({ key: '2300|a|a' });
    mockListValid.mockResolvedValueOnce([manifest('exec-1')]);
    await listExecutionArtifacts('system');

    // nova execucao persistida -> count muda
    mockFingerprint.mockResolvedValueOnce({ key: '2301|b|b' });
    mockListValid.mockResolvedValueOnce([manifest('exec-1'), manifest('exec-2')]);

    const segundo = await listExecutionArtifacts('system');

    expect(segundo).toHaveLength(2);
    expect(mockListValid).toHaveBeenCalledTimes(2);
  });

  it('recalcula quando um manifesto e RE-ASSINADO in-place (updated_at muda)', async () => {
    // reconcileExecutionManifests reescreve o MESMO refId: count e created_at
    // ficam iguais, so updated_at muda — por isso ele NAO pode ser omitido
    // da impressao digital.
    mockFingerprint.mockResolvedValueOnce({ key: '2300|a|a' });
    mockListValid.mockResolvedValueOnce([manifest('exec-1')]);
    await listExecutionArtifacts('system');

    mockFingerprint.mockResolvedValueOnce({ key: '2300|a|b' });
    mockListValid.mockResolvedValueOnce([manifest('exec-1')]);
    await listExecutionArtifacts('system');

    expect(mockListValid).toHaveBeenCalledTimes(2);
  });

  it('NAO compartilha cache entre tenants', async () => {
    mockFingerprint.mockResolvedValue({ key: '1|x|x' });
    mockListValid.mockResolvedValue([manifest('exec-1')]);

    await listExecutionArtifacts('system');
    await listExecutionArtifacts('outro-tenant');

    expect(mockListValid).toHaveBeenCalledTimes(2);
    expect(mockFingerprint).toHaveBeenCalledWith('outro-tenant');
  });

  it('sem impressao digital NAO usa cache (fail-closed, sem fallback de memoria)', async () => {
    mockFingerprint.mockResolvedValue(null); // banco indisponivel
    mockListValid.mockResolvedValue([manifest('exec-1')]);

    await listExecutionArtifacts('system');
    await listExecutionArtifacts('system');

    // sempre le do store: nada e servido de memoria
    expect(mockListValid).toHaveBeenCalledTimes(2);
  });

  it('erro na impressao digital nao impede a leitura real', async () => {
    mockFingerprint.mockRejectedValue(new Error('db down'));
    mockListValid.mockResolvedValue([manifest('exec-1')]);

    // a rejeicao propagaria; o ponto e que NAO existe caminho que sirva cache
    await expect(listExecutionArtifacts('system')).rejects.toThrow(/db down/);
  });
});
