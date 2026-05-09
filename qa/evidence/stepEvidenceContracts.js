'use strict';

const { validateEvidenceProof } = require('./evidenceProofValidator');

const BASE_REQUIRED_FIELDS = ['actionType', 'timestamp', 'stepResult', 'evidenceId'];

const STEP_EVIDENCE_CONTRACTS = {
  navigate: {
    require: [...BASE_REQUIRED_FIELDS, 'url', 'screenshotAfter', 'domAfter'],
  },
  wait_for_list: {
    require: [...BASE_REQUIRED_FIELDS, 'selectorUsed', 'screenshotAfter', 'domAfter'],
  },
  click_open: {
    require: [...BASE_REQUIRED_FIELDS, 'selectorUsed', 'screenshotBefore', 'screenshotAfter'],
    optional: ['networkEvents'],
  },
  type_and_send: {
    require: [
      ...BASE_REQUIRED_FIELDS,
      'selectorUsed',
      'screenshotBefore',
      'screenshotAfter',
      'networkEvents',
      'mutationLinkage',
      'sideEffectLinkage',
    ],
    requireProof: true,
    proofTypes: ['network', 'mutation', 'sideEffect'],
  },
  change_status: {
    require: [
      ...BASE_REQUIRED_FIELDS,
      'selectorUsed',
      'networkEvents',
      'mutationLinkage',
      'sideEffectLinkage',
    ],
    requireProof: true,
    proofTypes: ['network', 'mutation', 'sideEffect'],
  },
  assert_ui_state: {
    require: [...BASE_REQUIRED_FIELDS, 'selectorUsed', 'screenshotAfter', 'domAfter'],
  },
  assert_backend_state: {
    require: [...BASE_REQUIRED_FIELDS],
    optional: ['snapshotDiff', 'mutationLinkage', 'sideEffectLinkage'],
  },
  identify_customer: {
    require: [...BASE_REQUIRED_FIELDS, 'selectorUsed', 'screenshotAfter', 'domAfter'],
  },
  validate_membership: {
    require: [...BASE_REQUIRED_FIELDS],
    optional: ['snapshotDiff', 'mutationLinkage', 'sideEffectLinkage'],
  },
  checkin_submit: {
    require: [
      ...BASE_REQUIRED_FIELDS,
      'selectorUsed',
      'networkEvents',
      'mutationLinkage',
      'sideEffectLinkage',
    ],
    requireProof: true,
    proofTypes: ['network', 'mutation', 'sideEffect'],
  },
  assert_attendance: {
    require: [...BASE_REQUIRED_FIELDS],
    optional: ['snapshotDiff', 'sideEffectLinkage'],
  },
};

const DEFAULT_CONTRACT = {
  require: [...BASE_REQUIRED_FIELDS, 'screenshotAfter'],
};

const ACTION_TYPE_ALIASES = {};

const EVIDENCE_FIELD_ALIASES = {
  domAfter: ['domAfter', 'domSnapshot', 'evidence.domAfter', 'evidence.domSnapshot'],
  selectorUsed: ['selectorUsed', 'selector', 'dataTestId', 'evidence.selectorUsed', 'evidence.selector'],
  networkEvents: ['networkEvents', 'evidence.networkEvents'],
  mutationLinkage: ['mutationLinkage', 'mutation', 'evidence.mutationLinkage'],
  sideEffectLinkage: ['sideEffectLinkage', 'evidence.sideEffectLinkage'],
  snapshotDiff: ['snapshotDiff', 'evidence.snapshotDiff'],
  screenshotAfter: ['screenshotAfter', 'screenshot', 'evidence.screenshotAfter', 'evidence.screenshot'],
  screenshotBefore: ['screenshotBefore', 'evidence.screenshotBefore'],
  url: ['url', 'page', 'route', 'path', 'input.url', 'evidence.url'],
  actionType: ['actionType', 'action', 'type'],
  timestamp: ['timestamp', 'startedAt', 'at'],
  stepResult: ['stepResult', 'evidence.stepResult'],
  evidenceId: ['evidenceId', 'evidence.evidenceId'],
};

function getByPath(obj, path) {
  const parts = String(path || '').split('.');
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function resolveActionType(actionType = '') {
  const normalized = String(actionType || '').trim().toLowerCase();
  return ACTION_TYPE_ALIASES[normalized] || normalized || 'unknown';
}

function resolveEvidenceContract(actionType = '') {
  const normalizedActionType = resolveActionType(actionType);
  return {
    actionType: normalizedActionType,
    contract: STEP_EVIDENCE_CONTRACTS[normalizedActionType] || DEFAULT_CONTRACT,
    exists: Boolean(STEP_EVIDENCE_CONTRACTS[normalizedActionType]),
  };
}

function readEvidenceField(evidence = {}, field = '') {
  const candidates = EVIDENCE_FIELD_ALIASES[field] || [field];
  for (const candidate of candidates) {
    const value = getByPath(evidence, candidate);
    if (!isEmptyValue(value)) return value;
  }
  return null;
}

function validateEvidenceByContract({ actionType, evidence = {}, journeyContext = {} } = {}) {
  const blocking = Boolean(journeyContext?.isBlockingJourney);
  const executionMode = String(journeyContext?.executionMode || 'operational_go').toLowerCase();
  const stepId = journeyContext?.stepId || evidence?.id || evidence?.stepId || 'unknown';
  const journeyId = journeyContext?.journeyId || '';

  const { actionType: normalizedActionType, contract, exists } = resolveEvidenceContract(
    actionType || evidence?.actionType || evidence?.action || evidence?.type
  );

  const requiredEvidence = Array.isArray(contract.require) ? contract.require : [];
  const optionalEvidence = Array.isArray(contract.optional) ? contract.optional : [];
  const observedEvidence = [];
  const missingEvidence = [];

  for (const field of requiredEvidence) {
    const value = readEvidenceField(evidence, field);
    if (isEmptyValue(value)) {
      missingEvidence.push(field);
    } else {
      observedEvidence.push(field);
    }
  }

  for (const field of optionalEvidence) {
    const value = readEvidenceField(evidence, field);
    if (!isEmptyValue(value)) observedEvidence.push(field);
  }

  const blockers = missingEvidence.map((field) => ({
    reason: `step_missing_${field}`,
    stepId,
    journeyId,
    field,
    actionType: normalizedActionType,
    executionMode,
    blocking,
    contractMissing: true,
  }));

  let goNoGo = null;
  if (blocking && missingEvidence.length > 0) {
    goNoGo = executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO';
  }

  return {
    valid: missingEvidence.length === 0,
    exists,
    actionType: normalizedActionType,
    evidenceContract: contract,
    requiredEvidence,
    optionalEvidence,
    observedEvidence,
    missingEvidence,
    blockers,
    goNoGo,
  };
}

module.exports = {
  STEP_EVIDENCE_CONTRACTS,
  DEFAULT_CONTRACT,
  resolveActionType,
  resolveEvidenceContract,
  validateEvidenceByContract,
  validateEvidenceProof,
  readEvidenceField,
};
