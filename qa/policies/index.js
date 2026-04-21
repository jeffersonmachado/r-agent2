'use strict';

/**
 * qa/policies/index.js
 * Políticas centrais do QA — carrega e exporta thresholds.
 */

const fs = require('fs');
const path = require('path');

const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');

function loadPolicies() {
  return JSON.parse(fs.readFileSync(THRESHOLDS_PATH, 'utf8'));
}

function getStabilityPolicy() {
  return loadPolicies().stability;
}

function getReleaseGatePolicy() {
  return loadPolicies().releaseGate;
}

function getEvidencePolicy() {
  return loadPolicies().evidence;
}

function getLearnPolicy() {
  return loadPolicies().learn;
}

module.exports = {
  loadPolicies,
  getStabilityPolicy,
  getReleaseGatePolicy,
  getEvidencePolicy,
  getLearnPolicy,
};
