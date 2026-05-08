'use strict';

/**
 * fitnessCheckinFlowSteps.js
 *
 * Definições de steps Playwright reais para fitness_customer_checkin.
 *
 * Cada step possui:
 *   - id, actionType, selectorUsed: metadados de auditoria
 *   - execute(page): função assíncrona que executa ação real na UI
 *   - mutationLinkage: vínculo UI → API → mutação → side effects
 *
 * Jornada:
 *   1. step_access_checkin_module  → navigate
 *   2. step_validate_membership    → assert_ui_state
 *   3. step_identify_customer      → checkin_submit
 *   4. step_assert_access_decision → assert_backend_state
 *   5. step_assert_attendance      → assert_attendance
 *
 * NOTA: simulated_device é PROIBIDO.
 * test_device é o fallback operacionalmente válido (controlado, auditável).
 */

const JOURNEY_ID = 'fitness_customer_checkin';
const CHECKIN_PATH = '/fitness/checkin';
const ACCESS_CONTROL_PATH = '/access-control';
const { assertOperationalCondition } = require('../operationalAssertions');

async function waitForRequiredSelector(page, selector, timeout, metadata = {}) {
  try {
    const element = await page.waitForSelector(selector, { timeout });
    assertOperationalCondition(Boolean(element), {
      reason: metadata.reason || 'fitness_required_selector_missing',
      ...metadata,
      selector,
    });
    return element;
  } catch (error) {
    assertOperationalCondition(false, {
      reason: metadata.reason || 'fitness_required_selector_missing',
      ...metadata,
      selector,
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Gera array de steps operacionais para fitness_customer_checkin.
 *
 * @param {object} seedData - dados provisionados pelo fitnessOperationalSeed
 * @param {string} seedData.subjectId
 * @param {string} seedData.credentialValue - valor da credencial (QR / código)
 * @param {string} seedData.deviceId
 * @param {string} seedData.deviceMode - 'real_device' | 'test_device' (nunca 'simulated_device')
 * @param {string} [seedData.baseUrl]
 * @returns {Array<object>} steps com execute(page)
 */
function buildFitnessCheckinFlowSteps(seedData = {}) {
  const {
    subjectId,
    credentialValue = '',
    deviceId,
    deviceMode = 'test_device',
    baseUrl = '',
    credentialInputSelector = '[data-testid="checkin-credential-input"]',
    submitSelector = '[data-testid="checkin-submit-button"]',
    accessDecisionSelector = '[data-testid="access-decision-result"]',
    attendanceSelector = '[data-testid="attendance-confirmation"]',
  } = seedData;

  // Guard: simulated_device nunca deve chegar aqui, mas defendemos
  if (String(deviceMode).toLowerCase().includes('simulated')) {
    throw new Error(
      `fitness_checkin_simulated_device_forbidden: deviceMode="${deviceMode}" é proibido em jornada blocking. Use test_device ou real_device.`
    );
  }

  return [
    // ── Step 1: acesso ao módulo de check-in ────────────────────────────────
    {
      id: 'step_access_checkin_module',
      actionType: 'navigate',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      mutationLinkage: null,
      async execute(page) {
        const primary = `${baseUrl}${CHECKIN_PATH}`;
        await page.goto(primary, { waitUntil: 'domcontentloaded' });
        const url = page.url();
        assertOperationalCondition(url.includes('/fitness') || url.includes('/checkin') || url.includes('/access-control'), {
          reason: 'fitness_navigation_failed',
          journeyId: JOURNEY_ID,
          target: primary,
          fallbackPath: `${baseUrl}${ACCESS_CONTROL_PATH}`,
          currentUrl: url,
        });
      },
    },

    // ── Step 2: identificar cliente ─────────────────────────────────────────
    {
      id: 'step_identify_customer',
      actionType: 'checkin_submit',
      selectorUsed: credentialInputSelector,
      journeyId: JOURNEY_ID,
      mutationLinkage: {
        uiAction: 'input_credential',
        apiEndpoint: '/api/fitness/checkin/identify',
        expectedMutations: ['credential_validated', 'membership_checked', 'subject_identified'],
        expectedSideEffects: ['access_policy_evaluated'],
        correlatedBy: 'network_linkage',
      },
      sideEffectLinkage: {
        expectedSideEffects: ['access_policy_evaluated'],
        correlatedBy: 'network_linkage',
      },
      async execute(page) {
        await waitForRequiredSelector(page, credentialInputSelector, 10000, {
          reason: 'fitness_credential_input_missing',
          journeyId: JOURNEY_ID,
        });

        await waitForRequiredSelector(page, submitSelector, 10000, {
          reason: 'fitness_submit_button_missing',
          journeyId: JOURNEY_ID,
        });

        await page.fill(credentialInputSelector, credentialValue);
        await page.click(submitSelector);
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      },
    },

    // ── Step 3: validar membership no backend ────────────────────────────────
    {
      id: 'step_validate_membership',
      actionType: 'assert_ui_state',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      snapshotDiff: {
        expectedMutations: ['membership_status_confirmed'],
      },
      async execute(page) {
        const membershipEl = await waitForRequiredSelector(page, '[data-testid="membership-validation-result"]', 8000, {
          reason: 'fitness_membership_validation_missing',
          journeyId: JOURNEY_ID,
        });

        const text = String((await membershipEl.textContent()) || '').trim().toLowerCase();
        const validSignal = text.includes('valid') || text.includes('active') || text.includes('aprov') || text.includes('allow');
        const invalidSignal = text.includes('invalid') || text.includes('expired') || text.includes('inactive') || text.includes('denied') || text.includes('negado');
        assertOperationalCondition(
          validSignal && !invalidSignal,
          {
            reason: 'fitness_membership_invalid',
            journeyId: JOURNEY_ID,
            actual: text,
          }
        );
      },
    },

    // ── Step 4: confirmar AccessDecision = allow ─────────────────────────────
    {
      id: 'step_resolve_access_decision',
      actionType: 'assert_backend_state',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      snapshotDiff: {
        expectedMutations: ['access_decision_allow', 'access_event_created'],
      },
      mutationLinkage: {
        uiAction: 'assert_access_allow',
        apiEndpoint: '/api/fitness/access/decision',
        expectedMutations: ['access_decision_allow', 'access_event_created'],
        expectedSideEffects: ['turnstile_released', 'journey_updated'],
        correlatedBy: 'state_assertion_and_network',
        subjectId,
        deviceId,
        deviceMode,
      },
      async execute(page) {
        const decisionEl = await waitForRequiredSelector(page, accessDecisionSelector, 8000, {
          reason: 'fitness_access_decision_missing',
          journeyId: JOURNEY_ID,
        });

        const text = String((await decisionEl.textContent()) || '').trim().toLowerCase();
        assertOperationalCondition(
          text.length > 0 && !text.includes('denied') && !text.includes('negado')
          && (text.includes('allow') || text.includes('granted') || text.includes('liberad')),
          {
            reason: 'fitness_access_decision_not_allow',
            journeyId: JOURNEY_ID,
            selector: accessDecisionSelector,
            actual: text,
          }
        );
      },
    },

    // ── Step 5: confirmar registro de presença ───────────────────────────────
    {
      id: 'step_confirm_attendance',
      actionType: 'assert_attendance',
      selectorUsed: attendanceSelector,
      journeyId: JOURNEY_ID,
      snapshotDiff: {
        expectedMutations: ['attendance_created', 'presence_recorded'],
      },
      mutationLinkage: {
        uiAction: 'confirm_attendance_created',
        apiEndpoint: '/api/fitness/attendance',
        expectedMutations: ['attendance_created', 'presence_recorded'],
        expectedSideEffects: ['crm_presence_updated', 'journey_event_emitted'],
        correlatedBy: 'state_assertion',
        subjectId,
      },
      sideEffectLinkage: {
        expectedSideEffects: ['crm_presence_updated', 'journey_event_emitted'],
        correlatedBy: 'state_assertion',
      },
      async execute(page) {
        const attendanceEl = await waitForRequiredSelector(page, attendanceSelector, 8000, {
          reason: 'fitness_attendance_missing',
          journeyId: JOURNEY_ID,
        });

        const attendanceText = String((await attendanceEl.textContent()) || '').trim().toLowerCase();
        assertOperationalCondition(
          attendanceText.includes('created') || attendanceText.includes('confirm') || attendanceText.includes('registrad'),
          {
            reason: 'fitness_attendance_not_created',
            journeyId: JOURNEY_ID,
            selector: attendanceSelector,
            actual: attendanceText,
          }
        );
      },
    },

    // ── Step 6: validar atualização no CRM ───────────────────────────────────
    {
      id: 'step_validate_crm_update',
      actionType: 'assert_ui_state',
      selectorUsed: '[data-testid="crm-update-confirmation"]',
      journeyId: JOURNEY_ID,
      mutationLinkage: {
        uiAction: 'assert_crm_updated',
        apiEndpoint: '/api/fitness/crm/presence',
        expectedMutations: ['crm_presence_updated', 'journey_event_emitted'],
        expectedSideEffects: ['crm_journey_updated'],
        correlatedBy: 'state_assertion',
        subjectId,
      },
      sideEffectLinkage: {
        expectedSideEffects: ['crm_journey_updated'],
        correlatedBy: 'state_assertion',
      },
      async execute(page) {
        const crmEl = await waitForRequiredSelector(page, '[data-testid="crm-update-confirmation"]', 5000, {
          reason: 'fitness_crm_not_updated',
          journeyId: JOURNEY_ID,
        });

        const crmText = String((await crmEl.textContent()) || '').trim();
        assertOperationalCondition(crmText.length > 0, {
          reason: 'fitness_crm_not_updated',
          journeyId: JOURNEY_ID,
          selector: '[data-testid="crm-update-confirmation"]',
          actual: crmText,
        });
      },
    },
  ];
}

module.exports = {
  buildFitnessCheckinFlowSteps,
  JOURNEY_ID,
  CHECKIN_PATH,
  ACCESS_CONTROL_PATH,
};
