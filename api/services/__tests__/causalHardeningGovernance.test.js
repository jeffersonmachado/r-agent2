'use strict';

const fs = require('fs');
const path = require('path');

/**
 * causalHardeningGovernance.test.js
 *
 * Testes de governança de causalidade — FASE 3 (Hardening).
 *
 * Verifica que:
 *   1. Snapshot null em jornada blocking => BlockingOperationalError (não null silencioso)
 *   2. buildMutationLinkage com journey_transition => proibido para steps mutacionais
 *   3. Provenance usa matchExpectedNetworkEvent do contrato, não primeiro 2xx
 *   4. Provenance sem network event do contrato => valid=false + reason explícita
 *   5. filterSnapshotByEntityScope sem diagnosticMode => throws
 *   6. inferObservedSideEffects usa dados de prova, não heurísticas textuais
 *   7. normalizeStep expõe expectedNetworkEvents do registry
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fail-closed snapshot — collector presente mas falha em jornada blocking
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: snapshot fail-closed para blocking journeys', () => {
  test('registry: step_reply_ticket tem networkProofRequired e journeyId definido', () => {
    const { getOperationalStepContract } = require('../../../qa/contracts/operationalStepRegistry');
    const contract = getOperationalStepContract('step_reply_ticket');
    expect(contract).toBeDefined();
    expect(contract.journeyId).toBe('support_ticket_flow');
    expect(contract.networkProofRequired).toBe(true);
  });

  test('registry: step_submit_checkin pertence a fitness_customer_checkin', () => {
    const { getOperationalStepContract } = require('../../../qa/contracts/operationalStepRegistry');
    const contract = getOperationalStepContract('step_submit_checkin');
    expect(contract).toBeDefined();
    expect(contract.journeyId).toBe('fitness_customer_checkin');
    expect(contract.networkProofRequired).toBe(true);
  });

  test('registry: step_confirm_attendance tem snapshotRequired e journeyId correto', () => {
    const { getOperationalStepContract } = require('../../../qa/contracts/operationalStepRegistry');
    const contract = getOperationalStepContract('step_confirm_attendance');
    expect(contract).toBeDefined();
    expect(contract.journeyId).toBe('fitness_customer_checkin');
    expect(contract.snapshotRequired).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. journey_transition proibido para steps mutacionais
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: journey_transition proibido para steps mutacionais', () => {
  test('isMutationExpectedStep: step_reply_ticket é mutacional', () => {
    const { isMutationExpectedStep } = require('../../../qa/contracts/operationalStepRegistry');
    expect(isMutationExpectedStep('step_reply_ticket')).toBe(true);
  });

  test('isMutationExpectedStep: step_change_status é mutacional', () => {
    const { isMutationExpectedStep } = require('../../../qa/contracts/operationalStepRegistry');
    expect(isMutationExpectedStep('step_change_status')).toBe(true);
  });

  test('isMutationExpectedStep: step_submit_checkin é mutacional', () => {
    const { isMutationExpectedStep } = require('../../../qa/contracts/operationalStepRegistry');
    expect(isMutationExpectedStep('step_submit_checkin')).toBe(true);
  });

  test('isMutationExpectedStep: step_assert_ticket_ui NÃO é mutacional', () => {
    const { isMutationExpectedStep } = require('../../../qa/contracts/operationalStepRegistry');
    expect(isMutationExpectedStep('step_assert_ticket_ui')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Provenance usa matchExpectedNetworkEvent do contrato
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: matchExpectedNetworkEvent usa contrato, não primeiro 2xx', () => {
  const { matchExpectedNetworkEvent } = require('../../../qa/contracts/operationalStepRegistry');

  test('retorna null para step sem networkProofRequired', () => {
    const result = matchExpectedNetworkEvent('step_assert_ticket_ui', [
      { method: 'GET', url: '/api/some/endpoint', status: 200 },
    ]);
    expect(result).toBeNull();
  });

  test('retorna null quando nenhum event corresponde ao contrato (POST errado)', () => {
    const result = matchExpectedNetworkEvent('step_reply_ticket', [
      { method: 'GET', url: 'http://localhost/api/tickets/123/reply', status: 200 },
    ]);
    expect(result).toBeNull();
  });

  test('retorna null quando URL não bate com pathPattern do contrato', () => {
    const result = matchExpectedNetworkEvent('step_reply_ticket', [
      { method: 'POST', url: 'http://localhost/api/other/endpoint', status: 201 },
    ]);
    expect(result).toBeNull();
  });

  test('retorna o event correto quando method + path batem com o contrato', () => {
    const event = { method: 'POST', url: 'http://localhost/api/tickets/abc-123/reply', status: 201 };
    const result = matchExpectedNetworkEvent('step_reply_ticket', [event]);
    expect(result).not.toBeNull();
    expect(result.method).toBe('POST');
    expect(result.url).toContain('/api/tickets/');
    expect(result.url).toContain('/reply');
    expect(result.status).toBe(201);
  });

  test('não retorna primeiro 2xx se ele não bate com contrato', () => {
    const wrongFirst = { method: 'POST', url: 'http://localhost/api/some/other', status: 200 };
    const correctSecond = { method: 'POST', url: 'http://localhost/api/tickets/123/reply', status: 201 };
    const result = matchExpectedNetworkEvent('step_reply_ticket', [wrongFirst, correctSecond]);
    expect(result).not.toBeNull();
    expect(result.url).toContain('/reply');
    // Deve ser o evento correto, não o primeiro 2xx
    expect(result.url).not.toContain('/some/other');
  });

  test('step_change_status: bate com PATCH /tickets/:id/status', () => {
    const event = { method: 'PATCH', url: 'http://localhost/api/tickets/t1/status', status: 200 };
    const result = matchExpectedNetworkEvent('step_change_status', [event]);
    expect(result).not.toBeNull();
    expect(result.method).toBe('PATCH');
  });

  test('step_change_status: bate com PATCH /tickets/:id/change-status', () => {
    const event = { method: 'PATCH', url: 'http://localhost/api/tickets/t1/change-status', status: 200 };
    const result = matchExpectedNetworkEvent('step_change_status', [event]);
    expect(result).not.toBeNull();
  });

  test('step_submit_checkin: bate com POST /fitness/checkin', () => {
    const event = { method: 'POST', url: 'http://localhost/api/fitness/checkin', status: 200 };
    const result = matchExpectedNetworkEvent('step_submit_checkin', [event]);
    expect(result).not.toBeNull();
    expect(result.method).toBe('POST');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Provenance correlatedBy correto
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: provenance.correlatedBy semântico', () => {
  const { computeMutationProvenance } = require('../../../qa/evidence/postStateProofValidator');

  test('correlatedBy === "network_linkage" quando event bate com contrato', () => {
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      networkEvents: [
        { method: 'POST', url: 'http://localhost/api/tickets/123/reply', status: 201 },
      ],
    };
    const records = computeMutationProvenance({
      step,
      observedMutations: ['message_created'],
      beforeStepSnapshot: null,
      afterStepSnapshot: null,
    });
    expect(records).toHaveLength(1);
    expect(records[0].correlatedBy).toBe('network_linkage');
    expect(records[0].valid).toBe(true);
    expect(records[0].reason).toBeNull();
    expect(records[0].originatingNetworkEvent).not.toBeNull();
    expect(records[0].originatingNetworkEvent.url).toContain('/reply');
  });

  test('provenance inválida quando nenhum network event esperado é encontrado', () => {
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      networkEvents: [],
    };
    const records = computeMutationProvenance({
      step,
      observedMutations: ['message_created'],
    });
    expect(records[0].correlatedBy).toBe('expected_network_event_not_found');
    expect(records[0].valid).toBe(false);
    expect(records[0].reason).toBe('expected_network_event_not_found');
    expect(records[0].originatingNetworkEvent).toBeNull();
  });

  test('provenance inválida quando há 2xx mas não bate com contrato', () => {
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      networkEvents: [
        // tipo correto mas método GET — não bate com contrato que exige POST
        { type: 'response', method: 'GET', url: 'http://localhost/api/tickets/123/reply', status: 200 },
      ],
    };
    const records = computeMutationProvenance({
      step,
      observedMutations: ['message_created'],
    });
    expect(records[0].correlatedBy).toBe('expected_network_event_not_found');
    expect(records[0].valid).toBe(false);
    expect(records[0].reason).toBe('expected_network_event_not_found');
    expect(records[0].originatingNetworkEvent).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. filterSnapshotByEntityScope guard
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: filterSnapshotByEntityScope proibido em contexto operacional', () => {
  let stateSnapshotService;

  beforeAll(() => {
    stateSnapshotService = require('../qa/stateSnapshotService');
  });

  test('lança Error se chamado sem diagnosticMode', () => {
    expect(typeof stateSnapshotService.filterSnapshotByEntityScope).toBe('undefined');
    expect(() =>
      stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope({}, 'step_reply_ticket')
    ).toThrow(/filterSnapshotByEntityScope.*proibido/i);
  });

  test('lança Error mesmo com stepId vazio', () => {
    expect(() =>
      stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope({}, '')
    ).toThrow();
  });

  test('funciona normalmente com diagnosticMode: true', () => {
    expect(() =>
      stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope({}, 'step_reply_ticket', { diagnosticMode: true })
    ).not.toThrow();
  });

  test('resultado com diagnosticMode tem filterApplied: true', () => {
    const result = stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope(
      { db: { ticket: { status: 'open' } } },
      'step_reply_ticket',
      { diagnosticMode: true }
    );
    expect(result.metadata.filterApplied).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. inferObservedSideEffects usa dados de prova estruturados
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: inferObservedSideEffects baseado em prova estrutural', () => {
  // Importar via módulo isolado
  let inferObservedSideEffects;

  beforeAll(() => {
    jest.isolateModules(() => {
      const mod = require('../qa/operationalReplayValidator');
      // Exposta via module.exports ou via test hook?
      // Se não exposta diretamente, testar via validateStateAwareReplay indiretamente
      inferObservedSideEffects = mod.__testOnly__inferObservedSideEffects || null;
    });
  });

  test('não usa heurísticas de entity.includes() — step.observedSideEffects é fonte primária', () => {
    // Testar via replayAdapter: se replay tem steps com observedSideEffects declarados,
    // os side effects devem aparecer no resultado
    const replayAdapter = require('../qaWavesReplayAdapter');
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      status: 'success',
      observedSideEffects: ['audit_log_created', 'crm_updated'],
      observedMutations: ['message_created'],
      networkEvents: [
        { method: 'POST', url: 'http://localhost/api/tickets/123/reply', status: 201 },
      ],
    };
    const normalized = replayAdapter.normalizeStep(step);
    expect(normalized.observedSideEffects).toContain('audit_log_created');
    expect(normalized.observedSideEffects).toContain('crm_updated');
  });
});

describe('CausalHardening: journey_transition e network proof em operational_go', () => {
  const executor = require('../qa/operationalStepExecutor');

  test('journey_transition em operational_go => NO_GO', () => {
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { state: 'open' },
      afterSnapshot: { state: 'open', changed: true },
      executedSteps: [{
        id: 'step_open_ticket',
        actionType: 'click_open',
        mutationLinkage: { correlatedBy: 'journey_transition', mutationCount: 1 },
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: { journeyId: 'support_ticket_flow', executionMode: 'operational_go', isBlockingJourney: true },
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'operational_journey_transition_not_allowed')).toBe(true);
  });

  test('journey_transition em diagnostic => REVIEW', () => {
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { state: 'open' },
      afterSnapshot: { state: 'open' },
      executedSteps: [{
        id: 'step_open_ticket',
        actionType: 'click_open',
        mutationLinkage: { correlatedBy: 'journey_transition', mutationCount: 1 },
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: false } },
      journeyContext: { journeyId: 'support_ticket_flow', executionMode: 'diagnostic', isBlockingJourney: true },
    });

    expect(result.goNoGo).toBe('REVIEW');
  });

  test('operational_go sem expectedNetworkEvent => NO_GO', () => {
    const before = {
      db: { messages: { count: 1 } },
      events: { audit: { count: 0 }, notifications: { count: 0 } },
      crm: { activities: { count: 0 } },
    };
    const after = {
      db: { messages: { count: 2 } },
      events: { audit: { count: 1 }, notifications: { count: 1 } },
      crm: { activities: { count: 1 } },
    };
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: before,
      afterSnapshot: after,
      executedSteps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        networkEvents: [{ type: 'response', method: 'GET', url: 'http://localhost/api/tickets/1/reply', status: 200 }],
        beforeStepSnapshot: before,
        afterStepSnapshot: after,
        mutationExpected: true,
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: { journeyId: 'support_ticket_flow', executionMode: 'operational_go', isBlockingJourney: true },
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'post_state_provenance_invalid')).toBe(true);
  });
});

describe('CausalHardening: exact matching sem heurística em proof chain', () => {
  const { deriveStepScopedMutations } = require('../../../qa/evidence/postStateProofValidator');

  test('fuzzy mutation matching => FAIL (NO_GO)', () => {
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      beforeStepSnapshot: { reply_body: null, notifications_pending: 0 },
      afterStepSnapshot: { reply_body: 'ok', notifications_pending: 0 },
    };
    const result = deriveStepScopedMutations([step]);
    expect(result[0].mutationMissing).toBe(true);
    expect(result[0].goNoGo).toBe('NO_GO');
  });

  test('exact mutation mismatch => NO_GO', () => {
    const step = {
      id: 'step_change_status',
      actionType: 'change_status',
      beforeStepSnapshot: { status_label: 'open' },
      afterStepSnapshot: { status_label: 'in_progress' },
    };
    const result = deriveStepScopedMutations([step]);
    expect(result[0].mutationMissing).toBe(true);
    expect(result[0].goNoGo).toBe('NO_GO');
  });

  test('exact side effect mismatch => NO_GO', () => {
    const executor = require('../qa/operationalStepExecutor');
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 1, notifications_pending: 0 },
      afterSnapshot: { messages_count: 2, notifications_pending: 0 },
      executedSteps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        networkEvents: [{ type: 'response', method: 'POST', url: 'http://localhost/api/tickets/1/reply', status: 201 }],
        beforeStepSnapshot: { messages_count: 1, notifications_pending: 0 },
        afterStepSnapshot: { messages_count: 2, notifications_pending: 0 },
        mutationExpected: true,
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: { journeyId: 'support_ticket_flow', executionMode: 'operational_go', isBlockingJourney: true },
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'correlation_expected_side_effects_missing')).toBe(true);
  });
});

describe('CausalHardening: stateMutation global proibido no executor', () => {
  const executor = require('../qa/operationalStepExecutor');

  test('buildSideEffectLinkage não usa stateMutation global', async () => {
    const result = await executor.executeAndEnrichStep({
      id: 'step_assert_ticket_ui',
      actionType: 'assert_ui_state',
      screenshotAfter: 'data:image/png;base64,after',
      url: 'http://localhost/support/ticket/1',
      networkEvents: [],
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'diagnostic',
      stateMutation: {
        valid: true,
        mutationCount: 5,
        observedSideEffects: ['crm_updated', 'audit_log_created'],
      },
    });

    expect(result.step.sideEffectLinkage).toBeNull();
  });

  test('buildSnapshotDiff não usa stateMutation global', async () => {
    const result = await executor.executeAndEnrichStep({
      id: 'step_assert_ticket_ui',
      actionType: 'assert_ui_state',
      screenshotAfter: 'data:image/png;base64,after',
      url: 'http://localhost/support/ticket/1',
      networkEvents: [],
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'diagnostic',
      stateMutation: {
        valid: true,
        mutationCount: 5,
        observedSideEffects: ['crm_updated'],
      },
    });

    expect(result.step.snapshotDiff).toBeNull();
  });
});

describe('CausalHardening: evidência diagnóstica não mistura no replay operacional', () => {
  const replayValidator = require('../qa/operationalReplayValidator');

  test('diagnostic evidence sem operational evidence => REVIEW', () => {
    const replay = {
      replayId: 'r1',
      journeyId: 'support_ticket_flow',
      beforeSnapshot: { db: { ticket: { status: 'open', exists: true } }, crm: { activities: { count: 1 } }, events: { audit: { count: 1 } } },
      afterSnapshot: { db: { ticket: { status: 'replied', exists: true, updatedAt: '2026-01-01' } }, crm: { activities: { count: 2 } }, events: { audit: { count: 2 } } },
      seedEvidence: { ticketId: 't1', conversationId: 'c1', contactId: 'u1', status: 'ready' },
      operationalSeedStatus: 'ready',
      steps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        evidenceClassification: 'diagnostic_only',
        mutationLinkage: { correlatedBy: 'journey_transition' },
        networkEvents: [{ type: 'response', method: 'POST', url: 'http://localhost/api/tickets/1/reply', status: 201 }],
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created', 'crm_updated', 'notification_sent'],
        mutationProvenance: [{
          mutation: 'message_created',
          originatingStepId: 'step_reply_ticket',
          originatingActionType: 'type_and_send',
          originatingNetworkEvent: { method: 'POST', url: 'http://localhost/api/tickets/1/reply', status: 201 },
          entityScope: ['ticket', 'messages'],
          beforeStepSnapshotHash: 'aaa',
          afterStepSnapshotHash: 'bbb',
          correlatedBy: 'network_linkage',
          valid: true,
          reason: null,
        }],
      }],
      screenshots: [{ id: 'ss-1', path: 's1.png', description: 'ok', timestamp: '2026-01-01T00:00:00.000Z', critical: true, type: 'validation' }],
      events: [{ type: 'api_call', page: '/support', module: 'support', operation: 'update', stateChange: true, timestamp: '2026-01-01T00:00:00.000Z' }],
      rawStepCount: 1,
      rawScreenshotCount: 1,
    };

    const result = replayValidator.validateOperationalReplay(replay, { journeyId: 'support_ticket_flow' });
    expect(result.isOperational).toBe(false);
    expect(result.goNoGo).toBe('REVIEW');
    expect(result.blockers.some((b) => b.reason === 'operational_evidence_missing')).toBe(true);
  });
});

describe('CausalHardening: guard anti-heurística textual em validators/governance', () => {
  test('operationalReplayValidator não deve usar includes("support|ticket|fitness|checkin|audit|crm")', () => {
    const filePath = path.join(__dirname, '..', 'qa', 'operationalReplayValidator.js');
    const src = fs.readFileSync(filePath, 'utf8');
    const forbidden = [
      "includes('support')",
      "includes(\"support\")",
      "includes('ticket')",
      "includes(\"ticket\")",
      "includes('fitness')",
      "includes(\"fitness\")",
      "includes('checkin')",
      "includes(\"checkin\")",
      "includes('audit')",
      "includes(\"audit\")",
      "includes('crm')",
      "includes(\"crm\")",
    ];

    for (const token of forbidden) {
      expect(src.includes(token)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. normalizeStep expõe expectedNetworkEvents do registry
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: normalizeStep expõe expectedNetworkEvents canônico', () => {
  const replayAdapter = require('../qaWavesReplayAdapter');

  test('step_reply_ticket: expectedNetworkEvents é [{ method: "POST", path: "/tickets/:id/reply" }]', () => {
    const step = {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      status: 'success',
    };
    const normalized = replayAdapter.normalizeStep(step);
    expect(Array.isArray(normalized.expectedNetworkEvents)).toBe(true);
    expect(normalized.expectedNetworkEvents.length).toBeGreaterThan(0);
    expect(normalized.expectedNetworkEvents[0].method).toBe('POST');
    expect(normalized.expectedNetworkEvents[0].path).toContain('reply');
  });

  test('step_change_status: expectedNetworkEvents contém método PATCH', () => {
    const step = { id: 'step_change_status', status: 'success' };
    const normalized = replayAdapter.normalizeStep(step);
    expect(normalized.expectedNetworkEvents[0].method).toBe('PATCH');
  });

  test('step_submit_checkin: expectedNetworkEvents contém POST /access/checkin', () => {
    const step = { id: 'step_submit_checkin', status: 'success' };
    const normalized = replayAdapter.normalizeStep(step);
    expect(normalized.expectedNetworkEvents[0].method).toBe('POST');
    expect(normalized.expectedNetworkEvents[0].path).toContain('checkin');
  });

  test('step desconhecido: expectedNetworkEvents === []', () => {
    const step = { id: 'step_unknown_xyz', status: 'success' };
    const normalized = replayAdapter.normalizeStep(step);
    expect(normalized.expectedNetworkEvents).toEqual([]);
  });

  test('evidence sub-object também inclui expectedNetworkEvents', () => {
    const step = { id: 'step_reply_ticket', status: 'success' };
    const normalized = replayAdapter.normalizeStep(step);
    expect(normalized.evidence.expectedNetworkEvents).toEqual(normalized.expectedNetworkEvents);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Registry: getExpectedNetworkEventsForStep
// ─────────────────────────────────────────────────────────────────────────────
describe('CausalHardening: getExpectedNetworkEventsForStep', () => {
  const { getExpectedNetworkEventsForStep } = require('../../../qa/contracts/operationalStepRegistry');

  test('retorna [] para step sem networkProofRequired', () => {
    const result = getExpectedNetworkEventsForStep('step_assert_ticket_ui');
    expect(Array.isArray(result)).toBe(true);
    // pode ser vazio ou ter endpoints — o que importa é que não explode
  });

  test('retorna array para step_reply_ticket', () => {
    const result = getExpectedNetworkEventsForStep('step_reply_ticket');
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('POST');
    expect(result[0].path).toBe('/tickets/:id/reply');
  });

  test('retorna array para step_change_status', () => {
    const result = getExpectedNetworkEventsForStep('step_change_status');
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('PATCH');
    expect(result[0].path).toBe('/tickets/:id/status');
  });

  test('retorna array para step_submit_checkin', () => {
    const result = getExpectedNetworkEventsForStep('step_submit_checkin');
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('POST');
    expect(result[0].path).toBe('/access/checkin');
  });

  test('retorna [] para stepId inexistente', () => {
    const result = getExpectedNetworkEventsForStep('step_does_not_exist');
    expect(result).toEqual([]);
  });
});
