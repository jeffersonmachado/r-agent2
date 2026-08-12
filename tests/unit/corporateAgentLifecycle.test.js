'use strict';

/**
 * Regressão (gap 3.2): agent-factory e agent-hardening-service gravam
 * lifecycle 'validated', mas o modelo CorporateAgent (e o CHECK do Postgres)
 * só aceitam draft|validation|approved|active|deprecated|archived.
 *
 * A arquitetura exige: draft → validation → validated → approved → active.
 */

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

describe('CorporateAgent lifecycle — estado intermediário validated', () => {
  test('modelo aceita lifecycle validated (draft→validation→validated→approved→active)', () => {
    const def = loadModelDefinition();
    expect(def).not.toBeNull();
    const lifecycle = def.attrs.lifecycle;
    const values = lifecycle.values || lifecycle.type?.values;
    expect(Array.isArray(values)).toBe(true);
    for (const state of ['draft', 'validation', 'validated', 'approved', 'active']) {
      expect(values).toContain(state);
    }
  });

  test('hardening service grava lifecycle compatível com o modelo', () => {
    const def = loadModelDefinition();
    const values = def.attrs.lifecycle.values || def.attrs.lifecycle.type?.values;
    const fs = require('fs');
    const path = require('path');
    const hardeningSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'api', 'modules', 'agent-os', 'services', 'agent-hardening-service.js'),
      'utf8',
    );
    const factorySrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'api', 'modules', 'agent-os', 'routes', 'agent-factory.js'),
      'utf8',
    );
    const written = new Set();
    for (const src of [hardeningSrc, factorySrc]) {
      for (const lineMatch of src.matchAll(/lifecycle:[^\n]*/g)) {
        for (const m of lineMatch[0].matchAll(/'([a-z_]+)'/g)) written.add(m[1]);
      }
    }
    // Todo lifecycle gravado pelos services precisa existir no ENUM do modelo.
    for (const state of written) expect(values).toContain(state);
    // E o estado 'validated' precisa ser efetivamente gravado após QA GO.
    expect(written.has('validated')).toBe(true);
  });

  test('migration incremental segura existe para o lifecycle validated', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '..', '..', 'api', 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.includes('corporate-agent'));
    expect(files.length).toBeGreaterThan(0);
    const content = files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');
    expect(content).toContain('validated');
    expect(content).toMatch(/corporate_agents/);
  });
});
