'use strict';

/**
 * Regressão — scripts qa:mesh que inicializam o meshRunner precisam do
 * default local de RUNTIME_ROOT.
 *
 * Falha observada (2026-08-01, ambiente local): `PIPELINE_BYPASS=1 npm run
 * qa:mesh` abortava no boot com
 *   Error: RUNTIME_ROOT é obrigatório. Configure um diretório externo ao workspace.
 * Cadeia de imports: runQaMesh → qa-mesh/meshRunner → adapters/rpaAdapter →
 * core/rpa/actionRecorder → lib/rpaPathResolver → api/utils/runtimePaths,
 * que propositalmente faz fail-fast sem RUNTIME_ROOT (sem fallback
 * silencioso — o runtime deve ficar fora do workspace).
 *
 * O CI sempre exporta RUNTIME_ROOT explicitamente (e2e.yml, wave-reports.yml)
 * e o script irmão `qa:mesh:workspace-core` já carrega o default
 * `RUNTIME_ROOT=${RUNTIME_ROOT:-/tmp/ragent2-runtime-qa-mesh}` — mas os
 * demais entrypoints do mesh não, tornando o uso local impossível sem
 * conhecimento tribal.
 *
 * Comportamento correto esperado: todo script que carrega o meshRunner (que
 * puxa a cadeia RPA) declara o default `${RUNTIME_ROOT:-...}` — env
 * explícito continua prevalecendo (sintaxe :-), então o CI não é afetado.
 */

const packageJson = require('../../../package.json');

const RUNTIME_ROOT_DEFAULT = 'RUNTIME_ROOT=${RUNTIME_ROOT:-';

// Scripts cujo caminho de execução carrega qa-mesh/meshRunner (que importa
// adapters/rpaAdapter → core/rpa/actionRecorder → runtimePaths, fail-fast
// sem RUNTIME_ROOT).
const MESH_RUNNER_SCRIPTS = [
  'qa:mesh',
  'qa:mesh:refresh',
  'qa:mesh:impact',
  'qa:mesh:scheduler',
  'qa:mesh:history:backfill-origin',
];

describe('package.json — scripts do meshRunner carregam default de RUNTIME_ROOT', () => {
  test.each(MESH_RUNNER_SCRIPTS)('script "%s" define ${RUNTIME_ROOT:-...} com env explícito prevalecendo', (name) => {
    const script = packageJson.scripts[name];
    expect(typeof script).toBe('string');
    expect(script).toContain(RUNTIME_ROOT_DEFAULT);
  });

  it('qa:mesh:history:reclassify-pipeline NÃO precisa do default (não carrega meshRunner)', () => {
    // Documenta o recorte: este script só require qa-mesh/governance (puro,
    // sem cadeia RPA). Se um dia passar a carregar o meshRunner, este teste
    // deve ser revisto junto com a lista MESH_RUNNER_SCRIPTS.
    const governanceSource = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', '..', 'qa-mesh', 'governance.js'),
      'utf8',
    );
    expect(governanceSource).not.toContain("require('./meshRunner')");
  });
});
