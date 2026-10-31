'use strict';

/**
 * Piloto QA Waves × LRO com a flag LIGADA e PostgreSQL REAL (banco descartável).
 *
 * Os testes do adaptador (`api/services/lro/__tests__/qaWavesAdapter.test.js`) provam a tradução com
 * o serviço mockado. ESTE arquivo prova a integração de verdade: adaptador → serviço → tabelas →
 * eventos → outbox, e que a flag desligada não cria nada.
 */

const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let lro = null;
let adaptador = null;
let disponivel = false;
let motivo = null;
const envOriginal = process.env.LRO_QA_WAVES_MIRROR;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-qa-waves-mirror', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-qa-mirror');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    adaptador = require('../../api/services/lro/qaWavesAdapter');
    disponivel = Boolean(sequelize && lro && adaptador);
    if (!disponivel) motivo = 'serviços não inicializaram';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (envOriginal === undefined) delete process.env.LRO_QA_WAVES_MIRROR;
  else process.env.LRO_QA_WAVES_MIRROR = envOriginal;
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

describe('LRO × QA Waves — espelho real (flag ligada)', () => {
  test('flag OFF não cria operação alguma', async () => {
    if (skipIfUnavailable()) return;
    delete process.env.LRO_QA_WAVES_MIRROR;
    const models = require('../../api/db/models');
    const antes = await models.getLroOperation().count();
    const id = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-off', scenarioIds: ['a'] });
    expect(id).toBeNull();
    expect(await models.getLroOperation().count()).toBe(antes);
  }, 60000);

  test('flag ON espelha o ciclo completo: QUEUED → RUNNING → progresso → COMPLETED(NO_GO)', async () => {
    if (skipIfUnavailable()) return;
    process.env.LRO_QA_WAVES_MIRROR = '1';

    const executionId = 'exec-integracao-1';
    const operationId = await adaptador.iniciar({
      tenantId: 'system', executionId, scenarioIds: ['c1', 'c2', 'c3'],
    });
    expect(operationId).toBeTruthy();

    const aposInicio = await lro.getOperation(operationId);
    expect(aposInicio.status).toBe('QUEUED');
    expect(aposInicio.progressTotal).toBe(3);
    expect(aposInicio.visibilityClass).toBe('DEVELOPMENT');
    expect(aposInicio.correlationId).toBe(executionId);

    await adaptador.marcarExecutando(operationId);
    expect((await lro.getOperation(operationId)).status).toBe('RUNNING');

    await adaptador.progresso(operationId, { index: 1, total: 3 });
    await adaptador.progresso(operationId, { index: 2, total: 3 });

    // Conclusão com NO_GO: terminar NÃO é aprovar.
    await adaptador.finalizar(operationId, { goNoGo: 'NO_GO' });

    const final = await lro.getOperation(operationId);
    expect(final.status).toBe('COMPLETED');
    expect(final.outcome).toBe('NO_GO');

    const eventos = await lro.listEvents(operationId, { afterSeq: 0 });
    const tipos = eventos.map((e) => e.type);
    expect(tipos[0]).toBe('CREATED');
    expect(tipos).toContain('QUEUED');
    expect(tipos).toContain('RUNNING');
    expect(tipos.filter((t) => t === 'PROGRESS')).toHaveLength(2);
    expect(tipos[tipos.length - 1]).toBe('COMPLETED');

    const progresso = eventos.find((e) => e.type === 'PROGRESS');
    expect(progresso.payload).toMatchObject({ current: 1, total: 3, percent: 33, indeterminate: false });

    // Outbox alimentada em cada passo (publicação é etapa separada).
    const models = require('../../api/db/models');
    const naOutbox = await models.getLroOutbox().count({ where: { operation_id: operationId } });
    expect(naOutbox).toBeGreaterThanOrEqual(eventos.length);
  }, 120000);

  test('mesma execução espelhada duas vezes é IDEMPOTENTE (uma operação)', async () => {
    if (skipIfUnavailable()) return;
    process.env.LRO_QA_WAVES_MIRROR = '1';
    const models = require('../../api/db/models');

    const primeira = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-idem', scenarioIds: ['a'] });
    const segunda = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-idem', scenarioIds: ['a'] });
    expect(segunda).toBe(primeira);

    const total = await models.getLroOperation().count({ where: { idempotency_key: 'qa_waves:exec-idem' } });
    expect(total).toBe(1);
  }, 60000);

  test('erro no run finaliza como FAILED e registra o código', async () => {
    if (skipIfUnavailable()) return;
    process.env.LRO_QA_WAVES_MIRROR = '1';

    const operationId = await adaptador.iniciar({ tenantId: 'system', executionId: 'exec-erro', scenarioIds: ['a'] });
    await adaptador.marcarExecutando(operationId);
    await adaptador.finalizar(operationId, { errorCode: 'SANDBOX_INDISPONIVEL' });

    const final = await lro.getOperation(operationId);
    expect(final.status).toBe('FAILED');
    expect(final.errorCode).toBe('SANDBOX_INDISPONIVEL');
  }, 60000);
});
