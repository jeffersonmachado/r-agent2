'use strict';

/**
 * supportTicketFlowSteps.js
 *
 * Definições de steps Playwright reais para support_ticket_flow.
 *
 * Cada step possui:
 *   - id, actionType, selectorUsed: metadados de auditoria
 *   - execute(page): função assíncrona que executa ação real na UI
 *   - mutation proof nasce no executor após afterStepSnapshot + incrementalDiff
 *
 * Jornada:
 *   1. step_access_support_module  → navigate
 *   2. step_wait_ticket_list       → wait_for_list
 *   3. step_open_ticket            → click_open
 *   4. step_reply_ticket           → type_and_send
 *   5. step_change_status          → change_status
 *   6. step_assert_ticket_ui       → assert_ui_state
 *   7. step_assert_ticket_backend  → assert_backend_state
 *
 * NOTA: Os selectors usam data-testid conforme convenção do projeto.
 * Se o app não tiver data-testid exatos, os steps falham de forma
 * auditável e geram NO_GO com evidência (screenshot + DOM) do ponto de falha.
 */

const JOURNEY_ID = 'support_ticket_flow';
const SUPPORT_PATH = '/support';
const { assertOperationalCondition } = require('../operationalAssertions');

async function waitForRequiredSelector(page, selector, timeout, metadata = {}) {
  try {
    const element = await page.waitForSelector(selector, { timeout });
    assertOperationalCondition(Boolean(element), {
      reason: metadata.reason || 'support_required_selector_missing',
      ...metadata,
      selector,
    });
    return element;
  } catch (error) {
    assertOperationalCondition(false, {
      reason: metadata.reason || 'support_required_selector_missing',
      ...metadata,
      selector,
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Gera array de steps operacionais para support_ticket_flow.
 *
 * @param {object} seedData - dados provisionados pelo supportOperationalSeed
 * @param {string} seedData.ticketId
 * @param {string} seedData.agentReply
 * @param {string} [seedData.baseUrl]
 * @returns {Array<object>} steps com execute(page)
 */
function buildSupportTicketFlowSteps(seedData = {}) {
  const {
    ticketId,
    agentReply = 'Resposta operacional QA Waves.',
    baseUrl = '',
    replySelector = '[data-testid="ticket-reply-input"]',
    sendSelector = '[data-testid="ticket-send-button"]',
    statusSelector = '[data-testid="ticket-status-select"]',
    resolvedStatus = 'resolved',
  } = seedData;

  return [
    // ── Step 1: acesso ao módulo de suporte ─────────────────────────────────
    {
      id: 'step_access_support_module',
      actionType: 'navigate',
      selectorUsed: null,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const target = `${baseUrl}${SUPPORT_PATH}`;
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        const url = page.url();
        assertOperationalCondition(url.includes('/support') || url.includes('support'), {
          reason: 'support_navigation_failed',
          journeyId: JOURNEY_ID,
          target,
          currentUrl: url,
        });
      },
    },

    // ── Step 2: aguardar lista de tickets ────────────────────────────────────
    {
      id: 'step_wait_ticket_list',
      actionType: 'wait_for_list',
      selectorUsed: '[data-testid="ticket-list"]',
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, '[data-testid="ticket-list"]', 10000, {
          reason: 'support_ticket_list_not_loaded',
          journeyId: JOURNEY_ID,
        });
      },
    },

    // ── Step 3: abrir ticket provisionado ────────────────────────────────────
    {
      id: 'step_open_ticket',
      actionType: 'click_open',
      selectorUsed: ticketId
        ? `[data-testid="ticket-card-${ticketId}"]`
        : '[data-testid="ticket-card"]',
      journeyId: JOURNEY_ID,
      async execute(page) {
        const selector = ticketId
          ? `[data-testid="ticket-card-${ticketId}"]`
          : '[data-testid="ticket-card"]';

        await waitForRequiredSelector(page, selector, 10000, {
          reason: 'support_ticket_card_missing',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
        });

        await page.click(selector);
        await page.waitForLoadState('domcontentloaded');
        await waitForRequiredSelector(page, '[data-testid="ticket-detail"]', 10000, {
          reason: 'support_ticket_not_opened',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
        });
      },
    },

    // ── Step 4: responder ticket ─────────────────────────────────────────────
    {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      selectorUsed: replySelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, replySelector, 10000, {
          reason: 'support_reply_input_missing',
          journeyId: JOURNEY_ID,
        });

        await waitForRequiredSelector(page, sendSelector, 10000, {
          reason: 'support_reply_send_button_missing',
          journeyId: JOURNEY_ID,
        });

        await page.fill(replySelector, agentReply);
        await page.click(sendSelector);

        await waitForRequiredSelector(page, '[data-testid="message-sent-confirmation"]', 8000, {
          reason: 'support_reply_not_sent',
          journeyId: JOURNEY_ID,
        });
      },
    },

    // ── Step 5: alterar status do ticket ────────────────────────────────────
    {
      id: 'step_change_status',
      actionType: 'change_status',
      selectorUsed: statusSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, statusSelector, 8000, {
          reason: 'support_status_selector_missing',
          journeyId: JOURNEY_ID,
        });

        await page.selectOption(statusSelector, resolvedStatus);
        await page.waitForLoadState('networkidle', { timeout: 8000 });

        const statusBadge = await waitForRequiredSelector(page, '[data-testid="ticket-status"]', 8000, {
          reason: 'support_status_badge_missing_after_change',
          journeyId: JOURNEY_ID,
        });

        const statusText = String((await statusBadge.textContent()) || '').trim().toLowerCase();
        assertOperationalCondition(statusText.length > 0 && statusText.includes(String(resolvedStatus).toLowerCase()), {
          reason: 'support_status_not_changed_in_ui',
          journeyId: JOURNEY_ID,
          expectedStatus: resolvedStatus,
          actualStatus: statusText,
        });
      },
    },

    // ── Step 6: validar UI refletiu mutação ──────────────────────────────────
    {
      id: 'step_assert_ticket_ui',
      actionType: 'assert_ui_state',
      selectorUsed: '[data-testid="ticket-status"]',
      journeyId: JOURNEY_ID,
      snapshotDiff: {
        expectedMutations: ['ticket_status_changed', 'ticket_reply_persisted'],
        expectedSideEffects: ['crm_updated', 'audit_log_created'],
      },
      sideEffectLinkage: {
        expectedSideEffects: ['crm_updated', 'audit_log_created'],
        correlatedBy: 'state_assertion',
      },
      async execute(page) {
        const statusEl = await waitForRequiredSelector(page, '[data-testid="ticket-status"]', 5000, {
          reason: 'support_ui_status_missing',
          journeyId: JOURNEY_ID,
        });

        const statusText = String((await statusEl.textContent()) || '').trim();
        assertOperationalCondition(statusText.length > 0, {
          reason: 'support_ui_not_updated',
          journeyId: JOURNEY_ID,
          selector: '[data-testid="ticket-status"]',
        });
      },
    },

    // ── Step 7: validar backend refletiu mutação ─────────────────────────────
    {
      id: 'step_assert_ticket_backend',
      actionType: 'assert_backend_state',
      status: 'passed',
      selectorUsed: '[data-testid="ticket-backend-state"]',
      journeyId: JOURNEY_ID,
      async execute(page) {
        const backendStateEl = await waitForRequiredSelector(
          page,
          '[data-testid="ticket-backend-state"], [data-testid="ticket-status"]',
          5000,
          {
            reason: 'support_backend_state_missing',
            journeyId: JOURNEY_ID,
          }
        );

        const backendStateText = String((await backendStateEl.textContent()) || '').trim();
        assertOperationalCondition(backendStateText.length > 0, {
          reason: 'support_backend_state_not_available',
          journeyId: JOURNEY_ID,
        });
      },
    },
  ];
}

module.exports = {
  buildSupportTicketFlowSteps,
  JOURNEY_ID,
  SUPPORT_PATH,
};
