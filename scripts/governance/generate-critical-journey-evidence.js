#!/usr/bin/env node
'use strict';

/**
 * Critical causal journey evidence reader.
 *
 * This validator deliberately consumes one runtime-produced trace. It never
 * joins smoke, handoff, mutation or replay reports and never promotes UI/replay
 * status into operational events. Missing runtime lineage is a hard failure.
 */

const fs = require('fs');
const path = require('path');

const JOURNEY_ID = 'support_ticket_flow';
const TRACE_PATH = 'qa/runtime/critical-causal-journey-trace.json';
const REQUIRED_BOUNDARIES = Object.freeze([
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
]);

const REQUIRED_IDENTITIES = Object.freeze([
  'ticketId',
  'conversationId',
  'replayId',
  'evidenceId',
  'outcomeId',
]);

const BOUNDARY_PROOF_FIELDS = Object.freeze({
  WHATSAPP_INBOUND: ['messageId', 'conversationId', 'channel'],
  COGNITIVE_DECISION: ['decisionId', 'decisionType'],
  HANDOFF_REQUEST: ['handoffRequestId', 'conversationId'],
  TICKET_QUEUED: ['ticketId', 'conversationId'],
  HUMAN_TAKEOVER: ['ticketId', 'conversationId'],
  HUMAN_ACTION: ['humanActionId', 'ticketId', 'conversationId'],
  BACKEND_MUTATION: ['mutationId', 'ticketId', 'conversationId'],
  BUSINESS_OUTCOME: ['outcomeId', 'outcomeType', 'ticketId', 'conversationId'],
  EVIDENCE_GENERATED: ['evidenceId', 'outcomeId'],
  REPLAY_RECORDED: ['replayId', 'evidenceId'],
});

function resolveRoot(argv = process.argv) {
  const index = argv.indexOf('--root');
  return index !== -1 && argv[index + 1]
    ? path.resolve(argv[index + 1])
    : path.join(__dirname, '..', '..');
}

function readJson(root, relPath) {
  const absolutePath = path.join(root, relPath);
  if (!fs.existsSync(absolutePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isGovernanceProducer(producer) {
  return /(^|[.:/_-])(governance|validator|validation)([.:/_-]|$)/i.test(String(producer || ''));
}

function validateRequiredContext(trace, currentRun, violations) {
  const required = [
    'runId',
    'sourceFingerprint',
    'criticalJourneyId',
    'correlationId',
    'executionId',
    'tenantId',
    'principalId',
  ];

  for (const field of required) {
    if (!isNonEmptyString(trace?.[field])) {
      violations.push(`TRACE_CONTEXT_MISSING: ${field}`);
    }
  }

  if (trace?.artifactType !== 'runtime_causal_trace') {
    violations.push(`TRACE_TYPE_INVALID: artifactType=${trace?.artifactType || 'missing'}`);
  }
  if (!isNonEmptyString(trace?.producedBy) || isGovernanceProducer(trace?.producedBy)) {
    violations.push(`TRACE_PRODUCER_INVALID: producedBy=${trace?.producedBy || 'missing'}`);
  }
  if (trace?.criticalJourneyId !== JOURNEY_ID) {
    violations.push(`TRACE_JOURNEY_MISMATCH: ${trace?.criticalJourneyId || 'missing'} != ${JOURNEY_ID}`);
  }

  if (!isNonEmptyString(currentRun?.runId)) {
    violations.push('CERTIFICATION_RUN_MISSING: governance/.current-run.json.runId');
  } else if (trace?.runId !== currentRun.runId) {
    violations.push(`FOREIGN_RUN_TRACE: ${trace?.runId || 'missing'} != ${currentRun.runId}`);
  }

  if (!isNonEmptyString(currentRun?.sourceFingerprint)) {
    violations.push('SOURCE_FINGERPRINT_MISSING: governance/.current-run.json.sourceFingerprint');
  } else if (trace?.sourceFingerprint !== currentRun.sourceFingerprint) {
    violations.push('FOREIGN_SOURCE_TRACE: sourceFingerprint diverge do certification run');
  }

  if (!/^[a-f0-9]{64}$/i.test(String(trace?.sourceFingerprint || ''))) {
    violations.push('SOURCE_FINGERPRINT_INVALID: esperado SHA-256 hexadecimal');
  }

  if (!trace?.identities || typeof trace.identities !== 'object') {
    violations.push('TRACE_IDENTITIES_MISSING');
    return;
  }
  for (const field of REQUIRED_IDENTITIES) {
    if (!isNonEmptyString(trace.identities[field])) {
      violations.push(`TRACE_IDENTITY_MISSING: identities.${field}`);
    }
  }
}

function validateBoundaryProof(event, identities, violations) {
  for (const field of BOUNDARY_PROOF_FIELDS[event.eventType] || []) {
    if (!isNonEmptyString(event[field])) {
      violations.push(`BOUNDARY_PROOF_MISSING: ${event.eventType}.${field}`);
    }
  }

  if (event.eventType === 'WHATSAPP_INBOUND' && String(event.channel || '').toLowerCase() !== 'whatsapp') {
    violations.push(`INBOUND_CHANNEL_INVALID: ${event.channel || 'missing'}`);
  }

  for (const identityField of REQUIRED_IDENTITIES) {
    if (event[identityField] !== undefined && event[identityField] !== identities?.[identityField]) {
      violations.push(
        `CAUSAL_IDENTITY_MISMATCH: ${event.eventType}.${identityField}=${event[identityField]} != identities.${identityField}`,
      );
    }
  }
}

function validateEvents(trace, violations) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  if (events.length === 0) {
    violations.push('TRACE_EVENTS_MISSING');
    return;
  }

  const contextFields = [
    'runId',
    'sourceFingerprint',
    'criticalJourneyId',
    'correlationId',
    'executionId',
    'tenantId',
    'principalId',
  ];
  const eventIds = new Set();
  let previousTimestamp = -Infinity;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] || {};
    const label = event.eventType || `index:${index}`;

    if (!isNonEmptyString(event.eventType)) violations.push(`EVENT_TYPE_MISSING: index=${index}`);
    if (!isNonEmptyString(event.eventId)) {
      violations.push(`EVENT_ID_MISSING: ${label}`);
    } else if (eventIds.has(event.eventId)) {
      violations.push(`EVENT_ID_DUPLICATE: ${event.eventId}`);
    }

    for (const field of ['parentEventId', 'causationId']) {
      if (!Object.prototype.hasOwnProperty.call(event, field)) {
        violations.push(`EVENT_LINEAGE_FIELD_MISSING: ${label}.${field}`);
      }
    }

    if (index === 0) {
      if (event.parentEventId !== null) violations.push('ROOT_PARENT_INVALID: primeiro evento deve ter parentEventId=null');
      if (event.causationId !== null) violations.push('ROOT_CAUSATION_INVALID: primeiro evento deve ter causationId=null');
    } else {
      const previousEventId = events[index - 1]?.eventId;
      if (event.parentEventId !== previousEventId) {
        violations.push(`PARENT_LINK_BROKEN: ${label}.parentEventId=${event.parentEventId || 'missing'} != ${previousEventId || 'missing'}`);
      }
      if (!isNonEmptyString(event.causationId) || !eventIds.has(event.causationId)) {
        violations.push(`CAUSATION_LINK_BROKEN: ${label}.causationId=${event.causationId || 'missing'}`);
      }
    }

    const timestampMs = Date.parse(event.timestamp);
    if (!Number.isFinite(timestampMs)) {
      violations.push(`EVENT_TIMESTAMP_INVALID: ${label}`);
    } else if (timestampMs < previousTimestamp) {
      violations.push(`EVENT_TIME_ORDER_INVALID: ${label}`);
    }
    previousTimestamp = Number.isFinite(timestampMs) ? timestampMs : previousTimestamp;

    if (!isNonEmptyString(event.producer) || isGovernanceProducer(event.producer)) {
      violations.push(`EVENT_PRODUCER_INVALID: ${label}.${event.producer || 'missing'}`);
    }

    for (const field of contextFields) {
      if (!isNonEmptyString(event[field])) {
        violations.push(`EVENT_CONTEXT_MISSING: ${label}.${field}`);
      } else if (event[field] !== trace[field]) {
        violations.push(`EVENT_CONTEXT_MISMATCH: ${label}.${field}`);
      }
    }

    validateBoundaryProof(event, trace.identities, violations);
    if (isNonEmptyString(event.eventId)) eventIds.add(event.eventId);
  }

  const eventTypes = events.map((event) => event?.eventType);
  let lastBoundaryIndex = -1;
  for (const boundary of REQUIRED_BOUNDARIES) {
    const indexes = eventTypes.reduce((acc, value, index) => {
      if (value === boundary) acc.push(index);
      return acc;
    }, []);
    if (indexes.length === 0) {
      violations.push(`BOUNDARY_MISSING: ${boundary}`);
      continue;
    }
    if (indexes.length > 1) violations.push(`BOUNDARY_DUPLICATE: ${boundary}`);
    if (indexes[0] <= lastBoundaryIndex) violations.push(`BOUNDARY_ORDER_INVALID: ${boundary}`);
    lastBoundaryIndex = indexes[0];
  }
}

function validateRuntimeTrace(trace, currentRun) {
  const violations = [];
  if (!trace || typeof trace !== 'object') return ['RUNTIME_TRACE_INVALID_JSON'];
  validateRequiredContext(trace, currentRun, violations);
  validateEvents(trace, violations);
  return violations;
}

function buildMissingReport(currentRun) {
  return {
    generatedAt: new Date().toISOString(),
    runId: currentRun?.runId || null,
    sourceFingerprint: currentRun?.sourceFingerprint || null,
    engine: 'critical-journey-evidence/v3-runtime-trace-reader',
    decision: 'CRITICAL_CAUSAL_EVIDENCE_MISSING',
    pass: false,
    violations: [`RUNTIME_TRACE_MISSING: ${TRACE_PATH}`],
    causalChain: [],
    evidenceSources: [TRACE_PATH],
  };
}

function run({ root = resolveRoot() } = {}) {
  const outputPath = path.join(root, 'governance', 'critical-journey-evidence.json');
  const currentRun = readJson(root, 'governance/.current-run.json');
  const trace = readJson(root, TRACE_PATH);
  const report = trace
    ? (() => {
      const violations = validateRuntimeTrace(trace, currentRun);
      const pass = violations.length === 0;
      return {
        generatedAt: new Date().toISOString(),
        runId: trace.runId || null,
        sourceFingerprint: trace.sourceFingerprint || null,
        engine: 'critical-journey-evidence/v3-runtime-trace-reader',
        criticalJourneyId: trace.criticalJourneyId || null,
        correlationId: trace.correlationId || null,
        executionId: trace.executionId || null,
        tenantId: trace.tenantId || null,
        principalId: trace.principalId || null,
        identities: trace.identities || null,
        pass,
        decision: pass ? 'CRITICAL_JOURNEY_VALIDATED' : 'CRITICAL_JOURNEY_BROKEN',
        violations,
        chainLength: Array.isArray(trace.events) ? trace.events.length : 0,
        causalChain: Array.isArray(trace.events) ? trace.events : [],
        evidenceSources: [TRACE_PATH],
        validationSummary: {
          requiredBoundaries: REQUIRED_BOUNDARIES,
          presentBoundaries: Array.isArray(trace.events) ? trace.events.map((event) => event?.eventType).filter(Boolean) : [],
          validatorGeneratedEventIds: false,
          singleRuntimeTrace: true,
        },
      };
    })()
    : buildMissingReport(currentRun);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const log = `[critical-journey-evidence] decision=${report.decision} chain=${report.chainLength || 0} violations=${report.violations.length}`;
  if (report.pass) console.log(log);
  else console.error(log);
  for (const violation of report.violations) console.error(`  VIOLATION: ${violation}`);
  return report;
}

module.exports = {
  run,
  validateRuntimeTrace,
  REQUIRED_BOUNDARIES,
  TRACE_PATH,
};

if (require.main === module) {
  const report = run();
  process.exit(report.pass ? 0 : 1);
}
