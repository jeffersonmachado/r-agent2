const logger = require('../../utils/logger');
const replayNormalizationService = require('./replayNormalizationService');
const transitionInferenceService = require('./transitionInferenceService');
const operationalStateEngine = require('./operationalStateEngine');
const { validateEvidenceByContract } = require('../../../qa/evidence/stepEvidenceContracts');

/**
 * Valida se replay é operacional real
 * Detecta:
 * - se replay acessou módulo real
 * - se replay mostrou jornada real (não mock)
 * - se replay mostrou usuário humano (não bot)
 * - se replay mostrou operação real (com consequências)
 * - se replay mostrou screenshots válidos
 */

/**
 * Valida se replay acessou módulo real (não apenas stubs)
 */
const OPERATIONAL_MODULE_PATTERN = /\/(support|fitness|access-control|calendar|bookings)(\/|$)|\/api\/(support|crm|access-control|fitness|calendar|bookings)(\/|$)/i;
const DIAGNOSTIC_PAGE_PATTERN = /\/dev\/qa-waves(\/|$)|\/rpa-replays(\/|$)/i;

function toSnakeCase(value = '') {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

function normalizeJourneyId(value = '') {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('support') || raw.includes('ticket')) return 'support_ticket_flow';
  if (raw.includes('fitness') || raw.includes('checkin') || raw.includes('check-in')) return 'fitness_customer_checkin';
  if (raw.includes('booking') || raw.includes('calendar')) return 'booking_flow';
  return raw;
}

function validateReplayStepEvidence(replay = {}) {
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const blockers = [];
  const journeyId = normalizeJourneyId(replay.journeyId);
  const isBlockingJourney = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyId);

  for (const [index, step] of steps.entries()) {
    const stepId = step?.id || `step-${index + 1}`;

    const validation = validateEvidenceByContract({
      actionType: step?.actionType || step?.action || step?.type,
      evidence: step,
      journeyContext: {
        journeyId,
        stepId,
        isBlockingJourney,
        executionMode: 'operational_go',
      },
    });

    if (!validation.valid) {
      blockers.push(
        ...validation.blockers.map((item) => ({
          ...item,
          reason: `replay_step_missing_${toSnakeCase(item.field)}`,
        }))
      );
    }
  }

  return {
    valid: blockers.length === 0,
    stepsChecked: steps.length,
    blockers,
  };
}

function validateOperationalSeedLinkage(replay = {}) {
  const journeyId = normalizeJourneyId(replay.journeyId);
  const isBlockingJourney = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyId);
  const seedEvidence = replay.seedEvidence || replay.metadata?.seedEvidence || null;
  const seedStatus = String(
    replay.operationalSeedStatus
    || replay.metadata?.operationalSeedStatus
    || seedEvidence?.status
    || ''
  ).toLowerCase();
  const blockers = [];

  if (!isBlockingJourney) {
    return {
      valid: true,
      journeyId,
      blockers,
    };
  }

  if (!seedEvidence) {
    blockers.push({ reason: 'operational_seed_missing', journeyId });
  }

  if (seedStatus && seedStatus !== 'ready' && seedStatus !== 'provisioned' && seedStatus !== 'ok') {
    blockers.push({ reason: 'operational_seed_not_ready', journeyId, status: seedStatus });
  }

  if (journeyId === 'support_ticket_flow') {
    const hasIds = Boolean(seedEvidence?.ticketId && seedEvidence?.conversationId && seedEvidence?.contactId);
    if (!hasIds) blockers.push({ reason: 'support_seed_missing_ids', journeyId });
  }

  if (journeyId === 'fitness_customer_checkin') {
    const hasIds = Boolean(seedEvidence?.subjectId && seedEvidence?.membershipId && seedEvidence?.credentialId && seedEvidence?.deviceId);
    if (!hasIds) blockers.push({ reason: 'fitness_seed_missing_ids', journeyId });
  }

  return {
    valid: blockers.length === 0,
    journeyId,
    blockers,
  };
}

function validateJourneyOperationalFlow(replay = {}) {
  const journeyId = normalizeJourneyId(replay.journeyId);
  const blockers = [];
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const events = Array.isArray(replay.events) ? replay.events : [];
  const pages = collectReplayPages(replay);
  const before = replay.beforeSnapshot || {};
  const after = replay.afterSnapshot || {};

  if (journeyId === 'support_ticket_flow') {
    const hasSupportAccess = pages.some((page) => String(page).includes('/support'));
    const hasTicketList = steps.some((step) => /ticket-list|ticket-card/i.test(String(step?.selector || step?.dataTestId || '')));
    const hasTicketOpen = steps.some((step) => /ticket-detail|open-ticket|ticket-card/i.test(String(step?.selector || step?.dataTestId || '')));
    const hasTicketReply = steps.some((step) => /reply|message|ticket-reply/i.test(String(step?.selector || step?.dataTestId || step?.actionType || step?.action || '')))
      || events.some((event) => String(event?.entity || '').toLowerCase().includes('ticket') && ['update', 'write', 'insert'].includes(String(event?.operation || '').toLowerCase()));
    const hasStatusChange = Boolean(after?.db?.ticket?.status) && String(after?.db?.ticket?.status).toLowerCase() !== String(before?.db?.ticket?.status || '').toLowerCase();
    const hasPersistence = Boolean(after?.db?.ticket?.exists) && Boolean(after?.db?.ticket?.updatedAt || after?.db?.ticket?.status);
    const hasCrm = Number(after?.crm?.activities?.count || 0) > Number(before?.crm?.activities?.count || 0)
      || events.some((event) => String(event?.entity || '').toLowerCase().includes('crm'));
    const hasAudit = Number(after?.events?.audit?.count || 0) > Number(before?.events?.audit?.count || 0)
      || (Array.isArray(replay.auditLog) && replay.auditLog.length > 0)
      || events.some((event) => String(event?.entity || '').toLowerCase().includes('audit'));

    if (!hasSupportAccess) blockers.push({ reason: 'support_flow_missing_support_access' });
    if (!hasTicketList) blockers.push({ reason: 'support_flow_missing_ticket_listing' });
    if (!hasTicketOpen) blockers.push({ reason: 'support_flow_missing_ticket_open' });
    if (!hasTicketReply) blockers.push({ reason: 'support_flow_missing_ticket_reply' });
    if (!hasStatusChange) blockers.push({ reason: 'support_flow_missing_status_change' });
    if (!hasPersistence) blockers.push({ reason: 'support_flow_missing_persistence_validation' });
    if (!hasCrm) blockers.push({ reason: 'support_flow_missing_crm_validation' });
    if (!hasAudit) blockers.push({ reason: 'support_flow_missing_audit_validation' });
  }

  if (journeyId === 'fitness_customer_checkin') {
    const deviceMode = String(after?.devices?.mode || before?.devices?.mode || after?.metadata?.deviceEvidence || before?.metadata?.deviceEvidence || '').toLowerCase();
    const hasCrmCustomer = Boolean(before?.db?.crm?.contact?.exists || after?.db?.crm?.contact?.exists);
    const membershipActive = Boolean(before?.db?.membership?.active || after?.db?.membership?.active);
    const credentialValid = Boolean(before?.db?.credential?.exists || after?.db?.credential?.exists);
    const accessAllow = Boolean(after?.api?.access?.decision?.allow)
      || events.some((event) => String(event?.entity || '').toLowerCase().includes('access') && String(event?.result || '').toLowerCase() === 'allow');
    const accessEventCreated = Number(after?.devices?.access?.events || 0) > 0
      || events.some((event) => String(event?.entity || '').toLowerCase().includes('access') && ['insert', 'write', 'update'].includes(String(event?.operation || '').toLowerCase()));
    const attendanceCreated = Boolean(after?.db?.attendance?.created) || Number(after?.db?.attendance?.count || 0) > 0;
    const crmUpdated = Boolean(after?.crm?.presenceActivity?.created) || Number(after?.crm?.presenceActivity?.count || 0) > 0;

    if (deviceMode.includes('simulated')) blockers.push({ reason: 'simulated_device_not_allowed' });
    if (!hasCrmCustomer) blockers.push({ reason: 'fitness_flow_missing_crm_customer' });
    if (!membershipActive) blockers.push({ reason: 'fitness_flow_missing_active_membership' });
    if (!credentialValid) blockers.push({ reason: 'fitness_flow_missing_valid_credential' });
    if (!accessAllow) blockers.push({ reason: 'fitness_flow_missing_access_allow' });
    if (!accessEventCreated) blockers.push({ reason: 'fitness_flow_missing_access_event' });
    if (!attendanceCreated) blockers.push({ reason: 'fitness_flow_missing_attendance_created' });
    if (!crmUpdated) blockers.push({ reason: 'fitness_flow_missing_crm_update' });
  }

  return {
    valid: blockers.length === 0,
    journeyId,
    blockers,
  };
}

function collectReplayPages(replay = {}) {
  const pages = new Set(Array.isArray(replay.rawPages) ? replay.rawPages : []);
  const items = [
    ...(Array.isArray(replay.events) ? replay.events : []),
    ...(Array.isArray(replay.steps) ? replay.steps : []),
    ...(Array.isArray(replay.screenshots) ? replay.screenshots : []),
  ];
  for (const item of items) {
    const value = item?.page || item?.route || item?.path || item?.url || item?.input?.url || item?.evidence?.url || item?.description;
    if (value) pages.add(String(value));
  }
  return Array.from(pages);
}

function validateReplayCompleteness(replay = {}) {
  const pages = collectReplayPages(replay);
  const operationalPages = pages.filter((page) => OPERATIONAL_MODULE_PATTERN.test(page));
  const diagnosticPages = pages.filter((page) => DIAGNOSTIC_PAGE_PATTERN.test(page));
  const onlyDiagnosticPages = pages.length > 0 && diagnosticPages.length === pages.length;
  const stepEvidence = validateReplayStepEvidence(replay);
  const journeyFlow = validateJourneyOperationalFlow(replay);
  const seedLinkage = validateOperationalSeedLinkage(replay);
  const blockers = [];

  if (Number(replay.rawStepCount || 0) === 0) {
    blockers.push({ reason: 'replay_steps_empty' });
  }
  if (Number(replay.rawScreenshotCount || 0) === 0) {
    blockers.push({ reason: 'missing_operational_screenshots' });
  }
  if (operationalPages.length === 0) {
    blockers.push({ reason: 'replay_not_operational', details: { pagesVisited: pages } });
  }
  if (onlyDiagnosticPages) {
    blockers.push({ reason: 'replay_only_diagnostic_pages', details: { pagesVisited: pages } });
  }
  if (!stepEvidence.valid) {
    blockers.push(...stepEvidence.blockers);
  }
  if (!journeyFlow.valid) {
    blockers.push(...journeyFlow.blockers);
  }
  if (!seedLinkage.valid) {
    blockers.push(...seedLinkage.blockers);
  }

  return {
    valid: blockers.length === 0,
    pagesVisited: pages,
    operationalPages,
    diagnosticPages,
    onlyDiagnosticPages,
    stepEvidence,
    journeyFlow,
    seedLinkage,
    blockers,
  };
}

function validateRealModuleAccess(replay = {}) {
  const accessed = [];
  const stubs = [];

  const events = replay.events || [];
  const pages = collectReplayPages(replay);
  for (const event of events) {
    const module = event.module || event.service || '';
    const isStub = module.includes('mock') || module.includes('stub') || module.includes('test');

    if (isStub) {
      stubs.push(module);
    } else if (module) {
      accessed.push(module);
    }
  }

  for (const page of pages) {
    if (OPERATIONAL_MODULE_PATTERN.test(page)) {
      accessed.push(page);
    }
  }

  const uniqueRealModules = [...new Set(accessed)];
  const isRealAccess =
    uniqueRealModules.length > 0
    && uniqueRealModules.some((m) => m !== 'qa' && m !== 'qa-waves')
    && pages.some((page) => OPERATIONAL_MODULE_PATTERN.test(page));

  return {
    isRealAccess,
    realModulesAccessed: uniqueRealModules,
    stubsUsed: [...new Set(stubs)],
    ratio: uniqueRealModules.length / (uniqueRealModules.length + stubs.length) || 0,
  };
}

/**
 * Valida se replay mostrou jornada real
 * (não apenas ciclos Q/A)
 */
function validateRealJourneyPath(replay = {}) {
  const events = replay.events || [];
  const pages = collectReplayPages(replay);
  const transitions = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (i > 0) {
      const prev = events[i - 1];
      if (prev.page && event.page && prev.page !== event.page) {
        transitions.push({ from: prev.page, to: event.page });
      }
    }
  }

  const uniquePages = [...new Set(pages)];
  const operationalPages = uniquePages.filter((page) => OPERATIONAL_MODULE_PATTERN.test(page));
  const onlyDiagnosticPages = uniquePages.length > 0 && uniquePages.every((page) => DIAGNOSTIC_PAGE_PATTERN.test(page));
  const isNonTrivia = operationalPages.length > 0 && !onlyDiagnosticPages;
  const hasForwardProgress =
    transitions.length > 0 && transitions.some((t) => t.from !== t.to);

  return {
    isRealJourney: isNonTrivia && (hasForwardProgress || operationalPages.length > 0),
    pagesVisited: uniquePages,
    operationalPages,
    onlyDiagnosticPages,
    transitions: transitions,
    journeyDepth: uniquePages.length,
  };
}

/**
 * Valida se replay mostrou usuário humano
 * (não determinístico, com hesitações, erros)
 */
function validateHumanBehavior(replay = {}) {
  const events = replay.events || [];
  const issues = [];

  // Detector: velocidade muito rápida
  if (events.length > 0) {
    const duration = replay.duration || 0;
    const avgEventTime = duration / events.length;
    if (avgEventTime < 100) {
      issues.push('event_timing_too_fast_for_human');
    }
  }

  // Detector: padrão muito regular
  const eventTypes = events.map((e) => e.type);
  const regex = eventTypes.join('');
  const repeatingPattern = /(.+)\1{3,}/.test(regex);
  if (repeatingPattern) {
    issues.push('repeating_pattern_suggests_bot');
  }

  // Detector: sem hesitação/retry
  const hasRetry = events.some((e) => e.retry === true || e.attempt > 1);
  if (!hasRetry && events.length > 5) {
    issues.push('no_retries_or_corrections');
  }

  // Detector: delays irregulares (humano tem hesitação)
  const hasDelays = events.some((e) => e.delay && e.delay > 500);
  if (!hasDelays) {
    issues.push('no_hesitation_delays');
  }

  const isHumanBehavior = issues.length === 0;
  return {
    isHumanBehavior,
    confidence: Math.max(0, 1 - issues.length * 0.25),
    issues,
  };
}

/**
 * Valida se replay mostrou operação real
 * (com consequências observáveis)
 */
function validateRealOperation(replay = {}) {
  const consequences = [];

  // Check 1: Data mutations
  if (replay.dataMutations && Object.keys(replay.dataMutations).length > 0) {
    consequences.push('data_mutations_observed');
  }

  // Check 2: State changes
  const events = replay.events || [];
  const stateChanges = events.filter((e) => e.stateChange === true);
  if (stateChanges.length > 0) {
    consequences.push('state_changes_observed');
  }

  // Check 3: Database writes
  if (events.some((e) => e.operation === 'write' || e.operation === 'insert')) {
    consequences.push('database_writes_observed');
  }

  // Check 4: External API calls
  if (events.some((e) => e.type === 'api_call' || e.isExternal === true)) {
    consequences.push('external_api_calls_observed');
  }

  // Check 5: Notifications/Events
  if (events.some((e) => e.type === 'notification' || e.eventEmitted === true)) {
    consequences.push('events_or_notifications_observed');
  }

  // Check 6: Audit trail
  if (replay.auditLog && replay.auditLog.length > 0) {
    consequences.push('audit_trail_created');
  }

  const isRealOperation = consequences.length >= 2; // Mínimo 2 consequências
  return {
    isRealOperation,
    consequencesObserved: consequences,
    count: consequences.length,
  };
}

/**
 * Valida se replay contém screenshots válidos
 */
function validateScreenshots(replay = {}) {
  const screenshots = replay.screenshots || [];
  const issues = [];

  if (screenshots.length === 0) {
    issues.push('no_screenshots');
    return { valid: false, issues, count: 0 };
  }

  // Validar cada screenshot
  for (const ss of screenshots) {
    if (!ss.path && !ss.data) {
      issues.push('screenshot_without_path_or_data');
    }
    if (!ss.timestamp) {
      issues.push('screenshot_without_timestamp');
    }
    if (!ss.description) {
      issues.push('screenshot_without_description');
    }
  }

  const hasCriticalScreenshots = screenshots.some((ss) => ss.critical === true || ss.type === 'validation');

  return {
    valid: issues.length === 0 && hasCriticalScreenshots,
    issues,
    count: screenshots.length,
    hasCritical: hasCriticalScreenshots,
  };
}

function inferObservedSideEffects(replay = {}) {
  const observed = new Set();
  const events = replay.events || [];

  for (const event of events) {
    const entity = String(event.entity || event.module || '').toLowerCase();
    const op = String(event.operation || '').toLowerCase();
    const type = String(event.type || '').toLowerCase();

    if (entity.includes('ticket') && ['update', 'write'].includes(op)) observed.add('ticket_status_changed');
    if (entity.includes('crm') && ['update', 'write'].includes(op)) observed.add('crm_updated');
    if (entity.includes('booking') && ['insert', 'create', 'write'].includes(op)) observed.add('booking_created');
    if ((entity.includes('turnstile') || entity.includes('access')) && ['command', 'update', 'write'].includes(op)) {
      observed.add('turnstile_released');
    }
    if (entity.includes('attendance') && ['insert', 'write', 'update'].includes(op)) observed.add('checkin_registered');
    if (type === 'notification' || event.eventEmitted === true) observed.add('notification_sent');
  }

  if (Array.isArray(replay.auditLog) && replay.auditLog.length > 0) {
    observed.add('audit_log_created');
  }

  return Array.from(observed);
}

function validateStateAwareReplay(replay = {}, options = {}) {
  const contracts = transitionInferenceService.loadTransitionContracts(options.transitionContracts);
  const inferred = transitionInferenceService.inferTransitionsFromReplayEvents(replay.events || [], { contracts });
  const observedSideEffects = inferObservedSideEffects(replay);

  const transitions = inferred.map((item) => {
    const contract = item.contract || {};
    return {
      journeyId: options.journeyId || replay.journeyId || contract.journeyId,
      transitionId: item.transitionId,
      action: item.action,
      initialState: replay.initialState || contract.initialState || options.initialState || null,
      transitionState: replay.transitionState || contract.expectedTransition || options.transitionState || null,
      finalState: replay.finalState || contract.finalState || options.finalState || null,
      beforeSnapshot: options.beforeSnapshot || replay.beforeSnapshot || { state: replay.initialState || contract.initialState || null },
      afterSnapshot: options.afterSnapshot || replay.afterSnapshot || { state: replay.finalState || contract.finalState || null },
      observedSideEffects,
      requiredSideEffects: contract.requiredSideEffects || [],
    };
  });

  const flowEvaluation = operationalStateEngine.evaluateOperationalStateFlow({
    transitions,
    journeyId: options.journeyId || replay.journeyId || null,
    transitionContracts: contracts,
  });

  const clickWithoutConsequence = (replay.userActions || []).length > 0
    && flowEvaluation.chain.coverage.operationalConsequenceCoverage === 0;

  return {
    valid: flowEvaluation.goNoGo === 'GO' && !clickWithoutConsequence,
    transitionsInferred: inferred,
    transitionsValidated: flowEvaluation.chain.validations.length,
    clickWithoutConsequence,
    coverage: flowEvaluation.chain.coverage,
    blockers: flowEvaluation.blockers,
    timeline: flowEvaluation.timeline,
    remediation: flowEvaluation.remediation,
  };
}

function buildReplayBlockers(results = {}) {
  const blockers = [];

  if (results.completeness && !results.completeness.valid) {
    blockers.push(...results.completeness.blockers);
  }
  if (!results.moduleAccess?.isRealAccess) {
    blockers.push({ reason: 'replay_not_operational', details: results.moduleAccess });
  }
  if (!results.journeyPath?.isRealJourney) {
    blockers.push({ reason: 'replay_not_operational', details: results.journeyPath });
  }
  if (!results.realOperation?.isRealOperation) {
    blockers.push({ reason: 'replay_missing_state_transition', details: results.realOperation });
  }
  if (!results.screenshots?.valid) {
    blockers.push({ reason: 'missing_operational_screenshots', details: results.screenshots });
  }
  if (!results.stateAware?.valid) {
    const stateBlockers = Array.isArray(results.stateAware?.blockers) ? results.stateAware.blockers : [];
    const hasMissingMutation = stateBlockers.some((item) => item.reason === 'missing_real_state_mutation');
    blockers.push({
      reason: hasMissingMutation ? 'missing_real_state_mutation' : 'replay_missing_state_transition',
      details: results.stateAware,
    });
  }
  if (results.stateAware?.clickWithoutConsequence === true) {
    blockers.push({ reason: 'validation_only_by_click' });
  }

  return blockers;
}

/**
 * Executa validação operacional completa do replay.
 *
 * PRECONDIÇÃO: Para jornadas blocking (support_ticket_flow, fitness_customer_checkin),
 * afterSnapshot DEVE existir antes de chamar esta função.
 * Se chamado antes de collectAfterSnapshot(), retorna preconditionFailed=true
 * sem nenhum blocker — evita falsos NO_GO temporários.
 */
function validateOperationalReplay(replay = {}, options = {}) {
  const journeyIdNorm = normalizeJourneyId(replay.journeyId || '');
  const isBlockingReplay = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyIdNorm);

  // Guard temporal: jornadas blocking exigem afterSnapshot antes de validar.
  // Se afterSnapshot ainda não foi coletado, retornar sem blockers (precondição não atendida).
  if (isBlockingReplay && replay.afterSnapshot == null) {
    return {
      isOperational: false,
      classification: 'precondition_not_met',
      score: 0,
      maxScore: 130,
      percentage: 0,
      replay: {},
      results: {},
      blockers: [],
      preconditionFailed: true,
      preconditionReason: 'after_snapshot_not_yet_collected',
      operationalTimeline: [],
      recommendation: 'validateOperationalReplay chamado antes de afterSnapshot existir — aguardar collectAfterSnapshot()',
    };
  }

  const normalizedReplay = replayNormalizationService.normalizeReplay(replay);
  const missingReplay = !normalizedReplay.replayId
    && normalizedReplay.events.length === 0
    && normalizedReplay.screenshots.length === 0;

  if (missingReplay) {
    return {
      isOperational: false,
      classification: 'missing_replay',
      score: 0,
      maxScore: 130,
      percentage: 0,
      replay: normalizedReplay,
      results: {},
      blockers: [{ reason: 'missing_operational_replay' }],
      operationalTimeline: [],
      recommendation: 'Replay operacional obrigatório ausente',
    };
  }

  const results = {
    completeness: validateReplayCompleteness(normalizedReplay),
    moduleAccess: validateRealModuleAccess(normalizedReplay),
    journeyPath: validateRealJourneyPath(normalizedReplay),
    humanBehavior: validateHumanBehavior(normalizedReplay),
    realOperation: validateRealOperation(normalizedReplay),
    screenshots: validateScreenshots(normalizedReplay),
    stateAware: validateStateAwareReplay(normalizedReplay, options),
  };

  // Calcular score geral
  let score = 0;
  let maxScore = 0;

  // Module access: 20 pts
  if (results.moduleAccess.isRealAccess && results.completeness.valid) score += 20;
  maxScore += 20;

  // Journey: 20 pts
  if (results.journeyPath.isRealJourney && results.completeness.valid) score += 20;
  maxScore += 20;

  // Behavior: 15 pts
  if (results.humanBehavior.isHumanBehavior) score += 15;
  maxScore += 15;

  // Operation: 25 pts
  if (results.realOperation.isRealOperation) score += 25;
  maxScore += 25;

  // Screenshots: 20 pts
  if (results.screenshots.valid) score += 20;
  maxScore += 20;

  // State transitions + consequence: 30 pts
  if (results.stateAware.valid) score += 30;
  maxScore += 30;

  const percentage = (score / maxScore) * 100;
  const blockers = buildReplayBlockers(results);

  // Classificar
  let classification = 'not_operational';
  if (percentage >= 80) classification = 'fully_operational';
  else if (percentage >= 60) classification = 'mostly_operational';
  else if (percentage >= 40) classification = 'partially_operational';
  else if (percentage >= 20) classification = 'minimal_operational';

  return {
    isOperational: percentage >= 60 && results.completeness.valid && results.stateAware.valid && blockers.length === 0,
    classification,
    score: Math.round(score),
    maxScore,
    percentage: Math.round(percentage),
    replay: normalizedReplay,
    results,
    blockers,
    operationalTimeline: results.stateAware.timeline,
    recommendation:
      percentage >= 60 && results.completeness.valid && results.stateAware.valid && blockers.length === 0
        ? 'Replay é operacionalmente válido'
        : 'Replay não atende critérios operacionais mínimos de transição de estado e consequência operacional',
  };
}

function validateOperationalConsequences(replay = {}, expectedConsequences = []) {
  const normalizedReplay = replayNormalizationService.normalizeReplay(replay);
  const observed = new Set(inferObservedSideEffects(normalizedReplay));

  const required = Array.isArray(expectedConsequences) ? expectedConsequences : [];
  const missing = required.filter((item) => !observed.has(String(item)));

  return {
    valid: missing.length === 0,
    expected: required,
    observed: Array.from(observed),
    missing,
  };
}

/**
 * Gera sugestões de melhoria para replay
 */
function suggestReplayImprovements(validationResult = {}) {
  const suggestions = [];
  const { results } = validationResult;

  if (!results.moduleAccess.isRealAccess) {
    suggestions.push({
      type: 'module_access',
      severity: 'critical',
      action: 'Adicionar logs de acesso a módulos reais (não stubs)',
    });
  }

  if (!results.journeyPath.isRealJourney) {
    suggestions.push({
      type: 'journey_depth',
      severity: 'critical',
      action: 'Expandir replay para percorrer mais páginas/módulos reais',
    });
  }

  if (!results.humanBehavior.isHumanBehavior) {
    suggestions.push({
      type: 'behavior_pattern',
      severity: 'high',
      action: `Adicionar hesitações/delays/retries: ${results.humanBehavior.issues.join(', ')}`,
    });
  }

  if (!results.realOperation.isRealOperation) {
    suggestions.push({
      type: 'operation_consequences',
      severity: 'critical',
      action: 'Operação deve produzir consequências observáveis (DB writes, events, API calls)',
    });
  }

  if (!results.screenshots.valid) {
    suggestions.push({
      type: 'screenshots',
      severity: 'high',
      action: `Adicionar screenshots críticos: ${results.screenshots.issues.join(', ')}`,
    });
  }

  return suggestions;
}

module.exports = {
  validateOperationalReplay,
  validateReplayCompleteness,
  validateReplayStepEvidence,
  validateOperationalSeedLinkage,
  validateRealModuleAccess,
  validateRealJourneyPath,
  validateHumanBehavior,
  validateRealOperation,
  validateScreenshots,
  validateStateAwareReplay,
  validateOperationalConsequences,
  suggestReplayImprovements,
};
