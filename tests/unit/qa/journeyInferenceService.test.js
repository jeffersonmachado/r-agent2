'use strict';

/**
 * Regressão: inferJourneys({ persist: true }) não pode destruir o contrato
 * versionado config/journey-contracts.json.
 *
 * Falha observada (2026-07-25): POST /api/qa-waves/operational/recompute
 * regravou o arquivo com version 1 e apenas as jornadas que a heurística
 * conseguiu inferir, apagando as 16 jornadas de negócio geradas por
 * scripts/qa-waves/generate-business-contracts.js (version 2, 21 jornadas).
 *
 * Comportamento correto: a inferência faz merge — atualiza as jornadas que
 * ela conhece, preserva as demais e nunca rebaixa `version`.
 */

const fs = require('fs');
const path = require('path');

const { inferJourneys } = require('../../../api/services/qa/journeyInferenceService');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'journey-contracts.json');

describe('journeyInferenceService — persistência não destrutiva', () => {
  let originalRaw;

  beforeAll(() => {
    originalRaw = fs.readFileSync(CONTRACTS_PATH, 'utf8');
  });

  afterAll(() => {
    fs.writeFileSync(CONTRACTS_PATH, originalRaw, 'utf8');
  });

  test('preserva jornadas existentes que a heurística não infere', () => {
    const existing = JSON.parse(originalRaw);
    const existingJourneyIds = Object.keys(existing.journeys || {});
    expect(existingJourneyIds.length).toBeGreaterThan(0);

    // Discovery mínimo: a heurística infere no máximo uma fração das jornadas.
    inferJourneys({
      persist: true,
      discovery: { backend: { modules: ['support'], routes: ['/support'] }, frontend: {} },
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    const persisted = JSON.parse(fs.readFileSync(CONTRACTS_PATH, 'utf8'));
    const persistedIds = Object.keys(persisted.journeys || {});

    for (const journeyId of existingJourneyIds) {
      expect(persistedIds).toContain(journeyId);
    }
  });

  test('nunca rebaixa a versão do contrato', () => {
    const existing = JSON.parse(originalRaw);
    inferJourneys({
      persist: true,
      discovery: { backend: { modules: ['support'], routes: ['/support'] }, frontend: {} },
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    const persisted = JSON.parse(fs.readFileSync(CONTRACTS_PATH, 'utf8'));
    expect(persisted.version).toBeGreaterThanOrEqual(existing.version || 1);
  });

  test('atualiza a jornada inferida mantendo estrutura do contrato', () => {
    inferJourneys({
      persist: true,
      discovery: {
        backend: { modules: ['support', 'ticket'], routes: ['/support'], services: [], events: [] },
        frontend: { pages: [], routes: [], testIds: [] },
      },
      capabilities: [{ id: 'support_ticket_flow' }, { id: 'support_ticket_reply' }],
    });

    const persisted = JSON.parse(fs.readFileSync(CONTRACTS_PATH, 'utf8'));
    const inferred = persisted.journeys.support_ticket_flow;
    expect(inferred).toBeDefined();
    expect(Array.isArray(inferred.requiredCapabilities)).toBe(true);
    expect(inferred.requiredCapabilities).toContain('support_ticket_flow');
    expect(typeof inferred.confidence).toBe('number');
  });
});
