'use strict';

/**
 * Contrato de persistência da matrícula (AccessMembership).
 *
 * Contexto: a migration `20260318100000-vertical-beauty-fitness-core.js` adiciona
 * `due_date`, `renewal_at`, `grace_until` e `plan_type` em `access_memberships`, e
 * o domínio Fitness/Membership (`fitnessMembershipService`,
 * `billingOrchestrationService`) escreve e LÊ esses campos. Se o model Sequelize
 * não os declarar, o Sequelize descarta a escrita silenciosamente e a leitura
 * devolve `undefined` — a rota responde 200 e o dado nunca é persistido.
 *
 * Estes testes são a garantia mínima de que model, migration, serviço e contrato
 * declarado permanecem coerentes (o gate bloqueante equivalente é
 * `npm run validate:model-field-contracts`).
 */

const path = require('path');

const { introspectModels, createCapturingSequelize } = require('../../api/services/qa/inventory/modelAttributesIntrospector');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CONTRACT_PATH = path.join(REPO_ROOT, 'config', 'model-field-contracts.json');

const EXTENDED_MEMBERSHIP_FIELDS = ['due_date', 'renewal_at', 'grace_until', 'plan_type'];

describe('AccessMembership — contrato de persistência', () => {
  let models;

  beforeAll(() => {
    // O Jest usa registry próprio: substituímos o módulo sequelize via doMock e
    // injetamos o loader, reaproveitando a mesma regra de coleta do validador CLI.
    jest.resetModules();
    const captured = [];
    const fakeSequelize = createCapturingSequelize(captured);
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => fakeSequelize,
      connect: async () => fakeSequelize,
    }));
    const result = introspectModels({ loadModel: (abs) => require(abs), captured });
    expect(result.errors).toEqual([]);
    models = result.models;
  });

  it('o model declara os campos estendidos de billing escritos pelo domínio', () => {
    const model = models.AccessMembership;
    expect(model).toBeDefined();
    const columns = model.physicalColumns;
    for (const field of EXTENDED_MEMBERSHIP_FIELDS) {
      expect(columns).toContain(field);
    }
  });

  it('o model preserva os campos base já existentes', () => {
    const columns = models.AccessMembership.physicalColumns;
    for (const field of [
      'id', 'tenant_key', 'subject_id', 'customer_id', 'vertical', 'plan_name',
      'billing_status', 'status', 'unit_scope', 'start_at', 'end_at', 'metadata',
    ]) {
      expect(columns).toContain(field);
    }
  });

  it('o contrato declarado cobre exatamente os campos estendidos do model de matrícula', () => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const contract = require(CONTRACT_PATH);
    const entry = contract.AccessMembership;
    expect(entry).toBeDefined();
    expect(entry.table).toBe('access_memberships');
    const declared = Object.keys(entry.persistedFields || {});
    for (const field of EXTENDED_MEMBERSHIP_FIELDS) {
      expect(declared).toContain(field);
    }
    // Todo campo declarado no contrato precisa existir no model (fonte de verdade).
    for (const field of declared) {
      expect(models.AccessMembership.physicalColumns).toContain(field);
    }
  });
});

describe('fitnessMembershipService.updateMembershipDetails', () => {
  const tenantId = 'tenant-a';
  const membershipId = 'mem-1';

  let rowUpdate;
  let service;
  let mockRow;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
    mockRow = {
      id: membershipId,
      tenant_key: tenantId,
      billing_status: 'active',
      update: null,
    };
    rowUpdate = jest.fn(async (patch) => Object.assign(mockRow, patch));
    mockRow.update = rowUpdate;

    const findOne = jest.fn(async () => mockRow);
    jest.doMock('../../api/db/models', () => ({
      AccessMembership: () => ({ findOne, findAll: jest.fn(async () => []) }),
      AccessSubject: () => ({}),
    }));
    // eslint-disable-next-line global-require
    service = require('../../api/services/vertical/fitnessMembershipService');
  });

  afterEach(() => {
    jest.dontMock('../../api/db/models');
    jest.dontMock('../../api/db/sequelize');
  });

  it('exporta a allowlist de campos persistíveis (fonte única para rota e contrato)', () => {
    expect(Array.isArray(service.UPDATABLE_MEMBERSHIP_FIELDS)).toBe(true);
    for (const field of EXTENDED_MEMBERSHIP_FIELDS) {
      expect(service.UPDATABLE_MEMBERSHIP_FIELDS).toContain(field);
    }
  });

  it('persiste os campos permitidos no row', async () => {
    const dueDate = '2026-10-10T00:00:00.000Z';
    const result = await service.updateMembershipDetails({
      tenantId,
      membershipId,
      fields: { due_date: dueDate, renewal_at: dueDate, grace_until: dueDate, plan_type: 'premium' },
    });

    expect(rowUpdate).toHaveBeenCalledTimes(1);
    const patch = rowUpdate.mock.calls[0][0];
    expect(new Date(patch.due_date).toISOString()).toBe(dueDate);
    expect(patch.plan_type).toBe('premium');
    expect(result).not.toBeNull();
  });

  it('rejeita campo desconhecido em vez de descartar silenciosamente', async () => {
    await expect(service.updateMembershipDetails({
      tenantId,
      membershipId,
      fields: { due_date: '2026-10-10T00:00:00.000Z', not_a_field: 'x' },
    })).rejects.toMatchObject({ code: 'invalid_membership_fields' });

    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it('rejeita campo permitido com payload vazio em vez de responder sucesso sem escrita', async () => {
    await expect(service.updateMembershipDetails({ tenantId, membershipId, fields: {} }))
      .rejects.toMatchObject({ code: 'no_fields_to_update' });
  });

  it('rejeita data inválida com validação explícita', async () => {
    await expect(service.updateMembershipDetails({
      tenantId,
      membershipId,
      fields: { due_date: 'nao-e-data' },
    })).rejects.toMatchObject({ code: 'invalid_field_value' });

    expect(rowUpdate).not.toHaveBeenCalled();
  });
});
