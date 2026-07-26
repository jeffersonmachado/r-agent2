'use strict';

/**
 * Regressão: toda capability exigida pelos contratos de jornada
 * (config/journey-contracts.json) deve ser descoberta pelo inventário.
 *
 * Falha observada (2026-07-26): os contratos de negocio gerados por
 * scripts/qa-waves/generate-business-contracts.js exigem scheduling, payment,
 * crm_updates, notifications, lead_capture e onboarding, mas nenhum scanner
 * tinha hints para esses IDs — o gap detector marcava
 * `capability_nao_descoberta` e o operational-health ficava NO_GO. O bug de
 * persistencia destrutiva do journeyInferenceService escondia isso apagando
 * os contratos a cada recompute.
 */

const fs = require('fs');
const path = require('path');

const backendCapabilityScanner = require('../../../api/services/qa/scanners/backendCapabilityScanner');
const e2eCapabilityScanner = require('../../../api/services/qa/scanners/e2eCapabilityScanner');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'journey-contracts.json');

const CONTRACT_REQUIRED_CAPABILITIES = [
  'scheduling',
  'payment',
  'crm_updates',
  'notifications',
  'lead_capture',
  'onboarding',
];

describe('descoberta das capabilities exigidas pelos contratos de jornada', () => {
  test('contratos versionados realmente exigem essas capabilities', () => {
    const contracts = JSON.parse(fs.readFileSync(CONTRACTS_PATH, 'utf8'));
    const required = new Set(
      Object.values(contracts.journeys || {})
        .flatMap((journey) => journey.requiredCapabilities || []),
    );
    for (const capabilityId of CONTRACT_REQUIRED_CAPABILITIES) {
      expect(required.has(capabilityId)).toBe(true);
    }
  });

  test('backend scanner descobre implementacao real das 6 capabilities', () => {
    const backend = backendCapabilityScanner.scan({ rootDir: ROOT_DIR });
    const discovered = new Set((backend.inferredCapabilities || []).map((item) => item.id));
    for (const capabilityId of CONTRACT_REQUIRED_CAPABILITIES) {
      expect(discovered.has(capabilityId)).toBe(true);
    }
  });

  test('e2e scanner descobre validacao real das 6 capabilities', () => {
    const e2e = e2eCapabilityScanner.scan({ rootDir: ROOT_DIR });
    const discovered = new Set((e2e.inferredCapabilities || []).map((item) => item.id));
    for (const capabilityId of CONTRACT_REQUIRED_CAPABILITIES) {
      expect(discovered.has(capabilityId)).toBe(true);
    }
  });
});
