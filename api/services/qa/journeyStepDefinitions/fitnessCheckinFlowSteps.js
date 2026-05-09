'use strict';

/**
 * fitnessCheckinFlowSteps.js
 *
 * Definições de steps Playwright reais para fitness_customer_checkin.
 *
 * Cada step possui:
 *   - id, actionType, selectorUsed: metadados de auditoria
 *   - execute(page): função assíncrona que executa ação real na UI
 *   - mutation proof nasce no executor após afterStepSnapshot + incrementalDiff
 *
 * Jornada (SEMANTICAMENTE CONSISTENTE):
 *   1. step_access_checkin_module  (navigate) - SEM mutação
 *   2. step_identify_customer      (identify_customer) - SEM mutação  
 *   3. step_validate_membership    (assert_backend_state) - SEM mutação
 *   4. step_submit_checkin         (checkin_submit) - COM mutação: attendance_created
 *   5. step_confirm_attendance     (assert_attendance) - SEM mutação adicional
 *
 * NOTA: simulated_device é PROIBIDO.
 * test_device é o fallback operacionalmente válido (controlado, auditável).
 *
 * FASE 2: Cada step está registrado em operationalStepRegistry.js como
 * SINGLE SOURCE OF TRUTH para: stepId, actionType, mutationExpected, 
 * expectedMutations, expectedSideEffects, snapshotRequired, entityScope.
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

    // ── Step 2: identificar cliente (SEM mutação) ───────────────────────────
    {
      id: 'step_identify_customer',
      actionType: 'identify_customer',
      selectorUsed: credentialInputSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, credentialInputSelector, 10000, {
          reason: 'fitness_credential_input_missing',
          journeyId: JOURNEY_ID,
        });

        const submitBtn = await waitForRequiredSelector(page, submitSelector, 10000, {
          reason: 'fitness_submit_button_missing',
          journeyId: JOURNEY_ID,
        });

        // Apenas preenche credential, NÃO submete ainda
        await page.fill(credentialInputSelector, credentialValue);
      },
    },

    // ── Step 3: validar membership no backend (SEM mutação) ──────────────────
    {
      id: 'step_validate_membership',
      actionType: 'assert_backend_state',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      async execute(page) {
        // Aqui poderíamos fazer uma verificação de estado backend
        // mas não é uma ação na UI que gera mutação
        // Apenas asserção
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

    // ── Step 4: SUBMETER check-in (COM mutação: attendance_created) ─────────
    {
      id: 'step_submit_checkin',
      actionType: 'checkin_submit',
      selectorUsed: submitSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const submitBtn = await waitForRequiredSelector(page, submitSelector, 10000, {
          reason: 'fitness_submit_button_missing',
          journeyId: JOURNEY_ID,
        });

        await page.click(submitSelector);
        await page.waitForLoadState('networkidle', { timeout: 8000 });

        // Após submit, verificar que access decision e attendance foram criados
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

    // ── Step 5: confirmar attendance (SEM mutação adicional) ────────────────
    {
      id: 'step_confirm_attendance',
      actionType: 'assert_attendance',
      selectorUsed: attendanceSelector,
      journeyId: JOURNEY_ID,
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
  ];
}

module.exports = {
  buildFitnessCheckinFlowSteps,
  JOURNEY_ID,
  CHECKIN_PATH,
  ACCESS_CONTROL_PATH,
};
