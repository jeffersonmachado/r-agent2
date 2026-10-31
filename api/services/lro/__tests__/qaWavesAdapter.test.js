'use strict';

/**
 * Adaptador do piloto QA Waves — contrato da flag e tradução de desfecho.
 *
 * Regra central: `LRO_QA_WAVES_MIRROR` off ⇒ o adaptador NÃO toca no serviço LRO (regressão zero no
 * motor existente). On ⇒ espelha criação/progresso/conclusão. Falha do espelho nunca propaga.
 */

jest.mock('../lroService', () => ({
  createOperation: jest.fn(),
  getOperation: jest.fn(),
  transition: jest.fn(),
  recordProgress: jest.fn(),
}));

const lroService = require('../lroService');
const adaptador = require('../qaWavesAdapter');

describe('adaptador LRO do QA Waves', () => {
  const envOriginal = process.env.LRO_QA_WAVES_MIRROR;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LRO_QA_WAVES_MIRROR;
    // Padrão: operação existente em QUEUED (não-terminal), para os fluxos de execução/conclusão.
    lroService.getOperation.mockResolvedValue({ id: 'op-x', status: 'QUEUED' });
  });

  afterAll(() => {
    if (envOriginal === undefined) delete process.env.LRO_QA_WAVES_MIRROR;
    else process.env.LRO_QA_WAVES_MIRROR = envOriginal;
  });

  test('flag OFF: nada é criado e nenhuma chamada ao serviço LRO', async () => {
    const id = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-1', scenarioIds: ['a'] });
    expect(id).toBeNull();
    expect(lroService.createOperation).not.toHaveBeenCalled();
    expect(lroService.transition).not.toHaveBeenCalled();
  });

  test('flag ON: cria operação DEVELOPMENT idempotente por execução e enfileira com total conhecido', async () => {
    process.env.LRO_QA_WAVES_MIRROR = '1';
    lroService.createOperation.mockResolvedValue({ id: 'op-1', status: 'CREATED' });
    lroService.transition.mockResolvedValue({ status: 'QUEUED' });

    const id = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-1', scenarioIds: ['a', 'b'] });

    expect(id).toBe('op-1');
    expect(lroService.createOperation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'system',
      operationType: 'qa_waves',
      visibilityClass: 'DEVELOPMENT',
      idempotencyKey: 'qa_waves:exec-1',
      correlationId: 'exec-1',
    }));
    expect(lroService.transition).toHaveBeenCalledWith('op-1', expect.objectContaining({
      to: 'QUEUED',
      context: expect.objectContaining({ progress: { current: 0, total: 2, unit: 'scenario' } }),
    }));
  });

  test('flag ON: escopo sem lista explícita deixa o total INDETERMINADO', async () => {
    process.env.LRO_QA_WAVES_MIRROR = '1';
    lroService.createOperation.mockResolvedValue({ id: 'op-2', status: 'CREATED' });
    lroService.transition.mockResolvedValue({});

    await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-2', scenarioIds: [] });

    expect(lroService.transition).toHaveBeenCalledWith('op-2', expect.objectContaining({
      context: expect.objectContaining({ progress: { current: 0, total: null, unit: 'scenario' } }),
    }));
  });

  test('conclusão: NO_GO vira COMPLETED com desfecho NO_GO (concluir não é aprovar)', async () => {
    process.env.LRO_QA_WAVES_MIRROR = '1';
    lroService.transition.mockResolvedValue({});

    await adaptador.finalizar('op-3', { goNoGo: 'NO_GO' });
    expect(lroService.transition).toHaveBeenCalledWith('op-3', expect.objectContaining({
      to: 'COMPLETED', context: { outcome: 'NO_GO' },
    }));

    lroService.transition.mockClear();
    await adaptador.finalizar('op-3', { goNoGo: null });
    expect(lroService.transition).toHaveBeenCalledWith('op-3', expect.objectContaining({
      to: 'COMPLETED', context: { outcome: 'INCONCLUSIVE' },
    }));
  });

  test('falha do espelho NÃO propaga (LRO é observador nesta fase)', async () => {
    process.env.LRO_QA_WAVES_MIRROR = '1';
    lroService.createOperation.mockRejectedValue(Object.assign(new Error('db down'), { code: 'DB_DOWN' }));

    await expect(adaptador.iniciar({ tenantId: 'system', executionId: 'exec-3' })).resolves.toBeNull();
    await expect(adaptador.finalizar('op-4', { goNoGo: 'GO' })).resolves.toBeUndefined();
  });

  test('falha SEM código ainda deixa causa no log (não só `code: null`)', async () => {
    // Defeito medido em 2026-10-31: um erro sem `.code` (ex.: "Sequelize não inicializado") produzia
    // apenas `{ code: null }` — o operador não tinha como saber o que falhou no espelho.
    process.env.LRO_QA_WAVES_MIRROR = '1';
    const logger = require('../../../utils/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    lroService.createOperation.mockRejectedValue(new Error('Sequelize não inicializado'));

    await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-5' });

    expect(warn).toHaveBeenCalledWith(
      '[lro:qa-waves] falha ao iniciar espelho',
      expect.objectContaining({ executionId: 'exec-5', code: null, error: 'Sequelize não inicializado' }),
    );
    warn.mockRestore();
  });
});
