'use strict';

/**
 * Fase 1 do LRO: schema autoritativo (lro_operations / lro_events / lro_outbox) provado em
 * PostgreSQL REAL e descartável, incluindo REVERSIBILIDADE da migration.
 *
 * Isolamento: banco próprio da suíte (`tests/helpers/suiteDatabase.js`), criado e destruído aqui.
 * Nunca toca o Postgres de desenvolvimento compartilhado. Se o isolamento não puder ser
 * estabelecido, a suíte falha fechado (`infraGate`) — não cai para banco compartilhado.
 */

const crypto = require('crypto');
const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let disponivel = false;
let motivo = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-core-schema',
    available: false,
    reason: motivo,
    requirement: 'postgres',
  });
}

const migrationCore = require('../../api/db/migrations/20261030120000-create-lro-core');
const migrationFeedback = require('../../api/db/migrations/20261030140000-create-lro-feedback');
const migrationClaimedAt = require('../../api/db/migrations/20261031150000-lro-outbox-claimed-at');

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-core');
  } catch (error) {
    motivo = `provisionamento de banco falhou: ${error.message}`;
    return;
  }
  if (!banco) {
    motivo = 'provisionamento indisponível (sem banco base acessível)';
    return;
  }
  try {
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    disponivel = Boolean(sequelize);
    if (!disponivel) motivo = 'sequelize não inicializou';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

async function tabelaExiste(nome) {
  const [rows] = await sequelize.query('SELECT to_regclass($1) AS existe', { bind: [nome] });
  return rows[0].existe !== null;
}

describe('LRO Fase 1 — schema durável e reversível', () => {
  test('as três tabelas existem depois das migrations canônicas', async () => {
    if (skipIfUnavailable()) return;
    expect(await tabelaExiste('public.lro_operations')).toBe(true);
    expect(await tabelaExiste('public.lro_events')).toBe(true);
    expect(await tabelaExiste('public.lro_outbox')).toBe(true);
  }, 60000);

  test('índice único por (operation_id, seq) existe — é o cursor do SSE', async () => {
    if (skipIfUnavailable()) return;
    const [rows] = await sequelize.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'lro_events' AND indexname = 'lro_events_operation_seq_uniq'",
    );
    expect(rows).toHaveLength(1);

    const opId = crypto.randomUUID();
    const models = require('../../api/db/models');
    await models.getLroOperation().create({
      id: opId, tenant_id: 'system', operation_type: 'qa_waves', visibility_class: 'DEVELOPMENT', status: 'QUEUED',
    });
    await models.getLroEvent().create({ operation_id: opId, seq: 1, type: 'QUEUED', payload: { a: 1 } });

    // Sequência repetida na MESMA operação é recusada pelo banco (não por convenção de app).
    await expect(
      models.getLroEvent().create({ operation_id: opId, seq: 1, type: 'RUNNING', payload: {} }),
    ).rejects.toThrow();
  }, 60000);

  test('migrations são REVERSÍVEIS em CASCATA (a ordem inversa é obrigatória por causa das FKs)', async () => {
    if (skipIfUnavailable()) return;
    const qi = sequelize.getQueryInterface();
    const Sequelize = sequelize.Sequelize || require('sequelize');

    // ACHADO 2026-10-30: reverter SÓ a migration core falha porque `lro_feedback_requests`
    // referencia `lro_operations`. Migração tem de ser revertida na ordem INVERSA à aplicação —
    // o teste passou a provar a cascata em vez de assumir que cada `down` é isolado.
    await migrationClaimedAt.down(qi, Sequelize);
    await migrationFeedback.down(qi, Sequelize);
    await migrationCore.down(qi, Sequelize);

    expect(await tabelaExiste('public.lro_feedback_responses')).toBe(false);
    expect(await tabelaExiste('public.lro_feedback_requests')).toBe(false);
    expect(await tabelaExiste('public.lro_operations')).toBe(false);
    expect(await tabelaExiste('public.lro_events')).toBe(false);
    expect(await tabelaExiste('public.lro_outbox')).toBe(false);

    await migrationCore.up(qi, Sequelize);
    await migrationFeedback.up(qi, Sequelize);
    await migrationClaimedAt.up(qi, Sequelize);

    expect(await tabelaExiste('public.lro_operations')).toBe(true);
    expect(await tabelaExiste('public.lro_feedback_requests')).toBe(true);
    expect(await tabelaExiste('public.lro_feedback_responses')).toBe(true);
  }, 120000);

  test('estado + evento + outbox são graváveis no mesmo fluxo', async () => {
    if (skipIfUnavailable()) return;
    const models = require('../../api/db/models');
    const opId = crypto.randomUUID();
    await models.getLroOperation().create({
      id: opId,
      tenant_id: 'system',
      operation_type: 'qa_waves',
      visibility_class: 'SUPPORT',
      status: 'RUNNING',
      progress_current: 2,
      progress_total: null, // total desconhecido ⇒ indeterminado, nunca 100%
      progress_unit: 'scenario',
    });
    await models.getLroEvent().create({ operation_id: opId, seq: 1, type: 'PROGRESS', payload: { current: 2 } });
    await models.getLroOutbox().create({
      operation_id: opId, event_id: null, topic: 'lro.events', payload: { seq: 1 }, available_at: new Date(),
    });

    const op = await models.getLroOperation().findByPk(opId);
    expect(op.status).toBe('RUNNING');
    expect(op.progress_total).toBeNull();
    expect(op.outcome).toBeNull();
    expect(op.fencing_token).toBe(0);
  }, 60000);
});
