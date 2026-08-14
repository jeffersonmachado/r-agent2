'use strict';

/**
 * Regressão — scripts qa:mesh não dependem mais de RUNTIME_ROOT.
 *
 * `api/utils/runtimePaths.js` computa um default externo
 * (`~/.local/share/ragent2-runtime`, `/var/lib/ragent2` em produção) e
 * aceita override in-process via `configureRuntimeRoot`. Os scripts do mesh
 * não precisam mais injetar `RUNTIME_ROOT=...` — e não devem referenciar a
 * variável removida.
 */

const packageJson = require('../../../package.json');

const MESH_RUNNER_SCRIPTS = [
  'qa:mesh',
  'qa:mesh:refresh',
  'qa:mesh:impact',
  'qa:mesh:scheduler',
  'qa:mesh:history:backfill-origin',
];

describe('package.json — scripts do meshRunner não referenciam RUNTIME_ROOT', () => {
  test.each(MESH_RUNNER_SCRIPTS)('script "%s" não contém RUNTIME_ROOT', (name) => {
    const script = packageJson.scripts[name];
    expect(typeof script).toBe('string');
    expect(script).not.toContain('RUNTIME_ROOT');
  });

  it('qa:mesh:history:reclassify-pipeline NÃO precisa do default (não carrega meshRunner)', () => {
    const governanceSource = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', '..', 'qa-mesh', 'governance.js'),
      'utf8',
    );
    expect(governanceSource).not.toContain("require('./meshRunner')");
  });
});
