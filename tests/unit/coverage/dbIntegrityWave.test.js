'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluateDbIntegrityWave,
  toSnakeCase,
  expectedColumnName,
} = require('../../../qa/coverage/dbIntegrityWave');
const { COVERAGE_STATES } = require('../../../qa/coverage/coverageStates');
const { collectModelStaticData, findMigrationMatches } = require('../../../scripts/governance/db-integrity-wave');

/**
 * Fixtures em tmp: models Sequelize literais + migrations, parseados pelo
 * modelScanner real via collectModelStaticData (fs apenas — nada de DB).
 */
function makeFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbi-wave-'));
  const modelsDir = path.join(rootDir, 'api', 'db', 'models');
  const migrationsDir = path.join(rootDir, 'api', 'db', 'migrations');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(migrationsDir, { recursive: true });

  // Model completo: PK explícita, tenant, timestamps default.
  fs.writeFileSync(path.join(modelsDir, 'Widget.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('Widget', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  displayName: { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'widgets', timestamps: true });
`);

  // Model global legítimo: sem tenant_id/tenant_key (deve virar warning, não falha).
  fs.writeFileSync(path.join(modelsDir, 'GlobalSetting.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('GlobalSetting', {
  key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  value: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'global_settings', timestamps: true });
`);

  // Model sem migration correspondente (migrationFound deve falhar).
  fs.writeFileSync(path.join(modelsDir, 'Ghost.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('Ghost', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'ghosts', timestamps: true });
`);

  fs.writeFileSync(path.join(migrationsDir, '20250101000001-create-widgets.js'), `'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('widgets', {
    id: { type: Sequelize.STRING, primaryKey: true },
    tenant_key: { type: Sequelize.STRING, allowNull: false },
    display_name: { type: Sequelize.STRING },
  }),
  down: (queryInterface) => queryInterface.dropTable('widgets'),
};
`);
  fs.writeFileSync(path.join(migrationsDir, '20250101000002-create-global-settings.js'), `'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('global_settings', {
    key: { type: Sequelize.STRING, primaryKey: true },
    value: { type: Sequelize.TEXT },
  }),
  down: (queryInterface) => queryInterface.dropTable('global_settings'),
};
`);

  const inventoryItems = [
    { id: 'model:Widget', kind: 'model', model: 'Widget', tableName: 'widgets', source: 'api/db/models/Widget.js' },
    { id: 'model:GlobalSetting', kind: 'model', model: 'GlobalSetting', tableName: 'global_settings', source: 'api/db/models/GlobalSetting.js' },
    { id: 'model:Ghost', kind: 'model', model: 'Ghost', tableName: 'ghosts', source: 'api/db/models/Ghost.js' },
  ];

  return {
    rootDir,
    inventoryItems,
    collect: () => collectModelStaticData({ inventoryItems, rootDir }),
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}

/**
 * Fixture para detecção ampliada de migrations: SQL bruto dentro de migration
 * Umzug (.js) e DDL versionado solto (migrations/*.sql).
 */
function makeRawSqlFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbi-wave-rawsql-'));
  const modelsDir = path.join(rootDir, 'api', 'db', 'models');
  const migrationsDir = path.join(rootDir, 'api', 'db', 'migrations');
  const ddlDir = path.join(rootDir, 'migrations');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.mkdirSync(ddlDir, { recursive: true });

  fs.writeFileSync(path.join(modelsDir, 'RawSql.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('RawSql', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
}, { tableName: 'raw_sql_widgets', timestamps: true });
`);
  fs.writeFileSync(path.join(modelsDir, 'DdlOnly.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('DdlOnly', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
}, { tableName: 'ddl_widgets', timestamps: true });
`);
  fs.writeFileSync(path.join(modelsDir, 'TrulyOrphan.js'), `'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) => sequelize.define('TrulyOrphan', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
}, { tableName: 'truly_orphans', timestamps: true });
`);

  // Migration Umzug com CREATE TABLE em SQL bruto (sem ocorrência quotada do tableName).
  fs.writeFileSync(path.join(migrationsDir, '20250101000003-create-raw-sql-widgets.js'), `'use strict';
module.exports = {
  up: (queryInterface) => queryInterface.sequelize.query(
    'CREATE TABLE IF NOT EXISTS raw_sql_widgets (id text PRIMARY KEY, tenant_key text NOT NULL)'
  ),
  down: (queryInterface) => queryInterface.sequelize.query('DROP TABLE IF EXISTS raw_sql_widgets'),
};
`);

  // DDL versionado solto (fora de api/db/migrations).
  fs.writeFileSync(path.join(ddlDir, 'legacy-2025-01-01.sql'), `CREATE TABLE IF NOT EXISTS ddl_widgets (
  id text PRIMARY KEY,
  tenant_key text NOT NULL
);
`);

  const inventoryItems = [
    { id: 'model:RawSql', kind: 'model', model: 'RawSql', tableName: 'raw_sql_widgets', source: 'api/db/models/RawSql.js' },
    { id: 'model:DdlOnly', kind: 'model', model: 'DdlOnly', tableName: 'ddl_widgets', source: 'api/db/models/DdlOnly.js' },
    { id: 'model:TrulyOrphan', kind: 'model', model: 'TrulyOrphan', tableName: 'truly_orphans', source: 'api/db/models/TrulyOrphan.js' },
  ];

  return {
    rootDir,
    inventoryItems,
    collect: () => collectModelStaticData({ inventoryItems, rootDir }),
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}


describe('coverage/dbIntegrityWave', () => {
  let fixture;
  beforeEach(() => { fixture = makeFixture(); });
  afterEach(() => { fixture.cleanup(); });

  test('helpers: toSnakeCase e expectedColumnName', () => {
    expect(toSnakeCase('displayName')).toBe('display_name');
    expect(toSnakeCase('tenant_key')).toBe('tenant_key');
    expect(expectedColumnName('displayName', {})).toBe('display_name');
    expect(expectedColumnName('x', { column: 'custom_col' })).toBe('custom_col');
  });

  test('collectModelStaticData: parse estático + matches de migration', () => {
    const models = fixture.collect();
    expect(models).toHaveLength(3);
    const widget = models.find((m) => m.model === 'Widget');
    expect(widget.parsed.parseError).toBe(false);
    expect(widget.parsed.tableName).toBe('widgets');
    expect(widget.parsed.hasTenantId).toBe(true);
    expect(widget.migrationMatches).toEqual(['api/db/migrations/20250101000001-create-widgets.js']);
    const ghost = models.find((m) => m.model === 'Ghost');
    expect(ghost.migrationMatches).toEqual([]);
  });

  test('findMigrationMatches: referência quotada sem createTable também conta', () => {
    const matches = findMigrationMatches('widgets', [
      { file: 'm1.js', content: 'await queryInterface.addIndex(\'widgets\', [\'tenant_key\']);' },
      { file: 'm2.js', content: 'nada a ver' },
    ]);
    expect(matches).toEqual(['m1.js']);
  });

  test('VALIDATED quando estático + live passam', () => {
    const models = fixture.collect();
    for (const m of models) {
      if (m.model === 'Ghost') continue;
      m.live = m.model === 'Widget'
        ? { tableExists: true, columns: ['id', 'tenant_key', 'display_name', 'created_at', 'updated_at'], primaryKeyColumns: ['id'] }
        : { tableExists: true, columns: ['key', 'value', 'created_at', 'updated_at'], primaryKeyColumns: ['key'] };
    }
    const result = evaluateDbIntegrityWave({ models, dbAvailable: true });
    const widget = result.perModel.find((m) => m.model === 'Widget');
    expect(widget.state).toBe(COVERAGE_STATES.VALIDATED);
    expect(widget.failedAssertions).toEqual([]);
    expect(result.totals.validated).toBe(2);
  });

  test('FAILED quando migration ausente (mesmo com live ok)', () => {
    const models = fixture.collect();
    for (const m of models) {
      if (m.model === 'Widget') {
        m.live = { tableExists: true, columns: ['id', 'tenant_key', 'display_name'], primaryKeyColumns: ['id'] };
      } else if (m.model === 'GlobalSetting') {
        m.live = { tableExists: true, columns: ['key', 'value'], primaryKeyColumns: ['key'] };
      } else {
        m.live = { tableExists: true, columns: ['id', 'tenant_key'], primaryKeyColumns: ['id'] };
      }
    }
    const result = evaluateDbIntegrityWave({ models, dbAvailable: true });
    const ghost = result.perModel.find((m) => m.model === 'Ghost');
    expect(ghost.state).toBe(COVERAGE_STATES.FAILED);
    expect(ghost.failedAssertions).toContain('migrationFound');
    expect(result.totals.failed).toBe(1);
  });

  test('ausência de tenant_id NÃO falha: vira warning e o model valida', () => {
    const models = fixture.collect();
    for (const m of models) {
      if (m.model === 'Ghost') continue;
      m.live = m.model === 'Widget'
        ? { tableExists: true, columns: ['id', 'tenant_key', 'display_name'], primaryKeyColumns: ['id'] }
        : { tableExists: true, columns: ['key', 'value'], primaryKeyColumns: ['key'] };
    }
    const result = evaluateDbIntegrityWave({ models, dbAvailable: true });
    const global = result.perModel.find((m) => m.model === 'GlobalSetting');
    expect(global.state).toBe(COVERAGE_STATES.VALIDATED);
    expect(global.warnings).toContain('tenantScope');
    const tenantAssertion = global.assertions.find((a) => a.name === 'tenantScope');
    expect(tenantAssertion.passed).toBe(true);
    expect(tenantAssertion.tenantScope).toBe('absent');
    expect(result.totals.warnings).toBe(1);
  });

  test('dbAvailable=false: estático passa → VISITED (nunca VALIDATED)', () => {
    const models = fixture.collect();
    const result = evaluateDbIntegrityWave({ models, dbAvailable: false, dbUnavailableReason: 'timeout de 5000ms' });
    const widget = result.perModel.find((m) => m.model === 'Widget');
    expect(widget.state).toBe(COVERAGE_STATES.VISITED);
    expect(widget.assertions.some((a) => a.name === 'liveTierSkipped')).toBe(true);
    expect(result.perModel.every((m) => m.state !== COVERAGE_STATES.VALIDATED)).toBe(true);
    expect(result.totals.validated).toBe(0);
    // falha estática continua FAILED mesmo sem DB
    const ghost = result.perModel.find((m) => m.model === 'Ghost');
    expect(ghost.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('live: FAILED quando coluna do model não existe na tabela', () => {
    const models = fixture.collect();
    const widget = models.find((m) => m.model === 'Widget');
    widget.live = { tableExists: true, columns: ['id', 'tenant_key'], primaryKeyColumns: ['id'] };
    const result = evaluateDbIntegrityWave({ models: [widget], dbAvailable: true });
    const entry = result.perModel[0];
    expect(entry.state).toBe(COVERAGE_STATES.FAILED);
    expect(entry.failedAssertions).toContain('modelColumnsExistInDb');
    const detail = entry.assertions.find((a) => a.name === 'modelColumnsExistInDb').detail;
    expect(detail).toContain('display_name');
  });

  test('live: FAILED quando tabela ausente ou sem PK no banco', () => {
    const models = fixture.collect();
    const widget = models.find((m) => m.model === 'Widget');
    widget.live = { tableExists: false, columns: [], primaryKeyColumns: [] };
    const result = evaluateDbIntegrityWave({ models: [widget], dbAvailable: true });
    expect(result.perModel[0].state).toBe(COVERAGE_STATES.FAILED);
    expect(result.perModel[0].failedAssertions).toContain('tableExistsInDb');

    const widget2 = { ...fixture.collect().find((m) => m.model === 'Widget') };
    widget2.live = { tableExists: true, columns: ['id', 'tenant_key', 'display_name'], primaryKeyColumns: [] };
    const result2 = evaluateDbIntegrityWave({ models: [widget2], dbAvailable: true });
    expect(result2.perModel[0].state).toBe(COVERAGE_STATES.FAILED);
    expect(result2.perModel[0].failedAssertions).toContain('primaryKeyExistsInDb');
  });

  test('timestamps:false sem campos created/updated falha assertiva estática', () => {
    const result = evaluateDbIntegrityWave({
      models: [{
        id: 'model:NoTs',
        model: 'NoTs',
        source: 'api/db/models/NoTs.js',
        parsed: {
          parseError: false,
          tableName: 'no_ts',
          hasTenantId: true,
          fields: { id: { primaryKey: true, type: 'STRING' } },
        },
        timestampsDisabled: true,
        migrationMatches: ['m.js'],
      }],
      dbAvailable: false,
    });
    const entry = result.perModel[0];
    expect(entry.state).toBe(COVERAGE_STATES.FAILED);
    expect(entry.failedAssertions).toContain('timestampsDefined');
  });

  test('detecção ampliada: migration por SQL bruto (CREATE TABLE em .js) e DDL solto (.sql)', () => {
    const rawFixture = makeRawSqlFixture();
    try {
      const models = rawFixture.collect();
      const rawSql = models.find((m) => m.model === 'RawSql');
      expect(rawSql.migrationMatches).toEqual(['api/db/migrations/20250101000003-create-raw-sql-widgets.js']);
      const ddlOnly = models.find((m) => m.model === 'DdlOnly');
      expect(ddlOnly.migrationMatches).toEqual(['migrations/legacy-2025-01-01.sql']);
      // model sem NENHUMA fonte continua sem match (não enfraquecemos a assertiva)
      const orphan = models.find((m) => m.model === 'TrulyOrphan');
      expect(orphan.migrationMatches).toEqual([]);

      const result = evaluateDbIntegrityWave({
        models: models.map((m) => ({
          ...m,
          live: { tableExists: true, columns: ['id', 'tenant_key', 'created_at', 'updated_at'], primaryKeyColumns: ['id'] },
        })),
        dbAvailable: true,
      });
      expect(result.perModel.find((m) => m.model === 'RawSql').state).toBe(COVERAGE_STATES.VALIDATED);
      expect(result.perModel.find((m) => m.model === 'DdlOnly').state).toBe(COVERAGE_STATES.VALIDATED);
      const orphanEntry = result.perModel.find((m) => m.model === 'TrulyOrphan');
      expect(orphanEntry.state).toBe(COVERAGE_STATES.FAILED);
      expect(orphanEntry.failedAssertions).toContain('migrationFound');
    } finally {
      rawFixture.cleanup();
    }
  });

  test('findMigrationMatches: CREATE TABLE em SQL bruto (variações de caso/espaço)', () => {
    const sources = [
      { file: 'raw.js', content: 'await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS audit_log (id text)`);' },
      { file: 'upper.sql', content: 'create  table\n  AUDIT_LOG (id text);' },
      { file: 'quoted.sql', content: 'CREATE TABLE "audit_log" (id text);' },
      { file: 'other.sql', content: 'CREATE TABLE audit_log_archive (id text);' },
    ];
    expect(findMigrationMatches('audit_log', sources)).toEqual(['raw.js', 'upper.sql', 'quoted.sql']);
  });

  function noTsModelData(model = 'NoTsAux') {
    return {
      id: `model:${model}`,
      model,
      source: `api/db/models/${model}.js`,
      parsed: {
        parseError: false,
        tableName: 'no_ts_aux',
        hasTenantId: true,
        fields: { id: { primaryKey: true, type: 'STRING' } },
      },
      timestampsDisabled: true,
      migrationMatches: ['m.js'],
      live: { tableExists: true, columns: ['id'], primaryKeyColumns: ['id'] },
    };
  }

  test('isenção justificada vira NOT_APPLICABLE e não derruba VALIDATED', () => {
    const result = evaluateDbIntegrityWave({
      models: [noTsModelData()],
      dbAvailable: true,
      exemptions: {
        NoTsAux: {
          assertion: 'timestampsDefined',
          reason: 'log append-only com created_at via DEFAULT no banco',
          approvedBy: 'senior-engineer',
          date: '2026-07-25',
        },
      },
    });
    const entry = result.perModel[0];
    expect(entry.state).toBe(COVERAGE_STATES.VALIDATED);
    expect(entry.failedAssertions).toEqual([]);
    const exempted = entry.assertions.find((a) => a.name === 'timestampsDefined');
    expect(exempted.passed).toBe(true);
    expect(exempted.notApplicable).toBe(true);
    expect(exempted.detail).toContain('NOT_APPLICABLE');
    expect(exempted.detail).toContain('log append-only');
    expect(result.exemptions.applied).toEqual([{
      model: 'NoTsAux',
      assertion: 'timestampsDefined',
      reason: 'log append-only com created_at via DEFAULT no banco',
      approvedBy: 'senior-engineer',
      date: '2026-07-25',
    }]);
    expect(result.exemptions.ignored).toEqual([]);
  });

  test('isenção sem campos obrigatórios é ignorada e a assertiva continua falhando', () => {
    const result = evaluateDbIntegrityWave({
      models: [noTsModelData()],
      dbAvailable: true,
      exemptions: {
        NoTsAux: { assertion: 'timestampsDefined', reason: 'sem approvedBy nem date' },
      },
    });
    const entry = result.perModel[0];
    expect(entry.state).toBe(COVERAGE_STATES.FAILED);
    expect(entry.failedAssertions).toContain('timestampsDefined');
    const notExempted = entry.assertions.find((a) => a.name === 'timestampsDefined');
    expect(notExempted.notApplicable).toBeUndefined();
    expect(result.exemptions.applied).toEqual([]);
    expect(result.exemptions.ignored).toHaveLength(1);
    expect(result.exemptions.ignored[0].model).toBe('NoTsAux');
  });

  test('isenção para assertiva inexistente é ignorada', () => {
    const result = evaluateDbIntegrityWave({
      models: [noTsModelData()],
      dbAvailable: true,
      exemptions: {
        NoTsAux: {
          assertion: 'assertivaQueNaoExiste',
          reason: 'alvo inválido',
          approvedBy: 'senior-engineer',
          date: '2026-07-25',
        },
      },
    });
    expect(result.perModel[0].state).toBe(COVERAGE_STATES.FAILED);
    expect(result.exemptions.applied).toEqual([]);
    expect(result.exemptions.ignored).toHaveLength(1);
    expect(result.exemptions.ignored[0].reason).toContain('não existe');
  });
});
