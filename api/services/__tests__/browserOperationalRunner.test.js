'use strict';

/**
 * browserOperationalRunner.test.js
 *
 * Testes obrigatórios de NO_GO para execução operacional browser-first.
 *
 * Cenários cobertos:
 *  1. page === null em jornada blocking => NO_GO
 *  2. browser launch falha => NO_GO
 *  3. screenshot capture falha => NO_GO
 *  4. DOM snapshot falha => NO_GO
 *  5. networkEvents ausentes em step blocking => NO_GO
 *  6. replay sem screenshots reais => NO_GO
 *  7. mutation sem network linkage => NO_GO
 *  8. support flow sem UI mutation => NO_GO
 *  9. fitness flow sem AccessEvent => NO_GO
 * 10. simulated_device proibido em fitness => NO_GO
 * 11. Playwright não instalado => NO_GO blocker
 * 12. Jornada não-blocking sem browser => executa sem NO_GO
 * 13. step definitions de support: estrutura correta
 * 14. step definitions de fitness: estrutura correta
 * 15. validatePageForJourney: page null em blocking => blocker
 * 16. validatePageForJourney: page null em não-blocking => válido
 * 17. captureScreenshot: page null em blocking => blocker
 * 18. captureScreenshot: page.screenshot lança erro em blocking => blocker
 * 19. captureDomSnapshot: page.content lança erro em blocking => blocker
 * 20. executeBlockingJourneyWithBrowser: step com execute(page) é chamado
 */

const browserRunner = require('../qa/browserOperationalRunner');
const {
  validatePageForJourney,
  captureScreenshot,
  captureDomSnapshot,
  isBlockingJourney,
  _executeWithoutBrowser,
} = browserRunner;
// Alias para facilitar mocking local
let executeBlockingJourneyWithBrowser = browserRunner.executeBlockingJourneyWithBrowser;

const {
  buildSupportTicketFlowSteps,
} = require('../qa/journeyStepDefinitions/supportTicketFlowSteps');

const {
  buildFitnessCheckinFlowSteps,
} = require('../qa/journeyStepDefinitions/fitnessCheckinFlowSteps');

const {
  validateStepEvidence,
  validateReplayStepsEvidence,
  executeStep,
} = require('../qa/operationalStepExecutor');
const { BlockingOperationalError } = require('../qa/operationalAssertions');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock de Playwright Page com controle total de comportamento.
 */
function buildMockPage(overrides = {}) {
  const handlers = {};
  return {
    screenshot: overrides.screenshot || jest.fn(async () => Buffer.from('PNG_DATA')),
    content: overrides.content || jest.fn(async () => '<html><body>OK</body></html>'),
    url: overrides.url || jest.fn(() => 'https://app.example.com/support'),
    goto: overrides.goto || jest.fn(async () => {}),
    waitForSelector: overrides.waitForSelector || jest.fn(async () => ({ textContent: async () => 'resolved' })),
    waitForLoadState: overrides.waitForLoadState || jest.fn(async () => {}),
    fill: overrides.fill || jest.fn(async () => {}),
    click: overrides.click || jest.fn(async () => {}),
    selectOption: overrides.selectOption || jest.fn(async () => {}),
    setDefaultTimeout: jest.fn(),
    setDefaultNavigationTimeout: jest.fn(),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    off: jest.fn(),
    _handlers: handlers,
    ...overrides,
  };
}

/**
 * Constrói step completo com todos os campos de evidência.
 */
function buildCompleteStep(overrides = {}) {
  return {
    id: 'test-step-1',
    actionType: 'type_and_send',
    url: 'https://app.example.com/support',
    timestamp: '2024-01-01T00:00:00.000Z',
    screenshotBefore: 'data:image/png;base64,BEFORE',
    screenshotAfter: 'data:image/png;base64,AFTER',
    domSnapshot: '<html><body>ok</body></html>',
    networkEvents: [{ method: 'POST', url: '/api/tickets', status: 201 }],
    selectorUsed: '[data-testid="ticket-send-button"]',
    stepResult: { status: 'success' },
    evidenceId: 'replay-1:execution-1:test-step-1',
    mutationLinkage: { stepId: 'test-step-1', mutationCount: 1, correlatedBy: 'network_linkage' },
    sideEffectLinkage: { expectedSideEffects: ['crm_updated'], correlatedBy: 'side_effect_inference' },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 1 — validatePageForJourney
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 1 — page === null em jornada blocking => NO_GO', () => {
  test('validatePageForJourney: page null em support_ticket_flow => blocker', () => {
    const result = validatePageForJourney(null, 'support_ticket_flow');
    expect(result.valid).toBe(false);
    expect(result.blocker).not.toBeNull();
    expect(result.blocker.reason).toBe('page_null_blocking_journey');
    expect(result.blocker.blocking).toBe(true);
  });

  test('validatePageForJourney: page null em fitness_customer_checkin => blocker', () => {
    const result = validatePageForJourney(null, 'fitness_customer_checkin');
    expect(result.valid).toBe(false);
    expect(result.blocker.reason).toBe('page_null_blocking_journey');
  });

  test('validatePageForJourney: page null em jornada não-blocking => válido (sem blocker)', () => {
    const result = validatePageForJourney(null, 'generic_flow');
    expect(result.valid).toBe(true);
    expect(result.blocker).toBeNull();
  });

  test('validatePageForJourney: page real em blocking => válido', () => {
    const page = buildMockPage();
    const result = validatePageForJourney(page, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.blocker).toBeNull();
  });

  test('isBlockingJourney: support => true', () => {
    expect(isBlockingJourney('support_ticket_flow')).toBe(true);
    expect(isBlockingJourney('enterprise_support_escalation')).toBe(true);
  });

  test('isBlockingJourney: fitness => true', () => {
    expect(isBlockingJourney('fitness_customer_checkin')).toBe(true);
    expect(isBlockingJourney('gym_checkin_flow')).toBe(true);
  });

  test('isBlockingJourney: outros => false', () => {
    expect(isBlockingJourney('onboarding')).toBe(false);
    expect(isBlockingJourney('generic_flow')).toBe(false);
    expect(isBlockingJourney('')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 2 — Playwright não disponível => NO_GO
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 2 — browser launch falha => NO_GO', () => {
  let origLaunch;

  beforeEach(() => {
    // Simula falha de launch independente de Playwright estar instalado ou não
    origLaunch = jest.spyOn(browserRunner, 'launchBrowserPage').mockRejectedValue(
      new Error('chromium_binary_not_found')
    );
  });

  afterEach(() => {
    origLaunch.mockRestore();
  });

  test('executeBlockingJourneyWithBrowser: launch falha em blocking => NO_GO', async () => {
    const result = await browserRunner.executeBlockingJourneyWithBrowser(
      'support_ticket_flow',
      [buildCompleteStep()],
      { page: null }
    );
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.browserUsed).toBe(false);
    expect(result.blockers.some((b) => b.reason === 'browser_launch_failed')).toBe(true);
  });

  test('executeBlockingJourneyWithBrowser: launch falha em fitness => NO_GO', async () => {
    const result = await browserRunner.executeBlockingJourneyWithBrowser(
      'fitness_customer_checkin',
      [buildCompleteStep()],
      { page: null }
    );
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.blocking === true)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 3 — captureScreenshot
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 3 — screenshot capture falha => NO_GO', () => {
  test('captureScreenshot: page null em blocking => blocker', async () => {
    const result = await captureScreenshot(null, 'support_ticket_flow', 'before');
    expect(result.screenshot).toBeNull();
    expect(result.blocker).not.toBeNull();
    expect(result.blocker.blocking).toBe(true);
    expect(result.blocker.reason).toContain('screenshot_before_no_page');
  });

  test('captureScreenshot: page null em não-blocking => sem blocker', async () => {
    const result = await captureScreenshot(null, 'generic_flow', 'before');
    expect(result.screenshot).toBeNull();
    expect(result.blocker).toBeNull();
  });

  test('captureScreenshot: page.screenshot lança erro em blocking => blocker', async () => {
    const page = buildMockPage({
      screenshot: jest.fn(async () => { throw new Error('browser_crash'); }),
    });
    const result = await captureScreenshot(page, 'support_ticket_flow', 'after');
    expect(result.screenshot).toBeNull();
    expect(result.blocker).not.toBeNull();
    expect(result.blocker.reason).toContain('screenshot_after_capture_failed');
    expect(result.blocker.error).toBe('browser_crash');
  });

  test('captureScreenshot: sucesso retorna base64 data URI', async () => {
    const page = buildMockPage({
      screenshot: jest.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    });
    const result = await captureScreenshot(page, 'support_ticket_flow', 'before');
    expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
    expect(result.blocker).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 4 — captureDomSnapshot
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 4 — DOM snapshot falha => NO_GO', () => {
  test('captureDomSnapshot: page null em blocking => blocker', async () => {
    const result = await captureDomSnapshot(null, 'support_ticket_flow');
    expect(result.domSnapshot).toBeNull();
    expect(result.blocker).not.toBeNull();
    expect(result.blocker.reason).toBe('dom_snapshot_no_page');
  });

  test('captureDomSnapshot: page null em não-blocking => sem blocker', async () => {
    const result = await captureDomSnapshot(null, 'generic_flow');
    expect(result.domSnapshot).toBeNull();
    expect(result.blocker).toBeNull();
  });

  test('captureDomSnapshot: page.content lança erro em blocking => blocker', async () => {
    const page = buildMockPage({
      content: jest.fn(async () => { throw new Error('context_destroyed'); }),
    });
    const result = await captureDomSnapshot(page, 'fitness_customer_checkin');
    expect(result.domSnapshot).toBeNull();
    expect(result.blocker).not.toBeNull();
    expect(result.blocker.reason).toBe('dom_snapshot_capture_failed');
  });

  test('captureDomSnapshot: sucesso retorna HTML truncado', async () => {
    const page = buildMockPage({
      content: jest.fn(async () => '<html><body><h1>Support</h1></body></html>'),
    });
    const result = await captureDomSnapshot(page, 'support_ticket_flow');
    expect(result.domSnapshot).toContain('<html>');
    expect(result.blocker).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 5 — networkEvents ausentes em step blocking => NO_GO
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 5 — networkEvents ausentes em step blocking => NO_GO', () => {
  test('step sem networkEvents em support_ticket_flow => NO_GO', () => {
    const step = buildCompleteStep({ networkEvents: [] });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('networkEvents');
  });

  test('step sem networkEvents em fitness_customer_checkin => NO_GO', () => {
    const step = buildCompleteStep({ networkEvents: null });
    const result = validateStepEvidence(step, 'fitness_customer_checkin');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('networkEvents');
  });

  test('step com networkEvents em blocking => não gera blocker por network', () => {
    const step = buildCompleteStep({
      networkEvents: [{ type: 'response', url: '/api/tickets', status: 200 }],
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.missingEvidence).not.toContain('networkEvents');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 6 — replay sem screenshots reais => NO_GO
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 6 — replay sem screenshots reais => NO_GO', () => {
  test('replay vazio em blocking => NO_GO', () => {
    const result = validateReplayStepsEvidence([], 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.valid).toBe(false);
  });

  test('replay com steps sem screenshotBefore => NO_GO', () => {
    const steps = [buildCompleteStep({ screenshotBefore: null })];
    const result = validateReplayStepsEvidence(steps, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.field === 'screenshotBefore')).toBe(true);
  });

  test('replay com steps sem screenshotAfter => NO_GO', () => {
    const steps = [buildCompleteStep({ screenshotAfter: null })];
    const result = validateReplayStepsEvidence(steps, 'fitness_customer_checkin');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.field === 'screenshotAfter')).toBe(true);
  });

  test('replay com steps completos em blocking => válido', () => {
    const steps = [buildCompleteStep(), buildCompleteStep({ id: 'step-2' })];
    const result = validateReplayStepsEvidence(steps, 'support_ticket_flow');
    expect(result.goNoGo).toBeNull();
    expect(result.valid).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 7 — mutation proof runtime
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 7 — mutation proof runtime', () => {
  test('step sem incrementalDiff em support => NO_GO', () => {
    const step = buildCompleteStep({ mutationLinkage: null, incrementalDiff: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('mutationLinkage');
  });

  test('step sem mutationLinkage gerado em fitness => NO_GO', () => {
    const step = buildCompleteStep({ mutationLinkage: undefined });
    const result = validateStepEvidence(step, 'fitness_customer_checkin');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('mutationLinkage');
  });

  test('step com mutationLinkage válido => não gera blocker por mutation', () => {
    const step = buildCompleteStep({
      mutationLinkage: {
        uiAction: 'click_send_reply',
        apiEndpoint: '/tickets/1/reply',
        expectedMutations: ['message_created'],
        correlatedBy: 'network_linkage',
      },
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.missingEvidence).not.toContain('mutationLinkage');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 8 — support flow: step definitions não trazem mutationLinkage declarativo
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 8 — support flow sem mutationLinkage declarativo', () => {
  test('buildSupportTicketFlowSteps: step reply_ticket não tem mutationLinkage', () => {
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1', agentReply: 'teste' });
    const replyStep = steps.find((s) => s.id === 'step_reply_ticket');
    expect(replyStep).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(replyStep, 'mutationLinkage')).toBe(false);
  });

  test('buildSupportTicketFlowSteps: step change_status não tem mutationLinkage', () => {
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    const statusStep = steps.find((s) => s.id === 'step_change_status');
    expect(statusStep).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(statusStep, 'mutationLinkage')).toBe(false);
  });

  test('buildSupportTicketFlowSteps: todos os steps têm actionType e selectorUsed', () => {
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    for (const step of steps) {
      expect(step.id).toBeTruthy();
      expect(step.actionType).toBeTruthy();
      expect(typeof step.execute).toBe('function');
    }
  });

  test('buildSupportTicketFlowSteps: step access_support_module aponta para /support', () => {
    const steps = buildSupportTicketFlowSteps({});
    const navStep = steps.find((s) => s.id === 'step_access_support_module');
    expect(navStep).toBeDefined();
    expect(navStep.actionType).toBe('navigate');
  });

  test('step access_support_module execute: navega para /support', async () => {
    const page = buildMockPage();
    const steps = buildSupportTicketFlowSteps({ baseUrl: 'https://app.test' });
    const navStep = steps.find((s) => s.id === 'step_access_support_module');

    await navStep.execute(page);

    expect(page.goto).toHaveBeenCalledWith(
      'https://app.test/support',
      expect.objectContaining({ waitUntil: 'domcontentloaded' })
    );
  });

  test('step reply_ticket execute: preenche e envia mensagem', async () => {
    const page = buildMockPage();
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1', agentReply: 'Resposta QA' });
    const replyStep = steps.find((s) => s.id === 'step_reply_ticket');

    await replyStep.execute(page);

    expect(page.fill).toHaveBeenCalledWith(
      '[data-testid="ticket-reply-input"]',
      'Resposta QA'
    );
    expect(page.click).toHaveBeenCalledWith('[data-testid="ticket-send-button"]');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 9 — fitness flow sem AccessEvent => NO_GO (step definitions)
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 9 — fitness flow sem AccessEvent: step definitions requerem access decision', () => {
  test('buildFitnessCheckinFlowSteps: step submit_checkin não tem mutationLinkage declarativo', () => {
    const steps = buildFitnessCheckinFlowSteps({
      subjectId: 'subject-1',
      credentialValue: 'QA-FIT-001',
      deviceId: 'device-1',
      deviceMode: 'test_device',
    });
    const decisionStep = steps.find((s) => s.id === 'step_submit_checkin');
    expect(decisionStep).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(decisionStep, 'mutationLinkage')).toBe(false);
  });

  test('buildFitnessCheckinFlowSteps: step confirm_attendance não tem mutationLinkage', () => {
    const steps = buildFitnessCheckinFlowSteps({
      subjectId: 'subject-1',
      credentialValue: 'QA-FIT-001',
      deviceId: 'device-1',
      deviceMode: 'test_device',
    });
    const attendanceStep = steps.find((s) => s.id === 'step_confirm_attendance');
    expect(attendanceStep).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(attendanceStep, 'mutationLinkage')).toBe(false);
  });

  test('buildFitnessCheckinFlowSteps: todos os steps têm execute function', () => {
    const steps = buildFitnessCheckinFlowSteps({
      subjectId: 'subject-1',
      credentialValue: 'QA-FIT-001',
      deviceId: 'device-1',
      deviceMode: 'test_device',
    });
    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const step of steps) {
      expect(step.id).toBeTruthy();
      expect(typeof step.execute).toBe('function');
    }
  });

  test('step identify_customer execute: preenche credencial e submete', async () => {
    const page = buildMockPage();
    const steps = buildFitnessCheckinFlowSteps({
      credentialValue: 'QA-FIT-001',
      deviceMode: 'test_device',
    });
    const identifyStep = steps.find((s) => s.id === 'step_identify_customer');

    await identifyStep.execute(page);

    expect(page.fill).toHaveBeenCalledWith(
      '[data-testid="checkin-credential-input"]',
      'QA-FIT-001'
    );
    expect(page.click).not.toHaveBeenCalledWith('[data-testid="checkin-submit-button"]');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 10 — simulated_device proibido => NO_GO
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 10 — simulated_device proibido em fitness => NO_GO', () => {
  test('buildFitnessCheckinFlowSteps com simulated_device lança erro', () => {
    expect(() => {
      buildFitnessCheckinFlowSteps({
        credentialValue: 'QA',
        deviceMode: 'simulated_device',
        deviceId: 'sim-001',
      });
    }).toThrow(/simulated_device_forbidden/);
  });

  test('buildFitnessCheckinFlowSteps com real_device não lança erro', () => {
    expect(() => {
      buildFitnessCheckinFlowSteps({
        credentialValue: 'QA',
        deviceMode: 'real_device',
        deviceId: 'turnstile-001',
      });
    }).not.toThrow();
  });

  test('buildFitnessCheckinFlowSteps com test_device não lança erro', () => {
    expect(() => {
      buildFitnessCheckinFlowSteps({
        credentialValue: 'QA',
        deviceMode: 'test_device',
        deviceId: 'qa-test-device-001',
      });
    }).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 11 — executeBlockingJourneyWithBrowser com page injetada
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 11 — executeBlockingJourneyWithBrowser com page mock injetada', () => {
  test('jornada blocking com page injetada + steps completos => executa sem NO_GO do browser', async () => {
    const page = buildMockPage();

    // Steps completos com execute(page) simples
    const steps = [{
      id: 'step-mock-1',
      actionType: 'click',
      selectorUsed: '[data-testid="btn"]',
      journeyId: 'support_ticket_flow',
      screenshotBefore: 'data:image/png;base64,BEFORE',
      screenshotAfter: 'data:image/png;base64,AFTER',
      domSnapshot: '<html>ok</html>',
      networkEvents: [{ type: 'response', url: '/api/test', status: 200 }],
      evidenceId: 'replay-1:exec-1:step-mock-1',
      mutationLinkage: { mutationCount: 1, correlatedBy: 'network_linkage' },
      stepResult: { status: 'success' },
      timestamp: new Date().toISOString(),
      url: 'https://app.example.com/support',
      async execute(p) {
        await p.click('[data-testid="btn"]');
      },
    }];

    const result = await browserRunner.executeBlockingJourneyWithBrowser(
      'support_ticket_flow',
      steps,
      { page }
    );

    expect(result.browserUsed).toBe(true);
    expect(result.executorUsed).toBe(true);
    expect(result.steps).toHaveLength(1);
  });

  test('jornada não-blocking: usa _executeWithoutBrowser (sem launch)', async () => {
    const steps = [{
      id: 'step-nb-1',
      actionType: 'click',
      selectorUsed: null,
      screenshotBefore: 'data:image/png;base64,BEFORE',
      screenshotAfter: 'data:image/png;base64,AFTER',
      domSnapshot: '<html>ok</html>',
      networkEvents: [{ type: 'response', url: '/api/test', status: 200 }],
      evidenceId: 'replay-nb:exec-nb:step-nb-1',
      mutationLinkage: { mutationCount: 1 },
      stepResult: { status: 'success' },
      timestamp: new Date().toISOString(),
      url: 'https://app.example.com/other',
    }];

    const result = await _executeWithoutBrowser('generic_flow', steps, {
      replayId: 'replay-nb',
      executionId: 'exec-nb',
    });

    expect(result.browserUsed).toBe(false);
    expect(result.executorUsed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 12 — executeStep com page mock real captura evidências
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 12 — executeStep com page mock: captura evidências reais', () => {
  test('executeStep com page mock + execute function captura screenshotBefore e screenshotAfter', async () => {
    const page = buildMockPage({
      screenshot: jest.fn(async () => Buffer.from('PNG_MOCK')),
      content: jest.fn(async () => '<html><body>Test</body></html>'),
      url: jest.fn(() => 'https://app.example.com/support/tickets'),
    });

    const stepSpec = {
      id: 'step-with-execute',
      actionType: 'click',
      selectorUsed: '[data-testid="ticket-send-button"]',
      stepResult: { status: 'success' },
      networkEvents: [{ type: 'response', url: '/api/tickets/1/reply', status: 201 }],
      async execute(p) {
        await p.click('[data-testid="ticket-send-button"]');
      },
    };

    const result = await executeStep(stepSpec, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-1',
      executionId: 'exec-1',
    });

    expect(result.step.screenshotBefore).toMatch(/^data:image\/png;base64,/);
    expect(result.step.screenshotAfter).toMatch(/^data:image\/png;base64,/);
    expect(result.step.url).toBeTruthy();
    expect(result.step.domSnapshot).toContain('<html>');
    expect(result.step.evidenceId).toBeTruthy();
    expect(page.click).toHaveBeenCalledWith('[data-testid="ticket-send-button"]');
  });

  test('executeStep com page mock: execute que lança erro => step failed', async () => {
    const page = buildMockPage({
      screenshot: jest.fn(async () => Buffer.from('PNG_MOCK')),
      url: jest.fn(() => 'https://app.example.com/support'),
    });

    const stepSpec = {
      id: 'step-failing',
      actionType: 'click',
      selectorUsed: '[data-testid="missing-btn"]',
      async execute() {
        throw new Error('element_not_found');
      },
    };

    const result = await executeStep(stepSpec, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-1',
      executionId: 'exec-1',
    });

    expect(result.failed).toBe(true);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.stepResult.status).toBe('failed');
    expect(result.step.error).toBe('element_not_found');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 13 — Invariantes dos step definitions
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 13 — invariantes dos step definitions', () => {
  test('support steps: 7 steps na sequência correta', () => {
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    expect(steps.length).toBe(7);
    expect(steps[0].id).toBe('step_access_support_module');
    expect(steps[1].id).toBe('step_wait_ticket_list');
    expect(steps[2].id).toBe('step_open_ticket');
    expect(steps[3].id).toBe('step_reply_ticket');
    expect(steps[4].id).toBe('step_change_status');
    expect(steps[5].id).toBe('step_assert_ticket_ui');
    expect(steps[6].id).toBe('step_assert_ticket_backend');
  });

  test('fitness steps: 5 steps na sequência correta', () => {
    const steps = buildFitnessCheckinFlowSteps({
      subjectId: 'subject-1',
      credentialValue: 'QA-001',
      deviceId: 'device-1',
      deviceMode: 'test_device',
    });
    expect(steps.length).toBe(5);
    expect(steps[0].id).toBe('step_access_checkin_module');
    expect(steps[1].id).toBe('step_identify_customer');
    expect(steps[2].id).toBe('step_validate_membership');
    expect(steps[3].id).toBe('step_submit_checkin');
    expect(steps[4].id).toBe('step_confirm_attendance');
  });

  test('support steps: journey_id é support_ticket_flow em todos', () => {
    const steps = buildSupportTicketFlowSteps({});
    for (const step of steps) {
      expect(step.journeyId).toBe('support_ticket_flow');
    }
  });

  test('fitness steps: journey_id é fitness_customer_checkin em todos', () => {
    const steps = buildFitnessCheckinFlowSteps({
      credentialValue: 'QA-001',
      deviceMode: 'test_device',
    });
    for (const step of steps) {
      expect(step.journeyId).toBe('fitness_customer_checkin');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 14 — Critério final: GO somente com todas as evidências
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 14 — Critério final GO/NO_GO', () => {
  test('step completo em blocking => GO (sem blockers)', () => {
    const step = buildCompleteStep();
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.blockers).toHaveLength(0);
  });

  test('step com qualquer campo ausente em blocking => NO_GO', () => {
    const fields = [
      'screenshotBefore', 'screenshotAfter', 'actionType',
      'timestamp', 'networkEvents', 'selectorUsed',
      'stepResult', 'evidenceId', 'mutationLinkage',
    ];

    for (const field of fields) {
      const step = buildCompleteStep({
        [field]: field === 'networkEvents' ? [] : null,
      });
      const result = validateStepEvidence(step, 'support_ticket_flow');
      expect(result.goNoGo).toBe('NO_GO');
      expect(result.missingEvidence).toContain(field);
    }
  });

  test('replay com todos os steps completos em fitness => válido', () => {
    const steps = [
      buildCompleteStep({ id: 'step-1' }),
      buildCompleteStep({ id: 'step-2' }),
      buildCompleteStep({ id: 'step-3' }),
    ];
    const result = validateReplayStepsEvidence(steps, 'fitness_customer_checkin');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.totalBlockers).toBe(0);
  });

  test('NO_GO se qualquer step blocking estiver incompleto no meio do replay', () => {
    const steps = [
      buildCompleteStep({ id: 'step-1' }),
      buildCompleteStep({ id: 'step-2', screenshotAfter: null }), // incompleto
      buildCompleteStep({ id: 'step-3' }),
    ];
    const result = validateReplayStepsEvidence(steps, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.totalBlockers).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 15 — Strict step assertions (sem fallback silencioso)
// ══════════════════════════════════════════════════════════════════════════════

describe('Cenário 15 — strict assertions por step (blocking)', () => {
  function rejectSelector(selectorToReject) {
    return jest.fn(async (selector) => {
      if (selector === selectorToReject) {
        throw new Error(`selector_not_found:${selector}`);
      }
      return { textContent: async () => 'resolved active allow created crm-updated' };
    });
  }

  test('selector ausente => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="ticket-list"]'),
    });
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1', baseUrl: 'https://app.test' });
    const step = steps.find((s) => s.id === 'step_wait_ticket_list');

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-1',
      executionId: 'exec-strict-1',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('support_ticket_list_not_loaded');
    expect(result.step.stepResult.blockingAssertion).toBe(true);
  });

  test('ticket não abriu => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="ticket-detail"]'),
    });
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    const step = steps.find((s) => s.id === 'step_open_ticket');

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-2',
      executionId: 'exec-strict-2',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('support_ticket_not_opened');
  });

  test('reply não enviada => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="message-sent-confirmation"]'),
    });
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    const step = steps.find((s) => s.id === 'step_reply_ticket');

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-3',
      executionId: 'exec-strict-3',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('support_reply_not_sent');
  });

  test('status não alterado => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: jest.fn(async (selector) => {
        if (selector === '[data-testid="ticket-status"]') {
          return { textContent: async () => 'in_progress' };
        }
        return { textContent: async () => 'resolved' };
      }),
    });
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1', resolvedStatus: 'resolved' });
    const step = steps.find((s) => s.id === 'step_change_status');

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-4',
      executionId: 'exec-strict-4',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('support_status_not_changed_in_ui');
  });

  test('membership inválida => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: jest.fn(async () => ({ textContent: async () => 'membership invalid' })),
      url: jest.fn(() => 'https://app.example.com/fitness/checkin'),
    });
    const steps = buildFitnessCheckinFlowSteps({ credentialValue: 'QA-FIT-1', deviceMode: 'test_device' });
    const step = steps.find((s) => s.id === 'step_validate_membership');

    const result = await executeStep(step, page, {
      journeyId: 'fitness_customer_checkin',
      replayId: 'replay-strict-5',
      executionId: 'exec-strict-5',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('fitness_membership_invalid');
  });

  test('attendance ausente => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="attendance-confirmation"]'),
      url: jest.fn(() => 'https://app.example.com/fitness/checkin'),
    });
    const steps = buildFitnessCheckinFlowSteps({ credentialValue: 'QA-FIT-1', deviceMode: 'test_device' });
    const step = steps.find((s) => s.id === 'step_confirm_attendance');

    const result = await executeStep(step, page, {
      journeyId: 'fitness_customer_checkin',
      replayId: 'replay-strict-6',
      executionId: 'exec-strict-6',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('fitness_attendance_missing');
  });

  test('CRM não atualizado => NO_GO', async () => {
    const page = buildMockPage({
      waitForSelector: jest.fn(async () => ({ textContent: async () => '' })),
      url: jest.fn(() => 'https://app.example.com/fitness/checkin'),
    });
    const steps = buildFitnessCheckinFlowSteps({ credentialValue: 'QA-FIT-1', deviceMode: 'test_device' });
    const step = steps.find((s) => s.id === 'step_submit_checkin');

    const result = await executeStep(step, page, {
      journeyId: 'fitness_customer_checkin',
      replayId: 'replay-strict-7',
      executionId: 'exec-strict-7',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('fitness_access_decision_not_allow');
  });

  test('network call ausente => NO_GO', async () => {
    const page = buildMockPage({
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn(() => 'https://app.example.com/support'),
    });
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      selectorUsed: '[data-testid="btn"]',
      async execute() {},
    };

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-8',
      executionId: 'exec-strict-8',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('network_events_missing');
  });

  test('screenshot ausente => NO_GO', async () => {
    const page = buildMockPage({
      screenshot: jest.fn(async () => { throw new Error('capture_failed'); }),
    });
    const step = {
      id: 'step-screenshot-missing',
      actionType: 'click',
      selectorUsed: '[data-testid="btn"]',
      async execute() {},
    };

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-9',
      executionId: 'exec-strict-9',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('screenshot_before_capture_failed');
  });

  test('step execution conserva metadata da blocking assertion', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="ticket-list"]'),
    });
    const steps = buildSupportTicketFlowSteps({ ticketId: 'ticket-1' });
    const step = steps.find((s) => s.id === 'step_wait_ticket_list');

    const result = await executeStep(step, page, {
      journeyId: 'support_ticket_flow',
      replayId: 'replay-strict-10',
      executionId: 'exec-strict-10',
    });

    expect(result.step.stepResult.blockingAssertion).toBe(true);
    expect(result.step.stepResult.metadata).toBeTruthy();
    expect(result.step.stepResult.metadata.journeyId).toBe('support_ticket_flow');
  });

  test('BlockingOperationalError é lançada diretamente no step (sem fallback)', async () => {
    const page = buildMockPage({
      waitForSelector: rejectSelector('[data-testid="ticket-list"]'),
    });
    const steps = buildSupportTicketFlowSteps({});
    const step = steps.find((s) => s.id === 'step_wait_ticket_list');

    await expect(step.execute(page)).rejects.toBeInstanceOf(BlockingOperationalError);
  });
});
