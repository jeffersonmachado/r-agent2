'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { signReplayArtifact } = require('../../../lib/replayIntegrity');

jest.mock('../../../qa-mesh/meshRunner', () => ({
  runMesh: jest.fn(),
}));

const { getJourneySteps } = require('../../../qa/contracts/operationalStepRegistry');

/**
 * Materializa network events concretos a partir do contrato do registry
 * (expectedNetworkEvents em formato canonico → URLs reais com status 2xx).
 * Garante que matchExpectedNetworkEvent() encontra pelo menos um evento valido.
 */
function materializeNetworkEvents(spec) {
  const expected = Array.isArray(spec.expectedNetworkEvents) && spec.expectedNetworkEvents.length > 0
    ? spec.expectedNetworkEvents
    : [{ method: 'POST', path: '/tickets/:id/event' }];
  return expected.map((evt, index) => ({
    id: `net-${spec.stepId}-${index + 1}`,
    type: 'response',
    method: String(evt.method || 'POST').split('|')[0].trim(),
    url: `/api${String(evt.path || '').replace(/:[^/]+/g, 'ticket-1')}`,
    status: 200,
  }));
}

/**
 * Gera os steps operacionais da jornada a partir do operationalStepRegistry.
 *
 * Cada step satisfaz, por actionType, os campos exigidos por
 * validateEvidenceByContract (qa/evidence/stepEvidenceContracts.js) e, para
 * steps com mutationExpected=true, a proveniencia completa exigida por
 * validateMutationProvenanceCompleteness / validateJourneyOperationalFlow /
 * replayHasDeterministicOperationalProof (api/services/qa/operationalReplayValidator.js).
 * Gerar do registry torna o teste robusto a novos steps na jornada.
 */
function buildJourneyReplaySteps(journeyId) {
  const specs = Object.values(getJourneySteps(journeyId));
  return specs.map((spec, index) => {
    const step = {
      id: spec.stepId,
      actionType: spec.actionType,
      timestamp: `2026-05-07T10:01:${String(10 + index).padStart(2, '0')}.000Z`,
      stepResult: 'pass',
      evidenceId: `ev-${spec.stepId}`,
      url: '/support',
      page: '/support',
      selector: `[data-testid="${spec.stepId}"]`,
      dataTestId: spec.stepId,
      screenshotBefore: `/tmp/${spec.stepId}-before.png`,
      screenshotAfter: `/tmp/${spec.stepId}-after.png`,
      domAfter: `<div data-testid="${spec.stepId}"></div>`,
    };

    if (spec.networkProofRequired) {
      step.networkEvents = materializeNetworkEvents(spec);
    }

    if (spec.mutationExpected) {
      const networkEvents = step.networkEvents || materializeNetworkEvents(spec);
      step.networkEvents = networkEvents;
      step.observedMutations = [...spec.expectedMutations];
      step.observedSideEffects = Array.from(new Set([
        ...spec.expectedSideEffects,
        ...spec.expectedMutations,
      ]));
      step.incrementalDiff = { changed: true };
      step.networkCorrelation = networkEvents;
      step.mutationLinkage = {
        correlatedBy: 'network_linkage',
        source: 'network_event',
        mutations: [...spec.expectedMutations],
      };
      step.sideEffectLinkage = { sideEffects: [...step.observedSideEffects] };
      step.mutationProvenance = spec.expectedMutations.map((mutation) => ({
        mutation,
        originatingStepId: spec.stepId,
        originatingActionType: spec.actionType,
        originatingNetworkEvent: networkEvents[0],
        entityScope: Array.isArray(spec.entityScope) && spec.entityScope.length > 0
          ? [...spec.entityScope]
          : ['ticket'],
        beforeStepSnapshotHash: `sha256:before:${spec.stepId}`,
        afterStepSnapshotHash: `sha256:after:${spec.stepId}`,
        valid: true,
        correlatedBy: 'network_linkage',
      }));
    }

    return step;
  });
}

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
        signReplayArtifact({
          tenantId: 'tenant-1',
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
          steps: buildJourneyReplaySteps('support_ticket_flow'),
        }, {
          tenantId: 'tenant-1',
          governance: { goNoGo: 'GO', isOperational: true, blockers: [] },
        }),
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
        evidenceDir: path.dirname(replayPath),
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
    expect({ status: result.status, blockers: result.governance.blockers }).toEqual({
      status: 'GO',
      blockers: [],
    });
    expect(result.execution.attempts).toBe(2);
    expect(result.execution.remediationAttempts).toHaveLength(1);
    expect(result.replay.validation.isOperational).toBe(true);
    expect(result.replay.consequences.valid).toBe(true);
    expect(result.chainValidation.valid).toBe(true);
    expect(result.governance.goNoGo).toBe('GO');
  });
});
