'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvent(raw = {}, index = 0) {
  return {
    id: raw.id || `evt-${index + 1}`,
    type: raw.type || raw.action || 'event',
    action: raw.action || raw.type || null,
    dataTestId: raw.dataTestId || raw['data-testid'] || null,
    selector: raw.selector || raw.targetSelector || null,
    module: raw.module || raw.service || raw.domain || null,
    page: raw.page || raw.route || raw.path || null,
    operation: raw.operation || raw.method || null,
    timestamp: raw.timestamp || raw.startedAt || raw.at || null,
    stateChange: raw.stateChange === true || raw.state_changed === true,
    retry: raw.retry === true,
    attempt: Number(raw.attempt || 1),
    delay: Number(raw.delay || 0),
    isExternal: raw.isExternal === true || raw.external === true,
    payload: raw.payload || null,
    result: raw.result || null,
    consequence: raw.consequence || null,
    entity: raw.entity || raw.target || null,
  };
}

function extractPage(raw = {}) {
  return raw.page || raw.route || raw.path || raw.url || raw.input?.url || raw.evidence?.url || null;
}

function extractDataMutations(input = {}, normalizedEvents = []) {
  if (input.dataMutations && typeof input.dataMutations === 'object') {
    return input.dataMutations;
  }

  const mutations = {};
  for (const event of normalizedEvents) {
    if (!event.stateChange && !['write', 'insert', 'update', 'delete'].includes(String(event.operation || '').toLowerCase())) {
      continue;
    }
    const entity = String(event.entity || event.module || 'unknown').toLowerCase();
    if (!mutations[entity]) mutations[entity] = [];
    mutations[entity].push({
      eventId: event.id,
      type: event.type,
      operation: event.operation,
      result: event.result,
      timestamp: event.timestamp,
    });
  }
  return mutations;
}

function extractOperationalActions(input = {}, events = []) {
  if (Array.isArray(input.operationalActions)) return input.operationalActions;
  return events.filter((event) => {
    const op = String(event.operation || '').toLowerCase();
    return ['write', 'insert', 'update', 'delete', 'command'].includes(op) || event.stateChange === true;
  });
}

function extractUserActions(input = {}, events = []) {
  if (Array.isArray(input.userActions)) return input.userActions;
  return events.filter((event) => {
    const type = String(event.type || '').toLowerCase();
    return ['click', 'fill', 'type', 'select', 'submit'].includes(type);
  });
}

function extractSystemResponses(input = {}, events = []) {
  if (Array.isArray(input.systemResponses)) return input.systemResponses;
  return events.filter((event) => {
    const type = String(event.type || '').toLowerCase();
    return ['api_call', 'response', 'notification', 'event'].includes(type) || event.isExternal === true;
  });
}

function normalizeReplay(replay = {}) {
  const rawSteps = asArray(replay.steps);
  const sourceEvents = asArray(replay.events).length > 0
    ? asArray(replay.events)
    : rawSteps;

  const events = sourceEvents.map((event, index) => normalizeEvent(event, index));
  const rawScreenshots = asArray(replay.screenshots);
  const screenshots = rawScreenshots.length > 0
    ? rawScreenshots.map((screenshot, index) => {
      if (typeof screenshot === 'string') {
        return {
          id: `screenshot-${index + 1}`,
          path: null,
          data: screenshot,
          description: `Screenshot ${index + 1}`,
          timestamp: replay.finishedAt || replay.endTime || replay.startedAt || null,
          critical: index === rawScreenshots.length - 1,
          type: index === rawScreenshots.length - 1 ? 'validation' : 'evidence',
        };
      }
      return screenshot;
    })
    : asArray(replay.screens).map((screen, index) => ({
      id: screen.id || `screenshot-${index + 1}`,
      path: screen.path || screen.file || null,
      data: screen.data || screen.screenshot || null,
      description: screen.description || screen.name || `Screenshot ${index + 1}`,
      timestamp: screen.timestamp || screen.at || null,
      critical: screen.critical === true,
      type: screen.type || null,
    }));

  const auditLog = asArray(replay.auditLog).length > 0
    ? asArray(replay.auditLog)
    : events.filter((event) => String(event.module || '').toLowerCase().includes('audit'));

  const normalized = {
    replayId: replay.replayId || replay.id || null,
    source: replay.source || 'rpa',
    waveId: replay.waveId || null,
    journeyId: replay.journeyId || null,
    scenarioId: replay.scenarioId || null,
    duration: Number(replay.duration || replay.durationMs || 0),
    startedAt: replay.startedAt || null,
    finishedAt: replay.finishedAt || null,
    initialState: replay.initialState || replay.beforeState || null,
    transitionState: replay.transitionState || replay.expectedTransition || null,
    finalState: replay.finalState || replay.afterState || null,
    beforeSnapshot: replay.beforeSnapshot || replay.before || null,
    afterSnapshot: replay.afterSnapshot || replay.after || null,
    steps: rawSteps,
    rawStepCount: rawSteps.length,
    rawScreenshotCount: rawScreenshots.length || asArray(replay.screens).length,
    rawPages: Array.from(new Set([
      ...rawSteps.map(extractPage),
      ...asArray(replay.events).map(extractPage),
    ].filter(Boolean).map(String))),
    events,
    screenshots,
    auditLog,
    operationalActions: extractOperationalActions(replay, events),
    dataMutations: extractDataMutations(replay, events),
    userActions: extractUserActions(replay, events),
    systemResponses: extractSystemResponses(replay, events),
    seedEvidence: replay.seedEvidence || replay.metadata?.seedEvidence || null,
    operationalSeedStatus: replay.operationalSeedStatus || replay.metadata?.operationalSeedStatus || null,
  };

  return normalized;
}

module.exports = {
  normalizeReplay,
};
