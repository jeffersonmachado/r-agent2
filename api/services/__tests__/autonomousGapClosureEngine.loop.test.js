'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../qa-mesh/meshRunner', () => ({
  runMesh: jest.fn(),
}));

jest.mock('../qa/gapDetectionEngine', () => ({
  detectGaps: jest.fn(() => ({
    gaps: { operational: [] },
    governance: { goNoGo: 'GO', blockers: [] },
  })),
}));

jest.mock('../qa/dataTestIdValidationService', () => ({
  scanDataTestIds: jest.fn(() => ({ uniqueIds: ['ticket-send-button'], duplicates: [], inaccessible: [] })),
  validateCapabilityDataTestIds: jest.fn(() => ({ status: 'GO', relatedTestIds: ['ticket-send-button'], missing: [], remediation: [] })),
}));

jest.mock('../qa/preflightEngine', () => ({
  executeFullPreflight: jest.fn(async () => ({ status: 'GO', reason: null, missing: [] })),
  validateJourneyPreconditions: jest.fn(async () => ({ status: 'GO', reason: null, missing: [] })),
}));

jest.mock('../qa/autoScenarioGenerator', () => ({
  generateScenariosForGaps: jest.fn(() => []),
  persistGeneratedArtifacts: jest.fn(),
}));

jest.mock('../qa/seedInferenceService', () => ({
  generateSeedsForCapability: jest.fn(() => [{ type: 'happy_path', data: { seed: true } }]),
}));

jest.mock('../qa/uiStepInferenceService', () => ({
  inferUIStepsForCapability: jest.fn(() => [{ type: 'click', selector: "[data-testid='ticket-send-button']" }]),
}));

jest.mock('../qa/validatorInferenceService', () => ({
  inferValidatorsForCapability: jest.fn(() => [{ name: 'ticket_status_updated', type: 'assertion' }]),
}));

describe('autonomousGapClosureEngine runAutonomousGapClosureLoop', () => {
  let replayPath;
  let runMesh;
  let engine;

  beforeEach(() => {
    jest.resetModules();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomous-loop-'));
    replayPath = path.join(tmpDir, 'replay.json');

    fs.writeFileSync(
      replayPath,
      JSON.stringify(
        {
          replayId: 'replay-1',
          journeyId: 'support_ticket_flow',
          duration: 12000,
          initialState: 'ticket_open',
          transitionState: 'ticket_replied',
          finalState: 'crm_updated',
          beforeSnapshot: {
            state: 'ticket_open',
            db: { ticketStatus: 'open', ticket: { exists: true, status: 'open', messages: { count: 1 } } },
            crm: { activities: { count: 0 } },
            events: { audit: { count: 0 } },
            api: { support: { ticket: { status: 'open' } } },
            support: { ticket: { status: 'open', id: 'ticket-1' } },
            audit: { events: { count: 0 } },
            metadata: {
              sources: { db: true, api: true, support: true, crm: true, audit: true },
            },
          },
          afterSnapshot: {
            state: 'crm_updated',
            db: { ticketStatus: 'replied', ticket: { exists: true, status: 'replied', messages: { count: 2 }, updatedAt: '2026-05-07T10:00:05.000Z' } },
            crm: { updated: true, activities: { count: 1 } },
            events: { audit: { count: 1 } },
            api: { support: { ticket: { status: 'replied' } } },
            support: { ticket: { status: 'replied', id: 'ticket-1' } },
            audit: { events: { count: 1 } },
            metadata: {
              sources: { db: true, api: true, support: true, crm: true, audit: true },
            },
          },
          events: [
            { id: 'e1', type: 'navigate', module: 'auth', page: '/login', delay: 700 },
            {
              id: 'e2',
              type: 'click',
              module: 'ticket',
              page: '/support',
              delay: 900,
              attempt: 2,
              stateChange: true,
              operation: 'update',
              entity: 'ticket',
              dataTestId: 'ticket-send-button',
              action: 'reply_ticket',
            },
            { id: 'e3', type: 'api_call', module: 'ticket', page: '/ticket/1', operation: 'write', isExternal: true, entity: 'ticket' },
            { id: 'e3b', type: 'api_call', module: 'ticket', page: '/crm', operation: 'update', isExternal: true, entity: 'crm' },
            { id: 'e4', type: 'click', module: 'ticket', page: '/ticket/1', operation: 'write', entity: 'ticket' },
            { id: 'e5', type: 'notification', module: 'notification', page: '/ticket/1', eventEmitted: true },
            { id: 'e6', type: 'event', module: 'audit', page: '/audit', operation: 'insert' },
          ],
          screenshots: [
            {
              id: 's1',
              path: '/tmp/s1.png',
              timestamp: '2026-05-07T10:00:00.000Z',
              description: 'validacao final',
              critical: true,
              type: 'validation',
            },
          ],
          auditLog: [{ action: 'ticket_update' }],
          dataMutations: {
            ticket: [{ field: 'status', from: 'waiting', to: 'in_progress' }],
          },
          seedEvidence: {
            status: 'ok',
            ticketId: 'ticket-1',
            conversationId: 'conv-1',
            contactId: 'contact-1',
          },
          steps: [
            {
              id: 'step-list',
              actionType: 'navigate',
              dataTestId: 'ticket-list',
              selector: '[data-testid="ticket-list"]',
              timestamp: '2026-05-07T10:00:01.000Z',
              stepResult: 'pass',
              evidenceId: 'ev-1',
              url: '/support',
              screenshotAfter: '/tmp/s-list.png',
              domAfter: '<div data-testid="ticket-list"></div>',
            },
            {
              id: 'step-open',
              actionType: 'navigate',
              dataTestId: 'ticket-card',
              selector: '[data-testid="ticket-card"]',
              timestamp: '2026-05-07T10:00:02.000Z',
              stepResult: 'pass',
              evidenceId: 'ev-2',
              url: '/ticket/1',
              screenshotAfter: '/tmp/s-open.png',
              domAfter: '<div data-testid="ticket-card"></div>',
            },
          ],
        },
        null,
        2
      )
    );

    runMesh = require('../../../qa-mesh/meshRunner').runMesh;
    runMesh
      .mockResolvedValueOnce({
        summary: { goNoGo: 'NO_GO', executionCoverage: 35, executionQuality: 'low' },
        results: [],
        historyPath: null,
        evidenceDir: null,
      })
      .mockResolvedValueOnce({
        summary: { goNoGo: 'GO', executionCoverage: 92, executionQuality: 'high' },
        results: [{ artifacts: [{ type: 'replay', path: replayPath }] }],
        historyPath: '/tmp/history.json',
        evidenceDir: '/tmp/evidence',
      });

    engine = require('../qa/autonomousGapClosureEngine');
  });

  test('executa recovery loop e conclui GO apos retry com replay operacional valido', async () => {
    const result = await engine.runAutonomousGapClosureLoop({
      waveId: 'wave-1',
      journeyId: 'support_ticket_flow',
      scenarioIds: ['scenario-1'],
      capabilityIds: ['ticket-reply'],
      tenantId: 'tenant-1',
      capabilities: [{ id: 'ticket-reply', name: 'support_ticket_flow' }],
      expectedConsequences: ['ticket_status_changed'],
      maxRetries: 1,
      context: {},
    });

    expect(runMesh).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('GO');
    expect(result.execution.attempts).toBe(2);
    expect(result.execution.remediationAttempts).toHaveLength(1);
    expect(result.replay.validation.isOperational).toBe(true);
    expect(result.replay.consequences.valid).toBe(true);
    expect(result.chainValidation.valid).toBe(true);
    expect(result.governance.goNoGo).toBe('GO');
  });
});
