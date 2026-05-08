'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const TRANSITION_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'operational-transition-contracts.json');

const ACTION_HINTS = [
  { pattern: /ticket-send-button|reply[-_ ]?ticket|send[-_ ]?reply/i, transitionId: 'ticket_reply_transition', action: 'reply_ticket' },
  { pattern: /ticket-resolve|resolve[-_ ]?ticket/i, transitionId: 'ticket_resolve_transition', action: 'resolve_ticket' },
  { pattern: /turnstile-release|access-release|liberar-catraca/i, transitionId: 'access_release_transition', action: 'turnstile_release' },
  { pattern: /create-booking|booking-create|agendar|confirm-booking/i, transitionId: 'booking_create_transition', action: 'create_booking' },
];

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function loadTransitionContracts(overrideContracts = null) {
  if (overrideContracts && typeof overrideContracts === 'object') {
    return overrideContracts;
  }
  return readJsonSafe(TRANSITION_CONTRACTS_PATH, {});
}

function inferTransitionFromStep(step = {}, options = {}) {
  const contracts = loadTransitionContracts(options.contracts);
  const raw = [step.dataTestId, step.selector, step.action, step.type, step.name, step.id]
    .filter(Boolean)
    .join(' ');

  for (const hint of ACTION_HINTS) {
    if (!hint.pattern.test(raw)) continue;
    const contract = contracts[hint.transitionId] || {};
    return {
      transitionId: hint.transitionId,
      action: contract.action || hint.action,
      journeyId: contract.journeyId || step.journeyId || null,
      confidence: 0.9,
      contract,
    };
  }

  const normalizedAction = String(step.action || step.type || '').trim();
  if (normalizedAction) {
    const byAction = Object.entries(contracts).find(([, contract]) => contract.action === normalizedAction);
    if (byAction) {
      return {
        transitionId: byAction[0],
        action: normalizedAction,
        journeyId: byAction[1].journeyId || step.journeyId || null,
        confidence: 0.8,
        contract: byAction[1],
      };
    }
  }

  return {
    transitionId: null,
    action: normalizedAction || null,
    journeyId: step.journeyId || null,
    confidence: 0,
    contract: null,
  };
}

function inferTransitionsFromReplayEvents(events = [], options = {}) {
  const inferred = [];
  const list = Array.isArray(events) ? events : [];

  for (const event of list) {
    const candidate = inferTransitionFromStep(event, options);
    if (!candidate.transitionId) continue;
    inferred.push({
      ...candidate,
      eventId: event.id || null,
      timestamp: event.timestamp || null,
    });
  }

  return inferred;
}

module.exports = {
  inferTransitionFromStep,
  inferTransitionsFromReplayEvents,
  loadTransitionContracts,
};
