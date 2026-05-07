'use strict';

/**
 * Testes para o novo sistema de step categories, actors e evidence.
 *
 * Cobre:
 * - Constantes corretas (STEP_CATEGORY_TYPES, STEP_ACTORS, mappings)
 * - normalizeStep deriva category e actor a partir do type
 * - Validação aceita category/actor válidos e rejeita inválidos
 * - Replay com resposta HTML → falha detectada
 * - Steps com evidência vinculada
 * - Jornada real (fitness-matricula-leads) contém steps com category/actor
 */

const {
  STEP_CATEGORY_TYPES,
  STEP_ACTORS,
  ACTION_CATEGORY_MAP,
  CATEGORY_ACTOR_MAP,
} = require('../waveScenario.constants');

const { adaptAiScenario, normalizeAiOutput } = require('../aiScenarioAdapter');
const { validateScenarioCompatibility } = require('../waveScenarioSchema');

// ──────────────────────────────────────────────
// 1. Constantes
// ──────────────────────────────────────────────
describe('STEP_CATEGORY_TYPES', () => {
  test('contém os 9 tipos esperados', () => {
    const expected = [
      'CLIENT_ACTION', 'SYSTEM_EVENT', 'AI_DECISION',
      'BOT_ACTION', 'HUMAN_ACTION', 'API_CALL',
      'RPA_ACTION', 'VALIDATION', 'ERROR',
    ];
    for (const t of expected) {
      expect(STEP_CATEGORY_TYPES).toContain(t);
    }
  });
});

describe('STEP_ACTORS', () => {
  test('contém os 7 atores esperados', () => {
    const expected = ['customer', 'system', 'ai', 'bot', 'agent', 'api', 'rpa'];
    for (const a of expected) {
      expect(STEP_ACTORS).toContain(a);
    }
  });
});

describe('ACTION_CATEGORY_MAP', () => {
  test('send_message → CLIENT_ACTION', () => {
    expect(ACTION_CATEGORY_MAP.send_message).toBe('CLIENT_ACTION');
  });
  test('validate_intent → AI_DECISION', () => {
    expect(ACTION_CATEGORY_MAP.validate_intent).toBe('AI_DECISION');
  });
  test('create_booking → SYSTEM_EVENT', () => {
    expect(ACTION_CATEGORY_MAP.create_booking).toBe('SYSTEM_EVENT');
  });
  test('validate_sla → VALIDATION', () => {
    expect(ACTION_CATEGORY_MAP.validate_sla).toBe('VALIDATION');
  });
  test('create_payment → API_CALL', () => {
    expect(ACTION_CATEGORY_MAP.create_payment).toBe('API_CALL');
  });
});

describe('CATEGORY_ACTOR_MAP', () => {
  test('CLIENT_ACTION → customer', () => {
    expect(CATEGORY_ACTOR_MAP.CLIENT_ACTION).toBe('customer');
  });
  test('AI_DECISION → ai', () => {
    expect(CATEGORY_ACTOR_MAP.AI_DECISION).toBe('ai');
  });
  test('BOT_ACTION → bot', () => {
    expect(CATEGORY_ACTOR_MAP.BOT_ACTION).toBe('bot');
  });
  test('HUMAN_ACTION → agent', () => {
    expect(CATEGORY_ACTOR_MAP.HUMAN_ACTION).toBe('agent');
  });
  test('RPA_ACTION → rpa', () => {
    expect(CATEGORY_ACTOR_MAP.RPA_ACTION).toBe('rpa');
  });
});

// ──────────────────────────────────────────────
// 2. normalizeStep — derivação de category/actor
// ──────────────────────────────────────────────
describe('normalizeAiOutput — derivação de category e actor', () => {
  function makeScenario(steps) {
    return {
      id: 'test-scenario',
      waveId: 'wave-test',
      vertical: 'fitness',
      journey: 'leads',
      name: 'Teste',
      source: 'manual',
      status: 'approved',
      channels: ['whatsapp'],
      risk: 'medium',
      priority: 'medium',
      steps,
    };
  }

  test('step send_message → category=CLIENT_ACTION, actor=customer', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'send_message', channel: 'whatsapp', enabled: true },
    ]));
    expect(scenario.steps[0].category).toBe('CLIENT_ACTION');
    expect(scenario.steps[0].actor).toBe('customer');
  });

  test('step validate_intent → category=AI_DECISION, actor=ai', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'validate_intent', channel: 'whatsapp', enabled: true },
    ]));
    expect(scenario.steps[0].category).toBe('AI_DECISION');
    expect(scenario.steps[0].actor).toBe('ai');
  });

  test('step com category explícita preserva category e actor', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'validate_response', channel: 'whatsapp', enabled: true, category: 'BOT_ACTION', actor: 'bot' },
    ]));
    expect(scenario.steps[0].category).toBe('BOT_ACTION');
    expect(scenario.steps[0].actor).toBe('bot');
  });

  test('step com category inválida usa fallback do mapeamento', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'validate_sla', channel: 'whatsapp', enabled: true, category: 'INVALID_CAT' },
    ]));
    // category inválida → cai para ACTION_CATEGORY_MAP[validate_sla] = VALIDATION
    expect(scenario.steps[0].category).toBe('VALIDATION');
  });

  test('step validate_backend → category=VALIDATION, actor=system', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'validate_backend', channel: 'whatsapp', enabled: true },
    ]));
    expect(scenario.steps[0].category).toBe('VALIDATION');
    expect(scenario.steps[0].actor).toBe('system');
  });

  test('step tem campo evidence inicializado como null quando não fornecido', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'send_message', channel: 'whatsapp', enabled: true },
    ]));
    expect(scenario.steps[0].evidence).toBeNull();
  });

  test('step com evidence válida preserva campos', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      {
        id: 's1', order: 1, type: 'validate_backend', channel: 'whatsapp', enabled: true,
        evidence: {
          ticketId: 'ticket-123',
          conversationId: 'conv-456',
          payload: { action: 'lead_created' },
        },
      },
    ]));
    expect(scenario.steps[0].evidence.ticketId).toBe('ticket-123');
    expect(scenario.steps[0].evidence.conversationId).toBe('conv-456');
    expect(scenario.steps[0].evidence.payload).toEqual({ action: 'lead_created' });
    expect(scenario.steps[0].evidence.screenshotBefore).toBeNull();
  });

  test('step tem campos startedAt, finishedAt, durationMs e actual inicializados', () => {
    const { scenario } = adaptAiScenario(makeScenario([
      { id: 's1', order: 1, type: 'send_message', channel: 'whatsapp', enabled: true },
    ]));
    const s = scenario.steps[0];
    expect(s.startedAt).toBeNull();
    expect(s.finishedAt).toBeNull();
    expect(s.durationMs).toBeNull();
    expect(s.actual).toBeUndefined(); // undefined pois não foi fornecido
  });
});

// ──────────────────────────────────────────────
// 3. Validação de schema com novos campos
// ──────────────────────────────────────────────
describe('validateScenarioCompatibility — novos campos', () => {
  function baseScenario(overrides = {}) {
    return {
      id: 'test-sc',
      waveId: 'wave-test',
      vertical: 'fitness',
      journey: 'leads',
      source: 'manual',
      status: 'approved',
      channels: ['whatsapp'],
      risk: 'medium',
      priority: 'medium',
      steps: [
        {
          id: 's1', order: 1, type: 'send_message', adapter: 'whatsapp',
          channel: 'whatsapp', enabled: true,
        },
        {
          id: 's2', order: 2, type: 'validate_intent', adapter: 'aiIntentService',
          channel: 'whatsapp', enabled: true, expected: { intent: 'fitness_lead' },
        },
      ],
      validations: { slaMs: 5000 },
      ...overrides,
    };
  }

  test('cenário sem category/actor é válido (backwards compat)', () => {
    const result = validateScenarioCompatibility(baseScenario());
    expect(result.valid).toBe(true);
  });

  test('step com category válida → sem erro de category', () => {
    const sc = baseScenario();
    sc.steps[0].category = 'CLIENT_ACTION';
    const result = validateScenarioCompatibility(sc);
    const catErrors = result.errors.filter((e) => e.code === 'invalid_step_category');
    expect(catErrors).toHaveLength(0);
  });

  test('step com actor válido → sem erro de actor', () => {
    const sc = baseScenario();
    sc.steps[0].actor = 'customer';
    const result = validateScenarioCompatibility(sc);
    const actorErrors = result.errors.filter((e) => e.code === 'invalid_step_actor');
    expect(actorErrors).toHaveLength(0);
  });

  test('step com category inválida → erro invalid_step_category', () => {
    const sc = baseScenario();
    sc.steps[0].category = 'NAO_EXISTE';
    const result = validateScenarioCompatibility(sc);
    const catErrors = result.errors.filter((e) => e.code === 'invalid_step_category');
    expect(catErrors).toHaveLength(1);
    expect(catErrors[0].stepId).toBe('s1');
  });

  test('step com actor inválido → erro invalid_step_actor', () => {
    const sc = baseScenario();
    sc.steps[1].actor = 'alien';
    const result = validateScenarioCompatibility(sc);
    const actorErrors = result.errors.filter((e) => e.code === 'invalid_step_actor');
    expect(actorErrors).toHaveLength(1);
    expect(actorErrors[0].stepId).toBe('s2');
  });
});

// ──────────────────────────────────────────────
// 4. Detecção de resposta HTML → FAIL
// ──────────────────────────────────────────────
describe('detectStepResultIssues — resposta HTML em vez de JSON', () => {
  /**
   * Simula a função do frontend diretamente em Node.js para testar a lógica.
   */
  function detectStepResultIssues(step) {
    const issues = [];
    const resp = step?.evidence?.apiResponse;
    if (resp && typeof resp === 'string' && /^\s*<(!DOCTYPE|html)/i.test(resp)) {
      issues.push({ type: 'html_response', message: 'API retornou HTML em vez de JSON — possível erro de rota ou proxy.' });
    }
    if (Array.isArray(step?.evidence?.consoleErrors) && step.evidence.consoleErrors.length > 0) {
      issues.push({ type: 'console_errors', message: `${step.evidence.consoleErrors.length} erro(s) crítico(s) de console detectado(s).` });
    }
    return issues;
  }

  test('step com apiResponse HTML → issue html_response', () => {
    const step = {
      evidence: { apiResponse: '<!DOCTYPE html><html><body>Not Found</body></html>' },
    };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('html_response');
  });

  test('step com apiResponse JSON válido → sem issues', () => {
    const step = {
      evidence: { apiResponse: '{"status":"ok","lead":{"id":"123"}}' },
    };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(0);
  });

  test('step com apiResponse JSON object → sem issues', () => {
    const step = {
      evidence: { apiResponse: { status: 'ok' } },
    };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(0);
  });

  test('step com consoleErrors não vazio → issue console_errors', () => {
    const step = {
      evidence: {
        consoleErrors: [
          'Uncaught TypeError: Cannot read property of undefined',
          'Failed to fetch /api/leads',
        ],
      },
    };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('console_errors');
    expect(issues[0].message).toContain('2 erro(s)');
  });

  test('step sem evidence → sem issues', () => {
    const step = { type: 'validate_intent' };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(0);
  });

  test('step com HTML minúsculo → issue html_response', () => {
    const step = {
      evidence: { apiResponse: '<html><head></head><body>Error</body></html>' },
    };
    const issues = detectStepResultIssues(step);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('html_response');
  });
});

// ──────────────────────────────────────────────
// 5. Evidência vinculada ao step (não solta)
// ──────────────────────────────────────────────
describe('evidence vinculada ao step', () => {
  test('evidence nula por padrão quando não fornecida', () => {
    const { scenario } = adaptAiScenario({
      id: 'ev-test',
      waveId: 'w1',
      vertical: 'fitness',
      journey: 'leads',
      source: 'manual',
      status: 'approved',
      channels: ['whatsapp'],
      risk: 'medium',
      priority: 'medium',
      steps: [
        { id: 's1', order: 1, type: 'validate_backend', adapter: 'api', channel: 'whatsapp', enabled: true },
      ],
    });
    // evidence deve ser null, não um objeto vazio ou omitido
    expect(scenario.steps[0].evidence).toBeNull();
  });

  test('evidence com screenshot vincula screenshotBefore e screenshotAfter ao step', () => {
    const { scenario } = adaptAiScenario({
      id: 'ev-test',
      waveId: 'w1',
      vertical: 'fitness',
      journey: 'leads',
      source: 'manual',
      status: 'approved',
      channels: ['api'],
      risk: 'low',
      priority: 'low',
      steps: [
        {
          id: 's1', order: 1, type: 'validate_backend', adapter: 'api', channel: 'api', enabled: true,
          evidence: {
            screenshotBefore: 'data:image/png;base64,BEFORE',
            screenshotAfter: 'data:image/png;base64,AFTER',
            networkEvents: [{ method: 'POST', url: '/api/leads', status: 201 }],
          },
        },
      ],
    });
    const ev = scenario.steps[0].evidence;
    expect(ev).not.toBeNull();
    expect(ev.screenshotBefore).toBe('data:image/png;base64,BEFORE');
    expect(ev.screenshotAfter).toBe('data:image/png;base64,AFTER');
    expect(ev.networkEvents).toHaveLength(1);
    expect(ev.networkEvents[0].status).toBe(201);
  });
});

// ──────────────────────────────────────────────
// 6. Jornada real: fitness-matricula-leads
// ──────────────────────────────────────────────
describe('seed fitness-matricula-leads — jornada real', () => {
  const store = require('../../../../qa/qa-waves/scenario-store.json');
  const scenario = store.scenarios.find((s) => s.id === 'fitness-matricula-leads');

  test('cenário existe no store', () => {
    expect(scenario).toBeDefined();
  });

  test('tem pelo menos 6 steps', () => {
    expect(scenario.steps.length).toBeGreaterThanOrEqual(6);
  });

  test('step 1 é CLIENT_ACTION com actor=customer', () => {
    const s = scenario.steps[0];
    expect(s.category).toBe('CLIENT_ACTION');
    expect(s.actor).toBe('customer');
    expect(s.type).toBe('send_message');
  });

  test('step 2 é SYSTEM_EVENT com actor=system', () => {
    const s = scenario.steps[1];
    expect(s.category).toBe('SYSTEM_EVENT');
    expect(s.actor).toBe('system');
  });

  test('tem pelo menos um step AI_DECISION', () => {
    const aiSteps = scenario.steps.filter((s) => s.category === 'AI_DECISION');
    expect(aiSteps.length).toBeGreaterThanOrEqual(1);
    for (const s of aiSteps) {
      expect(s.actor).toBe('ai');
    }
  });

  test('tem pelo menos um step BOT_ACTION', () => {
    const botSteps = scenario.steps.filter((s) => s.category === 'BOT_ACTION');
    expect(botSteps.length).toBeGreaterThanOrEqual(1);
    for (const s of botSteps) {
      expect(s.actor).toBe('bot');
    }
  });

  test('tem pelo menos dois steps VALIDATION', () => {
    const validations = scenario.steps.filter((s) => s.category === 'VALIDATION');
    expect(validations.length).toBeGreaterThanOrEqual(2);
  });

  test('step de validação de lead verifica backendEntity=lead', () => {
    const leadValidation = scenario.steps.find(
      (s) => s.category === 'VALIDATION' && s.expected?.backendEntity === 'lead'
    );
    expect(leadValidation).toBeDefined();
    expect(leadValidation.expected.leadCreated).toBe(true);
  });

  test('seed manual aprovado está presente', () => {
    const seed = scenario.seeds && scenario.seeds.find((s) => s.source === 'manual' && s.status === 'approved');
    expect(seed).toBeDefined();
    expect(seed.data.expectedIntent).toBe('fitness_lead');
  });

  test('todos os steps têm campo evidence (null ou objeto)', () => {
    for (const step of scenario.steps) {
      expect(step).toHaveProperty('evidence');
      // evidence pode ser null ou objeto, mas não undefined
      expect(step.evidence === null || typeof step.evidence === 'object').toBe(true);
    }
  });

  test('scenario passa pela validação de schema sem erros', () => {
    const result = validateScenarioCompatibility(scenario);
    const nonCategoryErrors = result.errors.filter(
      (e) => e.code !== 'invalid_step_category' && e.code !== 'invalid_step_actor'
    );
    expect(nonCategoryErrors).toHaveLength(0);
  });
});
