'use strict';

/**
 * Contrato de escopo da EngineeringTask (Fase 9).
 *
 * DEFEITO MEDIDO (2026-10-11, exercitando a jornada real pela UI): a task de
 * sandbox "Repare a função de soma ausente em tests/fixtures/engineering-router-sandbox/
 * mathUtils.js" foi criada SEM escopo declarado, executou, chamou o provider e teve
 * o patch rejeitado com `NO_PATCH_SCOPE` — ausência total de escopo é reject
 * explícito (ER-V1-FINAL-003). Com `max_iterations: 1`, esgotou na primeira
 * tentativa e terminou RED com:
 *
 *   ENGINEERING_TASK_EXHAUSTED: Esgotadas 1 tentativas
 *
 * A mensagem descreve o SINTOMA (tentativas esgotadas) e esconde a CAUSA (contrato
 * insatisfazível: nenhum patch poderia ser aceito). Custo real: tentativa
 * desperdiçada, chamada de provider e diagnóstico errado para quem opera.
 *
 * Regra agora: task que PRODUZ patch exige `allowedPaths` não vazio, recusada no
 * momento da criação (400 TASK_CONTRACT_INVALID) — antes de persistir.
 * Task de análise (auditoria/revisão) não exige escopo: ela não escreve arquivo.
 */

const {
  assertTaskContract,
  PATCH_PRODUCING_TASK_TYPES,
} = require('../../../api/services/engineeringRouter/engineeringTaskService');

describe('assertTaskContract — task insatisfazível não pode ser criada', () => {
  it('produzir patch exige escopo declarado', () => {
    for (const taskType of PATCH_PRODUCING_TASK_TYPES) {
      expect(() => assertTaskContract({ taskType, allowedPaths: [] }))
        .toThrow(/TASK_CONTRACT_INVALID/);
    }
  });

  it('escopo só com espaços é ausência de escopo (não passa por declarado)', () => {
    expect(() => assertTaskContract({ taskType: 'CODE_GENERATION', allowedPaths: ['   ', ''] }))
      .toThrow(/TASK_CONTRACT_INVALID/);
  });

  it('escopo declarado é aceito', () => {
    expect(() => assertTaskContract({
      taskType: 'BUG_FIX',
      allowedPaths: ['tests/fixtures/engineering-router-sandbox/mathUtils.js'],
    })).not.toThrow();
  });

  /**
   * D8. O fluxo CANÔNICO de missão nasce SEM escopo.
   *
   * Medido em 2026-10-13 (suíte autoritativa de release, 86/89): o compilador
   * cria o spec com `allowedPaths: []` e o orquestrador repassa isso à task.
   * Com a checagem incondicional, `compileMission → approve → startExecution`
   * era recusado ANTES de a missão planejar o escopo — 11 testes de lease,
   * fencing e review enforcement caíram. A saída é DECLARADA pelo chamador
   * (`scopeDeferred: true`), nunca inferida: criação direta via API/UI continua
   * fail-closed.
   */
  it('escopo DIFERIDO explícito é aceito (fluxo de missão em descoberta)', () => {
    for (const taskType of PATCH_PRODUCING_TASK_TYPES) {
      expect(() => assertTaskContract({ taskType, allowedPaths: [], scopeDeferred: true }))
        .not.toThrow();
      expect(() => assertTaskContract({ taskType, allowedPaths: undefined, scopeDeferred: true }))
        .not.toThrow();
    }
  });

  it('a flag é ESTRITA: só `true` libera (string/truthy NÃO libera)', () => {
    for (const valor of ['true', 1, {}, [], 'sim']) {
      expect(() => assertTaskContract({ taskType: 'CODE_GENERATION', allowedPaths: [], scopeDeferred: valor }))
        .toThrow(/TASK_CONTRACT_INVALID/);
    }
  });

  it('os DOIS chamadores de missão declaram o escopo diferido (não há porta dos fundos)', () => {
    const fs = require('fs');
    const path = require('path');
    const raiz = path.resolve(__dirname, '..', '..', '..');
    const orquestrador = fs.readFileSync(
      path.join(raiz, 'api', 'services', 'engineeringMission', 'missionOrchestratorService.js'), 'utf8');
    const bugLoop = fs.readFileSync(
      path.join(raiz, 'api', 'services', 'engineeringMission', 'bugLoopCoordinatorService.js'), 'utf8');
    expect(orquestrador).toContain('scopeDeferred: true');
    expect(bugLoop).toContain('scopeDeferred: true');
  });

  it('task de ANÁLISE não exige escopo (não escreve arquivo)', () => {
    for (const taskType of ['REPOSITORY_AUDIT', 'CODE_REVIEW', 'SECURITY_REVIEW', 'GOVERNANCE', 'RELEASE']) {
      expect(PATCH_PRODUCING_TASK_TYPES.has(taskType)).toBe(false);
      expect(() => assertTaskContract({ taskType, allowedPaths: [] })).not.toThrow();
    }
  });

  it('o erro carrega código e status HTTP de cliente (400), não 500', () => {
    let capturado = null;
    try {
      assertTaskContract({ taskType: 'CODE_GENERATION', allowedPaths: [] });
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).not.toBeNull();
    expect(capturado.code).toBe('TASK_CONTRACT_INVALID');
    expect(capturado.statusCode).toBe(400);
  });

  it('a lista de tipos que produzem patch cobre os que escrevem código/config', () => {
    for (const taskType of ['CODE_GENERATION', 'BUG_FIX', 'COMPLEX_BUG_FIX', 'REFACTOR', 'TEST_GENERATION', 'DATABASE_CHANGE', 'FRONTEND', 'DOCKER_INFRA']) {
      expect(PATCH_PRODUCING_TASK_TYPES.has(taskType)).toBe(true);
    }
  });

  it('a rota de criação traduz erro de contrato em 400 (não em 500)', () => {
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'api', 'modules', 'engineering-router', 'routes.js'),
      'utf8',
    );
    // A rota precisa RESPEITAR o statusCode 4xx do erro de contrato e propagar o
    // código — sem isto o operador recebia 500 em algo que ele mesmo corrige.
    expect(fonte).toMatch(/err\.statusCode\s*>=\s*400/);
    expect(fonte).toMatch(/error:\s*err\.code/);
    // E a validação roda ANTES de persistir (task insatisfazível não chega a existir).
    const serviceFonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'api', 'services', 'engineeringRouter', 'engineeringTaskService.js'),
      'utf8',
    );
    const posContrato = serviceFonte.indexOf('assertTaskContract({');
    const posCreate = serviceFonte.indexOf('await Model.create({');
    expect(posContrato).toBeGreaterThan(-1);
    expect(posCreate).toBeGreaterThan(posContrato);
  });
});
