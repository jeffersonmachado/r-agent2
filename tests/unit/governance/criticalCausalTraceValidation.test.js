'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'governance', 'generate-critical-journey-evidence.js');
const RUN_ID = 'rap-release-20260821-120000-causal01';
const SOURCE_FINGERPRINT = 'a'.repeat(64);

const BOUNDARIES = [
  'WHATSAPP_INBOUND',
  'TENANT_RESOLVED',
  'PRINCIPAL_RESOLVED',
  'CONTEXT_BUILT',
  'INTENT_CLASSIFIED',
  'COGNITIVE_DECISION',
  'AGENT_SUPERVISOR_DECISION',
  'PLAN_CREATED',
  'EXECUTION_ROUTED',
  'HANDOFF_DECISION',
  'HANDOFF_REQUEST',
  'TICKET_QUEUED',
  'HUMAN_TAKEOVER',
  'HUMAN_ACTION',
  'BACKEND_MUTATION',
  'BUSINESS_OUTCOME',
  'EVIDENCE_GENERATED',
  'REPLAY_RECORDED',
];

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-causal-trace-'));
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', '.current-run.json'), JSON.stringify({
    runId: RUN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
  }));
  return root;
}

function writeJson(root, relPath, value) {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function buildTrace(overrides = {}) {
  const identities = {
    ticketId: 'ticket-causal-1',
    conversationId: 'conversation-causal-1',
    replayId: 'replay-causal-1',
    evidenceId: 'evidence-causal-1',
    outcomeId: 'outcome-causal-1',
  };
  const boundaryProof = {
    WHATSAPP_INBOUND: { messageId: 'message-causal-1', conversationId: identities.conversationId, channel: 'whatsapp' },
    COGNITIVE_DECISION: { decisionId: 'decision-causal-1', decisionType: 'handoff' },
    HANDOFF_REQUEST: { handoffRequestId: 'handoff-causal-1', conversationId: identities.conversationId },
    TICKET_QUEUED: { ticketId: identities.ticketId, conversationId: identities.conversationId },
    HUMAN_TAKEOVER: { ticketId: identities.ticketId, conversationId: identities.conversationId },
    HUMAN_ACTION: { humanActionId: 'human-action-causal-1', ticketId: identities.ticketId, conversationId: identities.conversationId },
    BACKEND_MUTATION: { mutationId: 'mutation-causal-1', ticketId: identities.ticketId, conversationId: identities.conversationId },
    BUSINESS_OUTCOME: { outcomeId: identities.outcomeId, outcomeType: 'ticket_resolved', ticketId: identities.ticketId, conversationId: identities.conversationId },
    EVIDENCE_GENERATED: { evidenceId: identities.evidenceId, outcomeId: identities.outcomeId },
    REPLAY_RECORDED: { replayId: identities.replayId, evidenceId: identities.evidenceId },
  };
  const events = BOUNDARIES.map((eventType, index) => ({
    eventType,
    eventId: `evt-${String(index + 1).padStart(2, '0')}`,
    parentEventId: index === 0 ? null : `evt-${String(index).padStart(2, '0')}`,
    causationId: index === 0 ? null : 'evt-01',
    timestamp: new Date(Date.parse('2026-08-21T12:00:00.000Z') + index * 1000).toISOString(),
    producer: `runtime.${eventType.toLowerCase()}`,
    runId: RUN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    criticalJourneyId: 'support_ticket_flow',
    correlationId: 'corr-causal-1',
    executionId: 'exec-causal-1',
    tenantId: 'tenant-causal-1',
    principalId: 'principal-causal-1',
    ...(boundaryProof[eventType] || {}),
  }));

  return {
    schemaVersion: '1.0.0',
    artifactType: 'runtime_causal_trace',
    producedBy: 'rap-runtime',
    runId: RUN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    criticalJourneyId: 'support_ticket_flow',
    correlationId: 'corr-causal-1',
    executionId: 'exec-causal-1',
    tenantId: 'tenant-causal-1',
    principalId: 'principal-causal-1',
    identities,
    events,
    ...overrides,
  };
}

function run(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const reportPath = path.join(root, 'governance', 'critical-journey-evidence.json');
  return {
    exitCode: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    report: fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null,
  };
}

describe('critical causal journey — trace runtime único e fail-closed', () => {
  test('aceita somente trace runtime completo, encadeado e ligado ao certification run', () => {
    const root = makeRoot();
    writeJson(root, 'qa/runtime/critical-causal-journey-trace.json', buildTrace());

    const result = run(root);

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      pass: true,
      decision: 'CRITICAL_JOURNEY_VALIDATED',
      runId: RUN_ID,
      sourceFingerprint: SOURCE_FINGERPRINT,
      correlationId: 'corr-causal-1',
      executionId: 'exec-causal-1',
      tenantId: 'tenant-causal-1',
      principalId: 'principal-causal-1',
      chainLength: BOUNDARIES.length,
    });
  });

  test('legacy reports presentes não substituem o trace runtime único', () => {
    const root = makeRoot();
    writeJson(root, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', {
      status: 'GO',
      flows: [{
        journeyId: 'support_ticket_flow',
        replay: { id: 'replay-Aug', status: 'GO' },
        seedEvidence: { tenantId: 'tenant-1', ticketId: 'ticket-Aug' },
        steps: [{ id: 'step_access_support_module', timestamp: '2026-08-20T00:00:00.000Z' }],
      }],
    });
    writeJson(root, 'qa/enterprise/human-handoff-full-validation.json', {
      generatedAt: '2026-05-13T00:00:00.000Z',
      tenantId: 'tenant-1',
      ticketId: 'ticket-May',
      ticket: { id: 'ticket-May', conversationId: 'conversation-May' },
      signals: { humanTakeoverObserved: true, backendMutationObserved: true },
    });
    writeJson(root, 'qa/enterprise/omnichannel-crm-mutations.json', {
      mutations: [{ journeyId: 'support_ticket_flow', observedSideEffects: ['crm_updated'] }],
    });

    const result = run(root);

    expect(result.exitCode).toBe(1);
    expect(result.report.pass).toBe(false);
    expect(result.report.decision).toBe('CRITICAL_CAUSAL_EVIDENCE_MISSING');
  });

  test.each([
    ['foreign runId', (trace) => { trace.events[6].runId = 'foreign-run'; }],
    ['foreign source fingerprint', (trace) => { trace.events[8].sourceFingerprint = 'b'.repeat(64); }],
    ['ticket identity divergence', (trace) => { trace.events[13].ticketId = 'ticket-other'; }],
    ['conversation identity divergence', (trace) => { trace.events[14].conversationId = 'conversation-other'; }],
    ['broken parent linkage', (trace) => { trace.events[9].parentEventId = 'evt-foreign'; }],
    ['broken causation linkage', (trace) => { trace.events[10].causationId = 'evt-foreign'; }],
    ['governance-produced event', (trace) => { trace.events[5].producer = 'governance.validator'; }],
  ])('rejeita %s', (_label, mutate) => {
    const root = makeRoot();
    const trace = buildTrace();
    mutate(trace);
    writeJson(root, 'qa/runtime/critical-causal-journey-trace.json', trace);

    const result = run(root);

    expect(result.exitCode).toBe(1);
    expect(result.report.pass).toBe(false);
    expect(result.report.violations.length).toBeGreaterThan(0);
  });

  test('UI access e replay GO não são proxies para inbound, cognitive decision ou outcome', () => {
    const root = makeRoot();
    const trace = buildTrace();
    trace.events = trace.events.filter((event) => ![
      'WHATSAPP_INBOUND',
      'COGNITIVE_DECISION',
      'BUSINESS_OUTCOME',
    ].includes(event.eventType));
    trace.events.unshift({
      ...buildTrace().events[0],
      eventType: 'UI_ACCESS',
      producer: 'runtime.browser',
    });
    trace.events.push({
      ...buildTrace().events.at(-1),
      eventType: 'REPLAY_GO',
      producer: 'runtime.replay',
    });
    writeJson(root, 'qa/runtime/critical-causal-journey-trace.json', trace);

    const result = run(root);

    expect(result.exitCode).toBe(1);
    expect(result.report.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('WHATSAPP_INBOUND'),
      expect.stringContaining('COGNITIVE_DECISION'),
      expect.stringContaining('BUSINESS_OUTCOME'),
    ]));
  });
});
