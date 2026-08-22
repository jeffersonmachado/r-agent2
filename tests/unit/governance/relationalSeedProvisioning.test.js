'use strict';

const {
  topologicalSort,
  buildSeedPlan,
  provisionSeedPlan,
  validateSeed,
} = require('../../../api/modules/agent-os/services/relational-seed-planner');

function fakeModel(name, attributes, associations = {}) {
  const created = [];
  return {
    name,
    rawAttributes: attributes,
    associations,
    created,
    async create(data) {
      const record = { ...data, id: data.id || `${name.toLowerCase()}-created-${created.length + 1}` };
      created.push(record);
      return record;
    },
  };
}

function parentChildModels() {
  const Parent = fakeModel('Parent', {
    id: { primaryKey: true, allowNull: false, type: 'UUID' },
    tenant_id: { allowNull: false, type: 'STRING' },
    name: { allowNull: false, unique: true, type: 'STRING' },
  });
  const Child = fakeModel('Child', {
    id: { primaryKey: true, allowNull: false, type: 'UUID' },
    tenant_id: { allowNull: false, type: 'STRING' },
    parent_id: {
      allowNull: false,
      type: 'UUID',
      references: { model: 'Parent', key: 'id' },
    },
    status: { allowNull: false, type: { values: ['active', 'disabled'] }, values: ['active', 'disabled'] },
  });
  Child.associations.Parent = {
    associationType: 'BelongsTo',
    target: Parent,
    foreignKey: 'parent_id',
  };
  return { Parent, Child };
}

describe('relational seed provisioning', () => {
  test('regressão topológica C→B→A provisiona A,B,C', () => {
    const { order, cycles } = topologicalSort(['C', 'B', 'A'], new Map([
      ['C', ['B']],
      ['B', ['A']],
      ['A', []],
    ]));

    expect(cycles).toEqual([]);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  test('cria parent, captura ID real e injeta na FK do child', async () => {
    const models = parentChildModels();
    const plan = buildSeedPlan([
      { modelName: 'Child', data: { tenant_id: 'tenant-1', status: 'active' } },
      { modelName: 'Parent', data: { tenant_id: 'tenant-1', name: 'parent-one' } },
    ], models, 'tenant-1');

    const result = await provisionSeedPlan(plan, models);

    expect(result.status).toBe('SEED_READY');
    expect(result.valid).toBe(true);
    expect(models.Parent.created).toHaveLength(1);
    expect(models.Child.created).toHaveLength(1);
    expect(models.Child.created[0].parent_id).toBe(models.Parent.created[0].id);
    expect(result.provisionedEntities.Parent.id).toBe(models.Parent.created[0].id);
    expect(result.provisionedEntities.Child.id).toBe(models.Child.created[0].id);
  });

  test('tenant inconsistente falha antes de criar qualquer entidade', async () => {
    const models = parentChildModels();
    const plan = buildSeedPlan([
      { modelName: 'Parent', data: { tenant_id: 'tenant-foreign', name: 'bad' } },
      { modelName: 'Child', data: { tenant_id: 'tenant-1', status: 'active' } },
    ], models, 'tenant-1');

    const result = await provisionSeedPlan(plan, models);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('SEED_INVALID');
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'SEED_TENANT_VIOLATION' }),
    ]));
    expect(models.Parent.created).toHaveLength(0);
    expect(models.Child.created).toHaveLength(0);
  });

  test('enum inválido e campo de schema desconhecido são rejeitados', () => {
    const models = parentChildModels();
    const result = validateSeed({
      id: 'child-1',
      tenant_id: 'tenant-1',
      parent_id: 'parent-1',
      status: 'invented',
      unknown_field: true,
    }, 'Child', models, 'tenant-1', {
      resolvedEntities: { Parent: { id: 'parent-1' } },
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'ENUM', field: 'status' }),
      expect.objectContaining({ check: 'SCHEMA', field: 'unknown_field' }),
    ]));
  });

  test('FK deve apontar ao ID realmente provisionado do target', () => {
    const models = parentChildModels();
    const result = validateSeed({
      id: 'child-1',
      tenant_id: 'tenant-1',
      parent_id: 'other-parent',
      status: 'active',
    }, 'Child', models, 'tenant-1', {
      resolvedEntities: { Parent: { id: 'parent-1' } },
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      check: 'FK_TARGET',
      field: 'parent_id',
      expected: 'parent-1',
      got: 'other-parent',
    }));
  });
});
