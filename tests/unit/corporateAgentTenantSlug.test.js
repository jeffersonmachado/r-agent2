'use strict';

/**
 * Regressão (gap 3.5): corporate_agents.slug era globalmente UNIQUE,
 * impedindo tenant A e tenant B de terem ambos um `scheduling-agent`.
 * Contrato: unicidade composta (tenant_id, slug) + id global UUID.
 */

const fs = require('fs');
const path = require('path');

function loadModelDefinition() {
  jest.resetModules();
  let captured = null;
  jest.doMock('../../api/db/sequelize', () => ({
    getSequelize: () => ({
      define: (name, attrs, options) => {
        captured = { name, attrs, options };
        return { __definition: captured };
      },
    }),
  }));
  const getCorporateAgentModel = require('../../api/db/models/CorporateAgent');
  getCorporateAgentModel();
  return captured;
}

describe('CorporateAgent — slug isolado por tenant', () => {
  test('slug não é globalmente unique no modelo', () => {
    const def = loadModelDefinition();
    expect(def.attrs.slug.unique).not.toBe(true);
  });

  test('existe índice único composto (tenant_id, slug)', () => {
    const def = loadModelDefinition();
    const composite = (def.options.indexes || []).find(
      (idx) => idx.unique === true
        && Array.isArray(idx.fields)
        && idx.fields.includes('tenant_id')
        && idx.fields.includes('slug'),
    );
    expect(composite).toBeDefined();
  });

  test('id permanece UUID global', () => {
    const def = loadModelDefinition();
    expect(def.attrs.id.primaryKey).toBe(true);
    expect(String(def.attrs.id.type)).toMatch(/UUID/i);
  });

  test('migration incremental segura existe para (tenant_id, slug)', () => {
    const migrationsDir = path.join(__dirname, '..', '..', 'api', 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.includes('corporate-agent'));
    expect(files.length).toBeGreaterThan(0);
    const content = files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');
    // Remove a constraint/índice global de slug e cria unicidade composta.
    expect(content).toMatch(/corporate_agents_slug_key|corporate_agents_slug/);
    expect(content).toMatch(/tenant_id/);
    expect(content).toMatch(/UNIQUE/i);
  });
});
