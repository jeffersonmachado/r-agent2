'use strict';

/**
 * DIVERGÊNCIA DE CONTRATO MEDIDA (2026-10-31, validação com stack real):
 *
 *   GET /api/lro      -> itens em camelCase (`progressCurrent`, `visibilityClass`, ...)
 *   GET /api/lro/:id  -> `{ operation }` com o plain do Sequelize (snake_case: `progress_current`,
 *                        `visibility_class`, ...)
 *
 * O consumidor natural do detalhe (a UI DEVELOPMENT de operações, exigida pelo mandato §9) lê
 * `operation.progressCurrent` e recebia `undefined`. Pior: a própria rota de detalhe AUTORIZA por
 * `operacao.visibility_class` — ou seja, a API dependia do shape snake_case enquanto a lista devolvia
 * camelCase: dois contratos para a mesma entidade.
 *
 * Este teste fixa UM contrato: detalhe e item de lista compartilham nomes e valores.
 */

const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let disponivel = false;
let motivo = null;
let lro = null;
let opId = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-contract', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-contract');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    disponivel = Boolean(sequelize && lro);
    if (!disponivel) motivo = 'sequelize/lroService não inicializou';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

describe('lro: contrato único entre lista e detalhe', () => {
  test('prepara operação em RUNNING com progresso', async () => {
    if (skipIfUnavailable()) return;
    const op = await lro.createOperation({
      tenantId: 'system',
      operationType: 'qa_waves',
      visibilityClass: 'DEVELOPMENT',
      ownerActorId: 'jest',
      correlationId: 'corr-contract',
      idempotencyKey: 'contract:1',
    });
    opId = op.id;
    await lro.transition(opId, { to: 'QUEUED', actorId: 'jest', context: { phase: 'queued' } });
    await lro.transition(opId, { to: 'RUNNING', actorId: 'jest', context: { phase: 'execution' } });
    await lro.recordProgress(opId, { current: 2, total: 5, unit: 'scenario', messageCode: 'QA_WAVES_PROGRESS' });
  }, 60000);

  test('detalhe expõe os MESMOS nomes e valores do item de lista', async () => {
    if (skipIfUnavailable()) return;
    const detalhe = await lro.getOperation(opId, { tenantId: 'system' });
    const lista = await lro.listOperations({ tenantId: 'system', limit: 5 });
    const item = lista.find((o) => o.id === opId);

    expect(item).toBeDefined();
    for (const campo of ['visibilityClass', 'operationType', 'progressCurrent', 'progressTotal', 'progressUnit', 'messageCode', 'status']) {
      expect(detalhe).toHaveProperty(campo);
      expect(detalhe[campo]).toEqual(item[campo]);
    }
  }, 60000);

  test('detalhe não expõe snake_case cru (dois contratos para a mesma entidade)', async () => {
    if (skipIfUnavailable()) return;
    const detalhe = await lro.getOperation(opId, { tenantId: 'system' });

    expect(detalhe.progress_current).toBeUndefined();
    expect(detalhe.visibility_class).toBeUndefined();
  }, 60000);

  test('mantém os campos de controle que orquestração e recuperação consomem', async () => {
    if (skipIfUnavailable()) return;
    const detalhe = await lro.getOperation(opId, { tenantId: 'system' });

    for (const campo of ['version', 'fencingToken', 'leaseOwner', 'leaseExpiresAt', 'checkpointRef', 'idempotencyKey', 'correlationId', 'retentionPolicy']) {
      expect(detalhe).toHaveProperty(campo);
    }
  }, 60000);

  test('tenant errado não enxerga o detalhe', async () => {
    if (skipIfUnavailable()) return;
    await expect(lro.getOperation(opId, { tenantId: 'outro-tenant' })).rejects.toMatchObject({
      code: 'OPERATION_NOT_FOUND',
    });
  }, 60000);
});
