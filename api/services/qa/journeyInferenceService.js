'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const JOURNEY_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'journey-contracts.json');

const JOURNEY_TEMPLATES = [
  {
    id: 'fitness_customer_checkin',
    requiredCapabilities: [
      'customer_identification',
      'membership_validation',
      'access_decision',
      'turnstile_release',
      'attendance_record',
      'crm_update',
    ],
    signals: ['checkin', 'attendance', 'face', 'turnstile', 'membership'],
  },
  {
    id: 'support_ticket_flow',
    requiredCapabilities: [
      'support_ticket_flow',
      'support_ticket_reply',
    ],
    signals: ['support', 'ticket', 'reply', 'mensagem', '/support'],
  },
  {
    id: 'omnichannel_engagement',
    requiredCapabilities: [
      'omnichannel_whatsapp',
      'omnichannel_webchat',
      'omnichannel_pbx',
      'omnichannel_email',
    ],
    signals: ['whatsapp', 'webchat', 'pbx', 'email'],
  },
  {
    id: 'booking_flow',
    requiredCapabilities: [
      'support_ticket_flow',
    ],
    signals: ['booking_flow', 'resource-bookings', 'booking', 'schedule'],
  },
  {
    id: 'payment_charge_flow',
    requiredCapabilities: [
      'billing_validation',
    ],
    signals: ['payment_charge_flow', 'billing', 'payment', 'membership', 'charge'],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonSafe(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildSemanticCorpus(discovery = {}) {
  const parts = [];
  const backend = discovery.backend || {};
  const frontend = discovery.frontend || {};

  parts.push(...(backend.modules || []));
  parts.push(...(backend.services || []));
  parts.push(...(backend.routes || []));
  parts.push(...(backend.events || []));
  parts.push(...(frontend.pages || []));
  parts.push(...(frontend.routes || []));
  parts.push(...(frontend.testIds || []));

  return parts.join(' ').toLowerCase();
}

function inferJourneyCandidates({ discovery, capabilities }) {
  const corpus = buildSemanticCorpus(discovery);
  const capIds = new Set((capabilities || []).map((capability) => capability.id));
  const inferred = [];

  for (const template of JOURNEY_TEMPLATES) {
    const signalScore = template.signals.reduce((acc, signal) => acc + (corpus.includes(signal.toLowerCase()) ? 1 : 0), 0);
    const capScore = template.requiredCapabilities.reduce((acc, capabilityId) => acc + (capIds.has(capabilityId) ? 1 : 0), 0);
    const score = signalScore + capScore;

    if (score < 3) continue;

    inferred.push({
      journeyId: template.id,
      confidence: Math.min(1, score / (template.signals.length + template.requiredCapabilities.length)),
      requiredCapabilities: template.requiredCapabilities.filter((capabilityId) => capIds.has(capabilityId)),
      missingCapabilities: template.requiredCapabilities.filter((capabilityId) => !capIds.has(capabilityId)),
      evidenceScore: score,
    });
  }

  return inferred.sort((a, b) => b.confidence - a.confidence);
}

function inferJourneys(options = {}) {
  const discovery = options.discovery || {};
  const capabilities = options.capabilities || [];
  const persist = options.persist !== false;

  const inferred = inferJourneyCandidates({ discovery, capabilities });
  const journeyContracts = {};
  const graph = { nodes: [], edges: [] };

  for (const journey of inferred) {
    journeyContracts[journey.journeyId] = {
      requiredCapabilities: journey.requiredCapabilities,
      missingCapabilities: journey.missingCapabilities,
      confidence: Number(journey.confidence.toFixed(2)),
    };

    graph.nodes.push({
      id: journey.journeyId,
      type: 'journey',
      confidence: Number(journey.confidence.toFixed(2)),
    });

    for (const capabilityId of journey.requiredCapabilities) {
      graph.edges.push({
        from: capabilityId,
        to: journey.journeyId,
        type: 'required_by_journey',
      });
    }
  }

  const result = {
    generatedAt: nowIso(),
    journeys: inferred,
    journeyContracts,
    journeyGraph: graph,
  };

  if (persist) {
    writeJsonSafe(JOURNEY_CONTRACTS_PATH, {
      version: 1,
      generatedAt: result.generatedAt,
      journeys: journeyContracts,
    });
  }

  return result;
}

module.exports = {
  inferJourneys,
};
