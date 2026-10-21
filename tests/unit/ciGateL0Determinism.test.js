'use strict';

/**
 * L0 do gate do branch precisa ser DETERMINÍSTICO.
 *
 * MEDIDO (2026-10-21): com o default do `jest.config.cjs` (workers derivados do orçamento de
 * conexões ⇒ 11 nesta máquina de 12 CPUs), a MESMA suíte oficial produziu falsos vermelhos por
 * contenção, sem defeito no código:
 *   - `engineeringRouterExecutionSandboxSecurity` recebia `SANDBOX_UNAVAILABLE` (probe
 *     `docker info` estourando 5 s com load average 12);
 *   - `tenantAiCredentialsSaveRoute` estourava o `testTimeout` de 10 s.
 * Com 4 workers: 1086 suítes / 9214 testes / exit 0 em 358 s.
 *
 * Este teste fixa o contrato do gate: o passo L0 roda com `JEST_MAX_WORKERS` explícito (e
 * auditável no relatório via `envFixado`), sem alterar o default de quem roda `npm test` à mão.
 */

const { PASSOS } = require('../../scripts/ci/dev-branch-gate');

describe('gate do branch — L0 determinístico', () => {
  test('o passo L0 fixa JEST_MAX_WORKERS (nunca herda o default de 11 workers)', () => {
    const l0 = PASSOS.C.find((p) => p.id === 'L0-suite-oficial');
    expect(l0).toBeTruthy();
    expect(l0.env).toBeTruthy();
    expect(l0.env.JEST_MAX_WORKERS).toBe('4');
  });

  test('o teto do L0 é configurável por L0_JEST_MAX_WORKERS (sem editar código)', () => {
    const anterior = process.env.L0_JEST_MAX_WORKERS;
    process.env.L0_JEST_MAX_WORKERS = '2';
    // O módulo lê o env no carregamento: recarrega isolado para observar o efeito.
    let carregado;
    jest.isolateModules(() => {
      carregado = require('../../scripts/ci/dev-branch-gate');
    });
    const l0 = carregado.PASSOS.C.find((p) => p.id === 'L0-suite-oficial');
    expect(l0.env.JEST_MAX_WORKERS).toBe('2');

    if (anterior === undefined) delete process.env.L0_JEST_MAX_WORKERS;
    else process.env.L0_JEST_MAX_WORKERS = anterior;
  });

  test('o passo de integração (L0b) impõe o próprio teto de workers por linha de comando', () => {
    const l0b = PASSOS.C.find((p) => p.id === 'L0b-integracao-engenheiro');
    expect(l0b).toBeTruthy();
    // Integração com Postgres real: concorrência alta corrompe estado compartilhado.
    //
    // APERTADO em 2026-10-21 (run 39660840381): `--maxWorkers=2` NÃO bastava. O padrão
    // `tests/integration/engineering` casa todas as suítes `engineering*` — inclusive as do grupo
    // EXCLUSIVO `MISSION_WORKER_SHARED_RUNNER_AND_DB` de `config/canonical-release-suites.json`
    // (mesmo runner de laço/LEASE e mesmo banco de missões). Com 2 workers, duas delas rodaram
    // juntas: `engineeringBugAutonomousLoopE2E` falhou em 18,31 s e
    // `engineeringBugLoopNaturalPathE2E` estourou o timeout de 900 s — ambas PASSANDO isoladas.
    // A exigência agora é serialização REAL (1 worker), que satisfaz a exclusividade canônica por
    // construção; `--maxWorkers=2` é aceito apenas como sinônimo de teto explícito, nunca como
    // permissão para dois workers.
    expect(l0b.comando).toMatch(/--runInBand|--maxWorkers=1\b/);
    expect(l0b.comando).not.toMatch(/--maxWorkers=[2-9]/);
    expect(l0b.comando).toContain('tests/integration/engineering');
  });
});
