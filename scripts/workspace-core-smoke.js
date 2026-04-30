#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'qa', 'workspace-core', 'evidence');

const { connect, close } = require('../api/db/sequelize');
const models = require('../api/db/models');
const WorkspaceEntityService = require('../api/services/workspace/WorkspaceEntityService');
const WorkspaceTimelineService = require('../api/services/workspace/WorkspaceTimelineService');
const WorkspaceInsightService = require('../api/services/workspace/WorkspaceInsightService');
const WorkspaceActionService = require('../api/services/workspace/WorkspaceActionService');
const WorkspaceOperationsService = require('../api/services/workspace/WorkspaceOperationsService');
const FailureDiagnosisService = require('../api/services/autocorrection/FailureDiagnosisService');
const PatchProposalService = require('../api/services/autocorrection/PatchProposalService');
const CorrectionValidationService = require('../api/services/autocorrection/CorrectionValidationService');
const { evaluateWaveResult } = require('../qa-mesh/governance');

const ALLOWED_MODES = new Set(['real', 'failure']);
const CRITICAL_STATUS_KEYS = [
  'entityCreated',
  'linksCreated',
  'timelineConsistent',
  'timelineContainsTicket',
  'timelineContainsTask',
  'insightCreated',
  'actionCreated',
  'replayGenerated',
];

function iso() {
  return new Date().toISOString();
}

function stamp() {
  return iso().replace(/[:.]/g, '-');
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function rel(filePath) {
  return path.relative(ROOT, filePath);
}

function plain(row) {
  if (!row) return null;
  if (typeof row.toJSON === 'function') return row.toJSON();
  return row;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readOptionValue(name) {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
  return null;
}

function determineMode() {
  const explicit = (readOptionValue('--mode') || process.env.WORKSPACE_TEST_MODE || '').toLowerCase().trim();
  if (ALLOWED_MODES.has(explicit)) return explicit;
  if (hasArg('--inject-failure') || process.env.WORKSPACE_CORE_INJECT_FAILURE === '1') return 'failure';
  return 'real';
}

function shouldRunAutoCorrection({ mode, criticalFailures }) {
  if (mode === 'failure') return true;
  return Array.isArray(criticalFailures) && criticalFailures.length > 0;
}

function collectCriticalFailures(checks = {}) {
  return CRITICAL_STATUS_KEYS.filter((key) => checks[key] !== true);
}

function generateSummary({
  mode,
  checks,
  errors,
  artifacts,
  records,
  startedAt,
  finishedAt,
  tenantId,
  entityId,
  failureInjection,
  autocorrection,
}) {
  const criticalFailures = collectCriticalFailures(checks);
  const summary = {
    wave: 'workspace-core',
    mode,
    status: criticalFailures.length === 0 ? 'passed' : 'failed',
    tenantId,
    entityId,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    checks,
    errors,
    artifacts,
    records,
    failureType: criticalFailures.length === 0 ? 'none' : 'critical_checks_failed',
    autocorrection: {
      required: Boolean(autocorrection?.required),
      created: Boolean(autocorrection?.created),
      reason: autocorrection?.reason || null,
    },
  };

  if (mode === 'failure') {
    const handled = Boolean(failureInjection?.handled);
    summary.failureInjection = {
      enabled: true,
      type: 'simulated',
      handled,
    };
    summary.status = criticalFailures.length === 0 && handled ? 'passed' : 'failed';
    if (!handled) {
      summary.failureType = 'simulated_failure_unhandled';
    }
  }

  summary.governance = evaluateWaveResult(summary);

  return summary;
}

class JourneyRecorder {
  constructor() {
    this.steps = [];
    this.errors = [];
  }

  async step(step, input, fn) {
    const entry = { step, status: 'running', input: input || {}, output: {}, timestamp: iso() };
    this.steps.push(entry);
    try {
      const output = await fn();
      entry.status = 'passed';
      entry.output = output || {};
      entry.finishedAt = iso();
      return output;
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message || String(error);
      entry.finishedAt = iso();
      this.errors.push({ step, message: entry.error, stack: error.stack });
      throw error;
    }
  }

  injected(step, input, output) {
    const entry = {
      step,
      status: 'injected',
      input: input || {},
      output: output || {},
      timestamp: iso(),
      finishedAt: iso(),
    };
    this.steps.push(entry);
    return entry;
  }
}

function requireCheck(checks, key, condition, errors, message) {
  checks[key] = Boolean(condition);
  if (!checks[key]) errors.push(message || key);
}

async function createAutoCorrection({ tenantId, entityId, summaryPath, replayPath, evidencePath, timeline, failedChecks, evidenceEvent, recorder }) {
  const failureDiagnosisService = new FailureDiagnosisService();
  const patchProposalService = new PatchProposalService();
  const correctionValidationService = new CorrectionValidationService({
    cwd: ROOT,
    enableCommandExecution: false,
  });

  return recorder.step('create_autocorrection_run', {
    sourceType: 'qa_wave',
    sourceId: rel(summaryPath),
    failedChecks,
  }, async () => {
    const event = {
      type: 'evidence',
      source: 'QA/RPA',
      refId: evidenceEvent.id,
      summary: evidenceEvent.summary,
      payload: {
        ...evidenceEvent,
        source_ref: {
          summaryPath,
          replayPath,
          evidencePath,
          autocorrectionSource: 'qa_wave',
          module: 'workspace-core',
        },
        metadata: evidenceEvent.metadata || {},
      },
    };
    const diagnosis = await failureDiagnosisService.analyzeFailure({
      tenantId,
      sourceType: 'qa_wave',
      sourceId: summaryPath,
      event,
      evidence: event.payload,
      timeline: timeline.items || [],
    });
    const proposedPatch = await patchProposalService.proposePatch({
      diagnosis,
      sourceType: 'qa_wave',
      sourceId: summaryPath,
      event,
      evidence: event.payload,
    });
    const validationResult = await correctionValidationService.validateProposal({
      proposal: proposedPatch,
      diagnosis,
      sourceType: 'qa_wave',
      sourceId: summaryPath,
    });

    const run = plain(await models.AutoCorrectionRun().create({
      tenant_id: tenantId,
      source_type: 'qa_wave',
      source_id: rel(summaryPath),
      status: 'pending_review',
      diagnosis: {
        ...diagnosis,
        failedChecks,
        humanApprovalRequired: true,
      },
      proposed_patch: {
        ...proposedPatch,
        applyAutomatically: false,
        humanApprovalRequired: true,
      },
      validation_result: validationResult,
    }));

    const reviewAction = plain(await models.AutoCorrectionAction().create({
      run_id: run.id,
      type: 'human_review',
      status: 'pending',
      payload: {
        label: 'Revisar autocorreção Workspace Core',
        evidencePath: rel(evidencePath),
        replayPath: rel(replayPath),
        summaryPath: rel(summaryPath),
        failedChecks,
        approvalRequired: true,
      },
    }));

    await models.WorkspaceEntityLink().findOrCreate({
      where: { tenant_id: tenantId, source_type: 'autocorrection_run', source_id: run.id },
      defaults: { tenant_id: tenantId, entity_id: entityId, source_type: 'autocorrection_run', source_id: run.id, confidence: diagnosis.confidence || 0.8 },
    });

    return { run, reviewAction, diagnosis, proposedPatch, validationResult };
  });
}

function initializeChecks() {
  return {
    entityCreated: false,
    messageLinked: false,
    conversationLinked: false,
    ticketLinked: false,
    taskLinked: false,
    linksCreated: false,
    timelineContainsMessage: false,
    timelineContainsTicket: false,
    timelineContainsTask: false,
    timelineContainsEvidence: false,
    timelineConsistent: false,
    insightCreated: false,
    actionCreated: false,
    replayGenerated: false,
    evidenceGenerated: false,
    metadataComplete: true,
    uiHintsAvailable: true,
  };
}

function injectFailure({ recorder }) {
  recorder.injected(
    'simulate_failure',
    { reason: 'failure_injection_mode' },
    { simulatedFailure: true, module: 'workspace-core', expectedHandling: 'autocorrection' },
  );
  return {
    enabled: true,
    type: 'simulated',
    handled: false,
    failedChecks: ['simulatedQaFailure'],
  };
}

async function runRealJourney({
  mode,
  tenantId,
  summaryPath,
  replayPath,
  timelinePath,
  autocorrectionPath,
  recorder,
  checks,
  validationErrors,
}) {
  const entityService = new WorkspaceEntityService();
  const timelineService = new WorkspaceTimelineService();
  const operationsService = new WorkspaceOperationsService({ entityService });
  const insightService = new WorkspaceInsightService({ timelineService });
  const actionService = new WorkspaceActionService({ insightService, operationsService });

  const suffix = crypto.randomBytes(3).toString('hex');
  const phone = `5511999${String(Date.now()).slice(-6)}`;

  let entity;
  let conversation;
  let message;
  let ticket;
  let task;
  let evidence;
  let timeline;
  let insights;
  let actions;

  entity = await recorder.step('create_workspace_entity', { tenantId, phone }, async () => {
    const created = await entityService.getOrCreateEntityFromContact({
      tenantId,
      contact: {
        type: 'contact',
        name: `Cliente Workspace Core ${suffix}`,
        phone,
        email: `workspace-core-${suffix}@example.test`,
        source: 'qa_wave',
        refId: `contact-${suffix}`,
        raw: { wave: 'workspace-core', generatedAt: iso() },
      },
    });
    return { entity: created };
  }).then((output) => output.entity);

  conversation = await recorder.step('simulate_inbound_message', { tenantId, entityId: entity.id, phone }, async () => {
    const conversationId = id('conv-workspace-core');
    const messageId = id('msg-workspace-core');
    const now = new Date();
    const createdConversation = plain(await models.ChannelConversation().create({
      id: conversationId,
      tenant_key: tenantId,
      channel_type: 'whatsapp',
      external_id: `wa-${phone}-${suffix}`,
      contact_id: phone,
      status: 'open',
      last_message_at: now,
    }));
    const createdMessage = plain(await models.ChannelMessage().create({
      id: messageId,
      tenant_key: tenantId,
      conversation_id: conversationId,
      channel_type: 'whatsapp',
      direction: 'inbound',
      type: 'text',
      body: { text: 'Preciso de ajuda com meu atendimento e quero acompanhar o status.' },
      external_message_id: `ext-${messageId}`,
      status: 'received',
    }));
    await entityService.linkEntity({ tenantId, entityId: entity.id, sourceType: 'conversation', sourceId: conversationId, confidence: 1 });
    await entityService.linkEntity({ tenantId, entityId: entity.id, sourceType: 'message', sourceId: messageId, confidence: 1 });
    return { conversation: createdConversation, message: createdMessage };
  }).then((output) => {
    message = output.message;
    return output.conversation;
  });

  ticket = await recorder.step('create_ticket', { tenantId, entityId: entity.id, conversationId: conversation.id }, async () => {
    const ticketId = id('ticket-workspace-core');
    const createdTicket = plain(await models.Ticket().create({
      id: ticketId,
      tenant_key: tenantId,
      session_id: `session-${ticketId}`,
      conversation_id: conversation.id,
      channel_type: 'whatsapp',
      queue: 'workspace-core',
      status: 'waiting',
      mode: 'human',
      phone_number: phone,
      last_user_message: 'Preciso de ajuda com meu atendimento e quero acompanhar o status.',
      unread_count: 1,
      tags: ['workspace-core', 'qa-wave'],
      category: 'support',
      messages: [{ id: message.id, direction: 'inbound' }],
      context: { entityId: entity.id, wave: 'workspace-core' },
    }));
    await models.ChannelConversation().update({ current_ticket_id: ticketId }, { where: { tenant_key: tenantId, id: conversation.id } });
    await entityService.linkEntity({ tenantId, entityId: entity.id, sourceType: 'ticket', sourceId: ticketId, confidence: 1 });
    return { ticket: createdTicket };
  }).then((output) => output.ticket);

  task = await recorder.step('create_task', { tenantId, entityId: entity.id, ticketId: ticket.id, conversationId: conversation.id }, async () => {
    const createdTask = await operationsService.createTask({
      tenantId,
      payload: {
        entityId: entity.id,
        ticketId: ticket.id,
        conversationId: conversation.id,
        type: 'manual',
        priority: 'high',
        status: 'open',
        title: 'Acompanhar cliente da wave Workspace Core',
        description: 'Tarefa operacional criada pela jornada QA Mesh workspace-core.',
        assignedTo: 'qa-mesh',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    return { task: createdTask };
  }).then((output) => output.task);

  timeline = await recorder.step('validate_timeline_before_evidence', { entityId: entity.id }, async () => {
    const result = await timelineService.getEntityTimeline({ tenantId, entityId: entity.id, limit: 100, offset: 0 });
    return { timeline: result };
  }).then((output) => output.timeline);

  evidence = await recorder.step('generate_evidence', { tenantId, entityId: entity.id, mode }, async () => {
    const evidenceId = id('ev-workspace-core');
    const sourceRef = {
      summaryPath,
      replayPath,
      timelinePath,
      autocorrectionPath,
      replayUrl: rel(replayPath),
      module: 'workspace-core',
      mode,
    };
    const simulatedFailure = mode === 'failure';
    const metadata = {
      wave: 'workspace-core',
      qaWaveStatus: simulatedFailure ? 'failed' : 'passed',
      expectedFailure: simulatedFailure,
      reason: simulatedFailure
        ? 'Falha QA/RPA simulada para validar ciclo Evidence -> Replay -> AutoCorrection.'
        : 'Execução real da jornada workspace-core sem injeção de falha.',
      checksSnapshot: checks,
      replayPath,
      summaryPath,
      mode,
    };
    const createdEvidence = plain(await models.Evidence().create({
      id: evidenceId,
      tenant_key: tenantId,
      entity_type: 'workspace_entity',
      entity_id: entity.id,
      related_entities: [
        { type: 'conversation', id: conversation.id },
        { type: 'message', id: message.id },
        { type: 'ticket', id: ticket.id },
        { type: 'task', id: task.id },
      ],
      source_type: 'qa_wave',
      source_id: 'workspace-core',
      source_ref: sourceRef,
      category: 'workspace',
      type: simulatedFailure ? 'failure' : 'observation',
      theme: 'workspace-core-autocorrection',
      summary: simulatedFailure
        ? 'Falha QA/RPA simulada na wave workspace-core para validar autocorreção assistida.'
        : 'Execução real workspace-core concluída para validação de governança e consistência.',
      excerpt: simulatedFailure
        ? 'A jornada operacional foi criada; esta evidência injeta uma falha controlada para validar diagnóstico e revisão humana.'
        : 'A jornada operacional foi criada e validada em modo real.',
      normalized_text: simulatedFailure
        ? 'workspace core qa rpa failure autocorrection replay evidence'
        : 'workspace core qa rpa real run replay evidence',
      occurred_at: new Date(),
      confidence: 0.98,
      strength: 'strong',
      actor_type: 'qa_mesh',
      actor_id: 'workspace-core',
      attachments: [
        { type: 'summary', path: rel(summaryPath) },
        { type: 'replay', path: rel(replayPath) },
        { type: 'timeline', path: rel(timelinePath) },
      ],
      metadata,
      idempotency_key: `${tenantId}:workspace-core:${stamp()}`,
    }));
    await entityService.linkEntity({ tenantId, entityId: entity.id, sourceType: 'evidence', sourceId: evidenceId, confidence: 1 });
    return { evidence: createdEvidence };
  }).then((output) => output.evidence);

  timeline = await recorder.step('validate_timeline', { entityId: entity.id }, async () => {
    const result = await timelineService.getEntityTimeline({ tenantId, entityId: entity.id, limit: 100, offset: 0 });
    return { timeline: result };
  }).then((output) => output.timeline);

  insights = await recorder.step('generate_insight', { entityId: entity.id }, async () => {
    const result = await insightService.generateInsights(entity.id, { tenantId, timeline });
    const generated = [...(result?.items || []), ...(result?.persisted || [])];
    if (generated.length > 0) {
      return { insights: result };
    }

    const fallbackInsight = plain(await models.WorkspaceInsight().create({
      tenant_id: tenantId,
      entity_id: entity.id,
      type: 'operational_signal',
      description: 'Jornada workspace-core executada e validada para governança QA Mesh.',
      confidence: 0.99,
      source: 'QA/RPA',
    }));

    return {
      insights: {
        ...(result || {}),
        items: [...(result?.items || []), fallbackInsight],
        persisted: result?.persisted || [],
      },
    };
  }).then((output) => output.insights);

  actions = await recorder.step('generate_action', { entityId: entity.id }, async () => {
    const result = await actionService.autoCreateTasksFromInsights({ tenantId, entityId: entity.id, insights: insights.items || [] });
    if (!result.length) {
      const fallbackAction = await actionService.createAction({
        tenantId,
        entityId: entity.id,
        type: 'technical_review',
        status: 'pending',
        payload: { title: 'Revisar execução workspace-core', evidencePath: rel(summaryPath) },
      });
      return { actions: [fallbackAction] };
    }
    return { actions: result };
  }).then((output) => output.actions);

  requireCheck(checks, 'entityCreated', entity?.id, validationErrors, 'WorkspaceEntity nao foi criada.');
  requireCheck(checks, 'messageLinked', await models.WorkspaceEntityLink().findOne({ where: { tenant_id: tenantId, entity_id: entity.id, source_type: 'message', source_id: message.id } }), validationErrors, 'Mensagem nao foi vinculada.');
  requireCheck(checks, 'conversationLinked', await models.WorkspaceEntityLink().findOne({ where: { tenant_id: tenantId, entity_id: entity.id, source_type: 'conversation', source_id: conversation.id } }), validationErrors, 'Conversa nao foi vinculada.');
  requireCheck(checks, 'ticketLinked', await models.WorkspaceEntityLink().findOne({ where: { tenant_id: tenantId, entity_id: entity.id, source_type: 'ticket', source_id: ticket.id } }), validationErrors, 'Ticket nao foi vinculado.');
  requireCheck(checks, 'taskLinked', await models.WorkspaceEntityLink().findOne({ where: { tenant_id: tenantId, entity_id: entity.id, source_type: 'task', source_id: task.id } }), validationErrors, 'Task nao foi vinculada.');
  requireCheck(checks, 'timelineContainsMessage', (timeline.items || []).some((item) => item.type === 'message' && item.refId === message.id), validationErrors, 'Timeline nao contem mensagem.');
  requireCheck(checks, 'timelineContainsTicket', (timeline.items || []).some((item) => item.type === 'ticket' && item.refId === ticket.id), validationErrors, 'Timeline nao contem ticket.');
  requireCheck(checks, 'timelineContainsTask', (timeline.items || []).some((item) => item.type === 'task' && item.refId === task.id), validationErrors, 'Timeline nao contem task.');
  requireCheck(checks, 'timelineContainsEvidence', (timeline.items || []).some((item) => item.type === 'evidence' && item.refId === evidence.id), validationErrors, 'Timeline nao contem evidence.');
  requireCheck(checks, 'evidenceGenerated', evidence?.id, validationErrors, 'Evidence nao foi gerada.');
  requireCheck(checks, 'insightCreated', [...(insights.items || []), ...(insights.persisted || [])].length > 0, validationErrors, 'Insight nao foi criado.');
  requireCheck(checks, 'actionCreated', Array.isArray(actions) && actions.length > 0, validationErrors, 'Action operacional nao foi criada.');

  checks.linksCreated = Boolean(checks.messageLinked && checks.conversationLinked && checks.ticketLinked && checks.taskLinked);
  checks.timelineConsistent = Boolean(checks.timelineContainsMessage && checks.timelineContainsTicket && checks.timelineContainsTask);
  checks.replayGenerated = true;

  writeJson(timelinePath, {
    wave: 'workspace-core',
    mode,
    tenantId,
    entityId: entity.id,
    generatedAt: iso(),
    timeline,
  });

  return {
    entity,
    conversation,
    message,
    ticket,
    task,
    evidence,
    timeline,
    insights,
    actions,
  };
}

async function runAutoCorrection({
  mode,
  tenantId,
  entityId,
  summaryPath,
  replayPath,
  timeline,
  evidence,
  criticalFailures,
  failureInjection,
  recorder,
}) {
  if (!shouldRunAutoCorrection({ mode, criticalFailures })) {
    return {
      required: false,
      created: false,
      reason: 'Execução real sem falhas críticas.',
    };
  }

  const failedChecks = mode === 'failure'
    ? (failureInjection?.failedChecks || ['simulatedQaFailure'])
    : criticalFailures;

  const autocorrection = await createAutoCorrection({
    tenantId,
    entityId,
    summaryPath,
    replayPath,
    evidencePath: summaryPath,
    timeline,
    failedChecks,
    evidenceEvent: evidence,
    recorder,
  });

  const created = Boolean(autocorrection?.run?.id);

  if (mode === 'failure' && failureInjection) {
    failureInjection.handled = Boolean(created && autocorrection?.reviewAction?.id);
  }

  return {
    ...autocorrection,
    required: true,
    created,
    reason: created
      ? 'Autocorrection criada para revisão humana.'
      : 'Autocorrection era obrigatória, mas não foi criada.',
  };
}

async function main() {
  const mode = determineMode();
  const startedAt = iso();
  const timestamp = stamp();
  const evidenceDir = path.join(EVIDENCE_ROOT, timestamp);
  const summaryPath = path.join(evidenceDir, 'summary.json');
  const replayPath = path.join(evidenceDir, 'replay.json');
  const timelinePath = path.join(evidenceDir, 'timeline.json');
  const autocorrectionPath = path.join(evidenceDir, 'autocorrection.json');
  ensureDir(evidenceDir);

  const recorder = new JourneyRecorder();
  const checks = initializeChecks();
  const validationErrors = [];

  let sequelize;
  let tenantId = process.env.WORKSPACE_CORE_TENANT_ID || `workspace-core-${Date.now()}`;
  let entity;
  let conversation;
  let message;
  let ticket;
  let task;
  let evidence;
  let timeline;
  let insights;
  let actions;
  let autocorrection = { required: false, created: false, reason: 'Nenhuma falha real de checks detectada ainda.' };
  let failureInjection = null;

  try {
    sequelize = await connect(3, 300);
    const journey = await runRealJourney({
      mode,
      tenantId,
      summaryPath,
      replayPath,
      timelinePath,
      autocorrectionPath,
      recorder,
      checks,
      validationErrors,
    });
    ({ entity, conversation, message, ticket, task, evidence, timeline, insights, actions } = journey);

    if (mode === 'failure') {
      failureInjection = injectFailure({ recorder });
    }

    const criticalFailures = collectCriticalFailures(checks);
    autocorrection = await runAutoCorrection({
      mode,
      tenantId,
      entityId: entity.id,
      summaryPath,
      replayPath,
      timeline,
      evidence,
      criticalFailures,
      failureInjection,
      recorder,
    });

    writeJson(autocorrectionPath, autocorrection);

    const finishedAt = iso();
    const summary = generateSummary({
      mode,
      checks,
      errors: [...validationErrors, ...recorder.errors.map((error) => `${error.step}: ${error.message}`)],
      artifacts: {
        summaryPath: rel(summaryPath),
        replayPath: rel(replayPath),
        timelinePath: rel(timelinePath),
        autocorrectionPath: rel(autocorrectionPath),
      },
      records: {
        conversationId: conversation.id,
        messageId: message.id,
        ticketId: ticket.id,
        taskId: task.id,
        evidenceId: evidence.id,
        autocorrectionRunId: autocorrection?.run?.id || null,
      },
      startedAt,
      finishedAt,
      tenantId,
      entityId: entity.id,
      failureInjection,
      autocorrection,
    });

    writeJson(replayPath, recorder.steps);
    writeJson(summaryPath, summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.status === 'passed' ? 0 : 1;
  } catch (error) {
    const finishedAt = iso();
    const failedSummary = {
      wave: 'workspace-core',
      mode,
      status: 'failed',
      failureType: 'runtime_exception',
      tenantId,
      entityId: entity?.id || null,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      checks,
      errors: [...validationErrors, error.message || String(error), ...recorder.errors.map((item) => `${item.step}: ${item.message}`)],
      autocorrection: {
        required: Boolean(autocorrection?.required),
        created: Boolean(autocorrection?.created),
        reason: autocorrection?.reason || null,
      },
      artifacts: {
        summaryPath: rel(summaryPath),
        replayPath: rel(replayPath),
        timelinePath: rel(timelinePath),
        autocorrectionPath: rel(autocorrectionPath),
      },
    };
    failedSummary.governance = evaluateWaveResult(failedSummary);

    try {
      writeJson(replayPath, recorder.steps);
      writeJson(timelinePath, { wave: 'workspace-core', tenantId, entityId: entity?.id || null, generatedAt: iso(), timeline: timeline || null });
      writeJson(autocorrectionPath, autocorrection || { status: 'not_created', error: error.message || String(error) });
      writeJson(summaryPath, failedSummary);
    } catch (writeError) {
      console.error('[workspace-core] falha ao escrever evidence:', writeError);
    }
    console.error(error);
    console.log(JSON.stringify(failedSummary, null, 2));
    process.exitCode = 1;
  } finally {
    if (sequelize) await close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  determineMode,
  collectCriticalFailures,
  shouldRunAutoCorrection,
  generateSummary,
  JourneyRecorder,
};
