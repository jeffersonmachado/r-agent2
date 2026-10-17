'use strict';

/**
 * INTEGRAÇÃO OBRIGATÓRIA DO BUG CLOSURE FIRST (missão 2026-10-17, item 4).
 *
 * O gate não pode existir só nos scripts de shell. Router, Mission, worker e
 * scheduler SPAWNAM comandos (sandbox Docker, deadline de operação, scheduler da
 * malha) — esses são caminhos alternativos reais. Estes testes travam:
 *
 *  1. a classificação de comando extensivo (lista fechada);
 *  2. a recusa REAL em `runChildWithDeadline` e em `runInSandbox` (antes de
 *     qualquer spawn/container);
 *  3. a presença da guarda nos 6 entrypoints de script;
 *  4. a recusa do scheduler da malha (skip, não falha de execução);
 *  5. a exposição dos bloqueios canônicos na Engineering Memory.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const {
  classificarComando, avaliarComando, erroDeBloqueio,
} = require('../../../governance/bug-closure/command-policy');

const FIXTURE_P0 = path.join(RAIZ, 'tests', 'fixtures', 'bug-closure', 'queue-with-open-p0.json');

// DETERMINISMO: estes testes provam RECUSA, então precisam de um inventário com P0 aberto.
// Antes dependiam da fila REAL — o que os deixava vermelhos exatamente quando todos os
// defeitos eram realmente fechados (medido em 2026-10-17). O hook só troca o CAMINHO do
// inventário; a política continua a mesma.
beforeEach(() => { process.env.BUG_CLOSURE_INVENTORY_PATH = FIXTURE_P0; });
afterEach(() => { delete process.env.BUG_CLOSURE_INVENTORY_PATH; });

describe('(1) política de comando — lista fechada e auditável', () => {
  const CASOS_EXTENSIVOS = [
    [['npm', 'run', 'validate:governance-enforcement'], 'L2_L3_EXTENSIVO'],
    [['npm', 'run', 'test:release-authoritative'], 'L2_L3_EXTENSIVO'],
    [['npm', 'run', 'test:system'], 'L2_L3_EXTENSIVO'],
    [['npm', 'run', 'qa:mesh'], 'QA_WAVES_COMPLETA'],
    [['npm', 'run', 'wave:api-surface'], 'QA_WAVES_COMPLETA'],
    [['bash', 'scripts/governance/converge-governance.sh'], 'CONVERGENCIA_COMPLETA'],
    [['bash', 'scripts/governance/seal-release.sh'], 'SELO_FINAL'],
    [['bash', 'scripts/release-package.sh'], 'PUBLICACAO_RELEASE'],
    [['node', 'scripts/governance/engineering-router-v2-seal.js'], 'SELO_FINAL'],
    [['node', 'scripts/governance/engineering-validation-orchestrator.js'], 'L2_L3_EXTENSIVO'],
  ];

  for (const [argv, operacao] of CASOS_EXTENSIVOS) {
    it(`classifica "${argv.join(' ')}" como ${operacao}`, () => {
      const c = classificarComando(argv[0], argv.slice(1));
      expect(c.extensiva).toBe(true);
      expect(c.operacao).toBe(operacao);
    });
  }

  it('correção e verificação direcionada NÃO são extensivas (senão o conserto morre)', () => {
    for (const argv of [
      ['npx', 'jest', 'tests/unit/x.test.js'],
      ['npm', 'run', 'test:unit'],
      ['node', '--check', 'api/server.js'],
      ['git', 'diff', 'HEAD'],
    ]) {
      expect(classificarComando(argv[0], argv.slice(1)).extensiva).toBe(false);
    }
  });

  it('nega com inventário contendo P0 aberto e libera o teste direcionado', () => {
    const negado = avaliarComando({ command: 'npm', args: ['run', 'qa:mesh'], actor: 'teste' });
    expect(negado.permitido).toBe(false);
    expect(negado.decisao.reasonCodes.length).toBeGreaterThan(0);
    expect(negado.decisao.reasonCodes).toContain('P0_ABERTO');

    const livre = avaliarComando({ command: 'npx', args: ['jest', 'tests/unit/x.test.js'], actor: 'teste' });
    expect(livre.permitido).toBe(true);
  });

  it('inventário indisponível ⇒ NEGADO (fail-closed)', () => {
    const negado = avaliarComando({
      command: 'npm',
      args: ['run', 'qa:mesh'],
      actor: 'teste',
      contexto: { commit: 'a'.repeat(40), actor: { id: 'x' } }, // sem defects
    });
    expect(negado.permitido).toBe(false);
  });

  it('erro tipado carrega operação e razões (nunca texto solto)', () => {
    const avaliacao = avaliarComando({ command: 'npm', args: ['run', 'qa:mesh'] });
    const erro = erroDeBloqueio(avaliacao);
    expect(erro.code).toBe('BUG_CLOSURE_BLOCKED');
    expect(erro.operacao).toBe('QA_WAVES_COMPLETA');
    expect(erro.message).toContain('BUG_CLOSURE_BLOCKED');
  });
});

describe('(2) recusa REAL nos chokepoints de processo filho', () => {
  it('runChildWithDeadline recusa comando extensivo ANTES de spawnar', async () => {
    const { runChildWithDeadline } = require('../../../api/utils/operationDeadline');
    await expect(runChildWithDeadline({
      command: 'npm',
      args: ['run', 'validate:governance-enforcement'],
      cwd: RAIZ,
      policy: 'REGRESSION_COMMAND',
      meta: { operation: 'teste' },
    })).rejects.toMatchObject({ code: 'BUG_CLOSURE_BLOCKED' });
  });

  it('runChildWithDeadline continua liberando teste direcionado', async () => {
    const { runChildWithDeadline } = require('../../../api/utils/operationDeadline');
    const r = await runChildWithDeadline({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd: RAIZ,
      policy: 'REGRESSION_COMMAND',
      meta: { operation: 'teste' },
    });
    expect(r.exitCode).toBe(0);
  });

  it('runInSandbox recusa comando extensivo antes de checar/iniciar container', async () => {
    const { runInSandbox } = require('../../../api/services/engineeringRouter/executionSandbox');
    // A guarda roda ANTES de `isSandboxAvailable()` — logo não depende de Docker.
    await expect(runInSandbox({
      executable: 'npm',
      args: ['run', 'qa:mesh'],
      cwd: path.join(RAIZ, 'tests'),
      timeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'BUG_CLOSURE_BLOCKED' });
  });
});

describe('(3) guarda presente nos entrypoints de script', () => {
  const ALVOS = [
    'scripts/governance/converge-governance.sh',
    'scripts/governance/seal-release.sh',
    'scripts/release-package.sh',
    'scripts/governance/engineering-router-v2-seal.js',
    'scripts/governance/engineering-validation-orchestrator.js',
    'scripts/governance/run-release-suites.js',
    'pipeline/runFullValidation.js',
    'pipeline/entrypoints/runQaMesh.js',
    'qa-mesh/meshScheduler.js',
  ];

  for (const rel of ALVOS) {
    it(`${rel} consulta a elegibilidade`, () => {
      const fonte = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(fonte).toMatch(/bug-closure|exigirElegibilidade|avaliarComando/);
    });
  }
});

describe('(4) scheduler da malha recusa por defeito (skip, não crash)', () => {
  it('runScheduledMesh retorna skip com motivo bug_closure_blocked', async () => {
    const { runScheduledMesh } = require('../../../qa-mesh/meshScheduler');
    const r = await runScheduledMesh('critical');
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('bug_closure_blocked');
    expect(Array.isArray(r.bloqueio.razoes)).toBe(true);
    expect(r.bloqueio.razoes.length).toBeGreaterThan(0);
  });
});

describe('(5) Engineering Memory não apresenta "done" como prova', () => {
  it('lookupEngineeringMemory expõe os bloqueios canônicos', async () => {
    const { lookupEngineeringMemory } = require('../../../api/services/engineeringMission/missionContextService');
    const r = await lookupEngineeringMemory({ keywords: [] });
    expect(r.bugClosure).toBeDefined();
    expect(r.bugClosure.regra).toContain('NAO sao prova');
    expect(r.bugClosure.abertos).toBeGreaterThan(0);
    expect(Array.isArray(r.bugClosure.bloqueantes)).toBe(true);
  });
});
