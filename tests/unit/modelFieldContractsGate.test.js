'use strict';

/**
 * Regressão do gate `validate:model-field-contracts`.
 *
 * Prova que a classe de falha original (campo aceito/escrito pelo domínio mas
 * ausente no model Sequelize) é detectada de forma determinística, e que o
 * estado real do repositório passa sem violações.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  run,
  collectMigrationColumns,
  stripComments,
} = require('../../scripts/governance/validate-model-field-contracts');
const { introspectModels, createCapturingSequelize } = require('../../api/services/qa/inventory/modelAttributesIntrospector');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REAL_CONTRACT = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'model-field-contracts.json'), 'utf8'));

function codes(violations) {
  return violations.map((v) => v.code);
}

describe('collectMigrationColumns', () => {
  it('detecta colunas literais de addColumn', () => {
    const sources = [{
      file: 'm.js',
      content: "await qi.addColumn('access_memberships', 'due_date', { type: Sequelize.DATE });",
    }];
    expect([...collectMigrationColumns('access_memberships', sources).columns]).toEqual(['due_date']);
  });

  it('detecta o padrão de array de descritores usado com col.name', () => {
    const content = `
      const columnsToAdd = [
        { name: 'due_date', type: Sequelize.DATE },
        { name: 'grace_until', type: Sequelize.DATE },
      ];
      for (const col of columnsToAdd) {
        await queryInterface.addColumn('access_memberships', col.name, { type: col.type });
      }
    `;
    const { columns } = collectMigrationColumns('access_memberships', [{ file: 'm.js', content }]);
    expect([...columns].sort()).toEqual(['due_date', 'grace_until']);
  });

  it('não confunde colunas citadas apenas em comentário', () => {
    expect(stripComments("code: 1, // legado: operadora.codigo\n/* outra: coisa */")).not.toMatch(/legado|outra/);
    const content = `
      await queryInterface.createTable('pbx_carriers', {
        code: { type: Sequelize.STRING(40) }, // legado: operadora.codigo
        nome: { type: Sequelize.STRING(80) },
      });
    `;
    const { columns } = collectMigrationColumns('pbx_carriers', [{ file: 'm.js', content }]);
    expect([...columns].sort()).toEqual(['code', 'nome']);
  });

  it('ignora migrations que não referenciam a tabela', () => {
    const sources = [{ file: 'outra.js', content: "await qi.addColumn('outra_tabela', 'x', {});" }];
    expect([...collectMigrationColumns('access_memberships', sources).columns]).toEqual([]);
  });
});

describe('run() — detecção de violações', () => {
  const baseIntrospection = {
    models: {
      AccessMembership: {
        modelName: 'AccessMembership',
        tableName: 'access_memberships',
        physicalColumns: ['id', 'tenant_key', 'due_date'],
      },
    },
    errors: [],
    loadedFiles: [],
  };

  const migrationSources = [{
    file: 'm.js',
    content: `
      await qi.createTable('access_memberships', { id: { type: Sequelize.STRING } });
      await qi.addColumn('access_memberships', 'due_date', {});
    `,
  }];

  it('falha quando o domínio usa um campo ausente no model (bug AccessMembership)', () => {
    const contract = {
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/AccessMembership.js',
        persistedFields: {
          id: { usedBy: [], reason: 'pk' },
          grace_until: { usedBy: [], reason: 'carência' },
        },
      },
    };
    const { violations } = run({ contract, introspection: baseIntrospection, migrationSources });
    expect(codes(violations)).toContain('field_not_in_model');
    expect(violations.find((v) => v.code === 'field_not_in_model').field).toBe('grace_until');
  });

  it('falha quando o campo não existe no DDL das migrations', () => {
    const contract = {
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/AccessMembership.js',
        persistedFields: {
          id: { usedBy: [], reason: 'pk' },
          // existe no model e nas migrations
          due_date: { usedBy: [], reason: 'billing' },
          // existe no model, mas não em nenhuma migration
          plan_type: { usedBy: [], reason: 'plano' },
        },
      },
    };
    const introspection = {
      ...baseIntrospection,
      models: {
        AccessMembership: {
          ...baseIntrospection.models.AccessMembership,
          physicalColumns: ['id', 'due_date', 'plan_type'],
        },
      },
    };
    const { violations } = run({ contract, introspection, migrationSources });
    expect(codes(violations)).toEqual(['field_not_in_migrations']);
    expect(violations[0].field).toBe('plan_type');
  });

  it('falha quando a tabela do contrato diverge do model', () => {
    const contract = {
      AccessMembership: {
        table: 'tabela_errada',
        source: 'api/db/models/AccessMembership.js',
        persistedFields: { id: { usedBy: [], reason: 'pk' } },
      },
    };
    const { violations } = run({ contract, introspection: baseIntrospection, migrationSources });
    expect(codes(violations)).toContain('table_mismatch');
  });

  it('falha quando o contrato aponta para model inexistente ou fonte ausente', () => {
    const contract = {
      ModeloInexistente: {
        table: 'x',
        source: 'api/db/models/ModeloInexistente.js',
        persistedFields: { id: { usedBy: [], reason: 'pk' } },
      },
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/NaoExiste.js',
        persistedFields: { id: { usedBy: [], reason: 'pk' } },
      },
    };
    const { violations } = run({ contract, introspection: baseIntrospection, migrationSources });
    expect(codes(violations)).toContain('model_unknown');
    expect(codes(violations)).toContain('model_source_missing');
  });

  it('falha quando usedBy não referencia mais o campo (contrato apodrecido)', () => {
    // Arquivo real do repositório que não menciona `due_date`.
    const staleFile = 'jest.config.cjs';
    const contract = {
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/AccessMembership.js',
        persistedFields: {
          id: { usedBy: [], reason: 'pk' },
          due_date: { usedBy: [staleFile], reason: 'billing' },
        },
      },
    };
    const { violations } = run({ contract, introspection: baseIntrospection, migrationSources });
    expect(codes(violations)).toContain('usedby_reference_missing');
  });

  it('falha quando usedBy aponta para arquivo inexistente', () => {
    const contract = {
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/AccessMembership.js',
        persistedFields: {
          id: { usedBy: [], reason: 'pk' },
          due_date: { usedBy: ['api/services/nao-existe.js'], reason: 'billing' },
        },
      },
    };
    const { violations } = run({ contract, introspection: baseIntrospection, migrationSources });
    expect(codes(violations)).toContain('usedby_file_missing');
  });
});

describe('run() — allowlist do domínio', () => {
  it('falha quando a allowlist aceita campo ausente no model', () => {
    const introspection = {
      models: {
        AccessMembership: {
          modelName: 'AccessMembership',
          tableName: 'access_memberships',
          physicalColumns: ['id', 'due_date'],
        },
      },
      errors: [],
      loadedFiles: [],
    };
    const migrationSources = [{ file: 'm.js', content: "await qi.addColumn('access_memberships', 'due_date', {});" }];
    const contract = {
      AccessMembership: {
        table: 'access_memberships',
        source: 'api/db/models/AccessMembership.js',
        allowlists: [{
          file: 'api/services/vertical/fitnessMembershipService.js',
          export: 'UPDATABLE_MEMBERSHIP_FIELDS',
          reason: 'campos aceitos pela rota de detalhes',
        }],
        persistedFields: {
          id: { usedBy: [], reason: 'pk' },
          due_date: { usedBy: [], reason: 'billing' },
        },
      },
    };
    const { violations } = run({ contract, introspection, migrationSources });
    // `grace_until`/`plan_type`/`unit_scope`/`plan_name`/`start_at`/`end_at` são aceitos
    // pelo serviço, mas não estão no model simulado nem no contrato.
    expect(codes(violations)).toContain('allowlist_field_not_in_model');
    expect(codes(violations)).toContain('allowlist_field_not_in_contract');
  });
});

describe('estado real do repositório', () => {
  let introspection;
  let realResult;

  beforeAll(() => {
    jest.resetModules();
    const captured = [];
    const fakeSequelize = createCapturingSequelize(captured);
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => fakeSequelize,
      connect: async () => fakeSequelize,
    }));
    introspection = introspectModels({ loadModel: (abs) => require(abs), captured });
    const { loadMigrationSources } = require('../../scripts/governance/validate-model-field-contracts');
    jest.dontMock('../../api/db/sequelize');
    realResult = run({
      contract: REAL_CONTRACT,
      introspection,
      migrationSources: loadMigrationSources(),
    });
  });

  it('introspecta todos os models sem erro', () => {
    expect(introspection.errors).toEqual([]);
    expect(Object.keys(introspection.models).length).toBeGreaterThan(100);
  });

  it('não tem violações no contrato versionado', () => {
    expect(realResult.violations).toEqual([]);
  });

  it('o contrato cobre AccessMembership com allowlist validada', () => {
    const entry = realResult.summary.find((s) => s.model === 'AccessMembership');
    expect(entry).toBeDefined();
    expect(entry.allowlists).toEqual([
      expect.objectContaining({ export: 'UPDATABLE_MEMBERSHIP_FIELDS', fields: 9 }),
    ]);
  });
});
