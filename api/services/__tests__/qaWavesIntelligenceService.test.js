'use strict';

const fs = require('fs');
const path = require('path');

const intelligenceService = require('../qaWavesIntelligenceService');

const DRAFTS_STORE_PATH = path.join(__dirname, '..', '..', '..', 'qa', 'qa-waves', 'ai-drafts.json');
const SCENARIO_STORE_PATH = path.join(__dirname, '..', '..', '..', 'qa', 'qa-waves', 'scenario-store.json');

function safeRead(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

describe('qaWavesIntelligenceService', () => {
  let draftBackup;
  let scenarioBackup;

  beforeAll(() => {
    draftBackup = safeRead(DRAFTS_STORE_PATH);
    scenarioBackup = safeRead(SCENARIO_STORE_PATH);
  });

  beforeEach(() => {
    fs.mkdirSync(path.dirname(DRAFTS_STORE_PATH), { recursive: true });
    fs.writeFileSync(DRAFTS_STORE_PATH, JSON.stringify({
      drafts: [
        {
          id: 'fitness_booking_experimental_class',
          waveId: 'fitness-cliente-novo',
          vertical: 'fitness',
          journey: 'cliente_novo',
          stage: 'agendamento',
          gap: 'Agendamento de aula experimental',
          title: 'Aula experimental com confirmação',
          semanticSteps: [
            { id: 'step_001', type: 'send_message', channel: 'whatsapp', input: { text: 'Quero agendar aula teste' } },
            { id: 'step_002', type: 'validate_intent', expected: { intent: 'trial_interest' } },
            { id: 'step_003', type: 'validate_response', expected: { semantic: 'confirmacao de agendamento' } },
          ],
          seeds: [
            { id: 'seed_001', source: 'ai_generated', status: 'draft_ai' },
          ],
          validators: [
            { type: 'semantic_intent', expected: 'trial_interest' },
          ],
          platformScenarioIds: ['qa-core-auth-login'],
          criticality: 'high',
          status: 'draft_ai',
          source: 'ai_generated',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, null, 2));

    fs.writeFileSync(SCENARIO_STORE_PATH, JSON.stringify({ scenarios: [], history: {}, updatedAt: null }, null, 2));
  });

  afterAll(() => {
    if (draftBackup == null) {
      if (fs.existsSync(DRAFTS_STORE_PATH)) fs.unlinkSync(DRAFTS_STORE_PATH);
    } else {
      fs.writeFileSync(DRAFTS_STORE_PATH, draftBackup, 'utf8');
    }

    if (scenarioBackup == null) {
      if (fs.existsSync(SCENARIO_STORE_PATH)) fs.unlinkSync(SCENARIO_STORE_PATH);
    } else {
      fs.writeFileSync(SCENARIO_STORE_PATH, scenarioBackup, 'utf8');
    }
  });

  test('approveDraft deve materializar draft como cenário real no scenario-store', () => {
    const scenario = intelligenceService.approveDraft('fitness_booking_experimental_class', { approvedBy: 'qa-reviewer' });

    expect(scenario.id).toBe('fitness_booking_experimental_class');
    expect(scenario.status).toBe('active');
    expect(scenario.executionStatus).toBe('queued');
    expect(scenario.platformScenarioIds).toEqual(['qa-core-auth-login']);
    expect(Array.isArray(scenario.semanticSteps)).toBe(true);
    expect(Array.isArray(scenario.validators)).toBe(true);

    const savedStore = JSON.parse(fs.readFileSync(SCENARIO_STORE_PATH, 'utf8'));
    const savedScenario = savedStore.scenarios.find((item) => item.id === 'fitness_booking_experimental_class');
    expect(savedScenario).toBeTruthy();
    expect(savedScenario.status).toBe('active');
    expect(savedScenario.executionStatus).toBe('queued');
    expect(savedStore.scenarios.filter((item) => item.id === 'fitness_booking_experimental_class')).toHaveLength(1);

    const savedDrafts = JSON.parse(fs.readFileSync(DRAFTS_STORE_PATH, 'utf8'));
    expect(savedDrafts.drafts[0].status).toBe('approved');
  });
});