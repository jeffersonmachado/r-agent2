'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanModels, classifyModel } = require('../../../api/services/qa/inventory/modelScanner');

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-models-'));
  const modelsDir = path.join(rootDir, 'api', 'db', 'models');
  fs.mkdirSync(modelsDir, { recursive: true });

  fs.writeFileSync(path.join(modelsDir, 'Foo.js'), `'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Foo = null;

function getFooModel() {
  if (!Foo) {
    const sequelize = getSequelize();
    Foo = sequelize.define('Foo', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.ENUM('active', 'paused', 'archived'), allowNull: false, defaultValue: 'active' },
      owner_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        references: { model: 'users', key: 'id' },
      },
    }, {
      tableName: 'foo_table',
      timestamps: true,
      indexes: [
        { fields: ['tenant_id', 'status'], name: 'foo_tenant_status_idx' },
      ],
    });
  }
  return Foo;
}

module.exports = getFooModel;
`);

  fs.writeFileSync(path.join(modelsDir, 'Bar.js'), `'use strict';
const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('Bar', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(255), allowNull: false },
}, {
  tableName: 'bars',
  timestamps: true,
});
`);

  fs.writeFileSync(path.join(modelsDir, 'helpers.js'), `'use strict';
module.exports = { createModelFactory: () => () => null };
`);

  return { rootDir, modelsDir };
}

describe('modelScanner', () => {
  let fixture;
  let result;

  beforeAll(() => {
    fixture = createFixtureRoot();
    result = scanModels({ modelsDir: fixture.modelsDir });
  });

  afterAll(() => {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  });

  it('descobre models com campos, tableName e tenant_id', () => {
    const model = result.items.find((item) => item.id === 'model:Foo');
    expect(model).toBeDefined();
    expect(model.tableName).toBe('foo_table');
    expect(model.hasTenantId).toBe(true);
    expect(model.fieldCount).toBe(4);

    const table = result.items.find((item) => item.id === 'table:foo_table');
    expect(table).toBeDefined();
    expect(table.indexes).toEqual([
      { fields: ['tenant_id', 'status'], name: 'foo_tenant_status_idx', unique: false },
    ]);
  });

  it('extrai tipos, enums, unique e primaryKey dos campos', () => {
    const status = result.items.find((item) => item.id === 'field:Foo.status');
    expect(status).toBeDefined();
    expect(status.type).toBe('ENUM');
    expect(status.enumValues).toEqual(['active', 'paused', 'archived']);
    expect(status.allowNull).toBe(false);
    expect(status.default).toBe("'active'");

    const id = result.items.find((item) => item.id === 'field:Foo.id');
    expect(id.primaryKey).toBe(true);

    const owner = result.items.find((item) => item.id === 'field:Foo.owner_id');
    expect(owner.unique).toBe(true);
  });

  it('emite itens de relação a partir de references', () => {
    const relation = result.items.find((item) => item.id === 'relation:Foo.owner_id->users.id');
    expect(relation).toBeDefined();
    expect(relation.kind).toBe('relation');
    expect(relation.references).toEqual({ model: 'users', key: 'id' });
  });

  it('suporta o padrão createModelFactory e mapeamento de coluna (field:)', () => {
    const bar = result.items.find((item) => item.id === 'model:Bar');
    expect(bar).toBeDefined();
    expect(bar.tableName).toBe('bars');
    expect(bar.hasTenantId).toBe(true); // tenantKey com field: 'tenant_key'
  });

  it('ignora arquivos utilitários (helpers.js/index.js)', () => {
    expect(result.items.some((item) => item.id === 'model:helpers')).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('classifica models por tokens do nome/tabela', () => {
    expect(classifyModel('QaWaveExecution', 'qa_wave_executions')).toBe('DEVELOPMENT');
    expect(classifyModel('AuditLog', 'audit_logs')).toBe('SUPPORT');
    expect(classifyModel('Ticket', 'tickets')).toBe('PRODUCTION');
  });
});
