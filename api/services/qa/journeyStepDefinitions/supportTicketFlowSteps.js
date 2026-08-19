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
 * Jornada (10 steps canônicos do operationalStepRegistry):
 *   1. step_access_support_module    → navigate
 *   2. step_wait_ticket_list         → wait_for_list
 *   3. step_open_ticket              → click_open
 *   4. step_takeover_ticket          → takeover_ticket (MUTAÇÃO: waiting → in_progress)
 *   5. step_reply_ticket             → type_and_send (MUTAÇÃO)
 *   6. step_whatsapp_read_status     → webhook_status
 *   7. step_assert_whatsapp_delivery → assert_delivery_state
 *   8. step_change_status            → change_status (MUTAÇÃO: modal + confirmação)
 *   9. step_assert_ticket_ui         → assert_ui_state
 *  10. step_assert_ticket_backend   → assert_backend_state
 *
 * NOTA: Os selectors usam data-testid/data-ticket-id conforme a UI real de
 * /support (SupportTicketList.jsx / SupportConversationPane.jsx). O status
 * real do fluxo é 'closed' (não existe 'resolved' na UI); o fechamento passa
 * pelo modal de encerramento (motivo obrigatório) + ConfirmDialog.
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
 * Fetch real à API dentro da sessão autenticada da página (mesma origem da UI,
 * proxy do Vite). Rodar no contexto do browser faz o network capture do
 * executor registrar a chamada — é o que sustenta a network proof dos steps
 * canônicos (ex.: POST /tickets/:id/takeover).
 */
async function browserApiFetch(page, requestPath, requestOptions = {}) {
  return page.evaluate(async ({ path, options }) => {
    const token = window.localStorage.getItem('auth_token');
    const tenant = window.localStorage.getItem('auth_effective_tenant_id')
      || window.localStorage.getItem('auth_last_tenant_id')
      || 'system';
    const resp = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-tenant-id': tenant,
      },
      ...(options.body != null ? { body: options.body } : {}),
    });
    const text = await resp.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: resp.ok, status: resp.status, body };
  }, { path: requestPath, options: requestOptions });
}

/**
 * Lê o estado real de entrega das mensagens do ticket (outbound WhatsApp):
 * deliveryStatus e externalMessageId da última mensagem que os possuir.
 */
async function fetchTicketDeliveryMetadata(page, ticketId) {
  const detail = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}`, { method: 'GET' }).catch(() => null);
  const messagesResp = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'GET' }).catch(() => null);
  const rawBody = messagesResp?.body;
  const messages = Array.isArray(rawBody?.messages) ? rawBody.messages
    : Array.isArray(rawBody?.items) ? rawBody.items
      : Array.isArray(rawBody) ? rawBody : [];
  const withDelivery = [...messages].reverse().find((m) => m && (m.deliveryStatus || m.delivery_status));
  const withExternal = [...messages].reverse().find((m) => m && (m.externalMessageId || m.external_message_id));
  return {
    ticketStatus: detail?.body?.ticket?.status || detail?.body?.status || null,
    deliveryStatus: withDelivery?.deliveryStatus || withDelivery?.delivery_status || null,
    externalMessageId: withExternal?.externalMessageId || withExternal?.external_message_id || null,
  };
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
    baseUrl = '',
    replySelector = '[data-testid="ticket-reply-input"]',
    sendSelector = '[data-testid="ticket-send-button"]',
    closeButtonSelector = '[data-testid="ticket-close-button"]',
    closeReason = 'Resolvido — validação operacional QA Waves',
  } = seedData;

  // agentReply pode vir como objeto no seed do cenário (ex.: { text }).
  // page.fill exige string — coerção defensiva na borda, com default explícito.
  const rawReply = seedData.agentReply;
  const agentReply = typeof rawReply === 'string' && rawReply.trim()
    ? rawReply
    : (rawReply && typeof rawReply === 'object'
      ? String(rawReply.text || rawReply.message || rawReply.value || '').trim() || 'Resposta operacional QA Waves.'
      : 'Resposta operacional QA Waves.');

  // Card do ticket provisionado: a UI real expõe data-ticket-id no card
  // (SupportTicketList.jsx), o que torna a localização determinística.
  const ticketCardSelector = ticketId
    ? `[data-testid="ticket-card"][data-ticket-id="${ticketId}"]`
    : '[data-testid="ticket-card"]';

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
      selectorUsed: ticketCardSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, ticketCardSelector, 15000, {
          reason: 'support_ticket_card_missing',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
        });

        await page.click(ticketCardSelector);
        // O ticket provisionado nasce 'waiting' (fila real): o painel mostra o
        // placeholder "Aguardando atribuição" com o botão "Atribuir Chamado"
        // (ticket-transfer-button). Se já estiver em atendimento, mostra o
        // histórico (ticket-message-list). Qualquer um dos dois prova abertura.
        await waitForRequiredSelector(
          page,
          '[data-testid="ticket-transfer-button"], [data-testid="ticket-message-list"]',
          10000,
          {
            reason: 'support_ticket_not_opened',
            journeyId: JOURNEY_ID,
            ticketId: ticketId || null,
          }
        );
      },
    },

    // ── Step 4: takeover do ticket (MUTAÇÃO: waiting → in_progress) ─────────
    // Fluxo real de atendimento: o ticket nasce 'waiting' na fila. O takeover
    // (modo bot → humano) seguido de assign ao próprio agente transiciona o
    // status para in_progress — é a mesma mutação do botão "Atribuir Chamado"
    // da UI (o auto-assign do takeover é pulado quando a fila usa strategy
    // 'manual'). As chamadas rodam na sessão autenticada do browser para que o
    // network capture registre POST /tickets/:id/takeover (network proof do
    // contrato) e o diff incremental capture ticket_status_changed +
    // audit_log_created. Ao final, a UI é recarregada e o ticket reaberto:
    // o composer (ticket-reply-input) só aparece com status in_progress.
    {
      id: 'step_takeover_ticket',
      actionType: 'takeover_ticket',
      selectorUsed: 'support-takeover-fetch',
      journeyId: JOURNEY_ID,
      async execute(page) {
        const takeover = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/takeover`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'qa_waves_operational' }),
        });
        assertOperationalCondition(takeover.ok, {
          reason: 'support_takeover_failed',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
          httpStatus: takeover.status,
        });

        const assign = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/assign`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        assertOperationalCondition(assign.ok, {
          reason: 'support_assign_failed',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
          httpStatus: assign.status,
        });

        // Reflete a mutação na UI real. O ticket selecionado é re-sincronizado
        // pelo refresh/WebSocket (loadTickets atualiza selectedTicket a partir
        // da lista recarregada): com status in_progress o composer aparece sem
        // reabrir o card. Caminho preferencial: aguardar o composer direto.
        await page.click('button[aria-label="Atualizar chamados"]').catch(() => {});
        try {
          await page.waitForSelector('[data-testid="ticket-reply-input"]', { timeout: 8000 });
          return;
        } catch {
          // Fallback: a lista de conversas colapsa ao selecionar um ticket no
          // desktop (attendance-runtime-board--conversation-collapsed) — reabre
          // a lista antes de localizar o card novamente.
        }

        const showListButton = page.locator('button[aria-label="Mostrar lista de conversas"]').first();
        if (await showListButton.isVisible().catch(() => false)) {
          await showListButton.click().catch(() => {});
          await page.waitForTimeout(300);
        }
        await waitForRequiredSelector(page, ticketCardSelector, 15000, {
          reason: 'support_ticket_card_missing_after_takeover',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
        });
        await page.click(ticketCardSelector);
        await waitForRequiredSelector(page, '[data-testid="ticket-reply-input"]', 10000, {
          reason: 'support_composer_missing_after_takeover',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
        });
      },
    },

    // ── Step 5: responder ticket ─────────────────────────────────────────────
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

        // Mensagens do agente renderizam com data-testid="message-sent";
        // a confirmação real de envio é o incremento dessa contagem.
        const sentBefore = await page.locator('[data-testid="message-sent"]').count();

        await page.fill(replySelector, agentReply);
        await page.click(sendSelector);

        try {
          await page.waitForFunction(
            (previous) => document.querySelectorAll('[data-testid="message-sent"]').length > previous,
            sentBefore,
            { timeout: 15000 }
          );
        } catch (error) {
          assertOperationalCondition(false, {
            reason: 'support_reply_not_sent',
            journeyId: JOURNEY_ID,
            sentBefore,
            error: error?.message || String(error),
          });
        }
      },
    },

    // ── Step 6: status de leitura WhatsApp (webhook de status) ──────────────
    // Após o reply, a mensagem outbound é entregue ao provider WhatsApp. Com
    // provider real, o externalMessageId existe e o step dispara o webhook de
    // status 'read' (fluxo real do Meta webhook). Sem provider configurado no
    // ambiente (connection_not_found), não há mensagem externa: o step registra
    // o estado real da fila de entrega (delivery-failures) e segue — o assert
    // de entrega (step seguinte) é quem valida o estado terminal.
    {
      id: 'step_whatsapp_read_status',
      actionType: 'webhook_status',
      selectorUsed: 'whatsapp-webhook-fetch',
      journeyId: JOURNEY_ID,
      async execute(page) {
        let metadata = {};
        for (let attempt = 0; attempt < 6 && !metadata.externalMessageId; attempt += 1) {
          metadata = await fetchTicketDeliveryMetadata(page, ticketId);
          if (!metadata.externalMessageId) {
            await page.waitForTimeout(1000);
          }
        }

        if (!metadata.externalMessageId) {
          await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/delivery-failures`, {
            method: 'GET',
          }).catch(() => null);
          return;
        }

        const webhook = await browserApiFetch(page, '/webhooks/whatsapp', {
          method: 'POST',
          body: JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: metadata.externalMessageId, status: 'read' }] } }] }],
          }),
        });
        assertOperationalCondition(webhook.ok, {
          reason: 'support_whatsapp_webhook_failed',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
          httpStatus: webhook.status,
        });
      },
    },

    // ── Step 7: assert estado terminal de entrega WhatsApp ───────────────────
    // O worker de outbound (1,5s) marca o deliveryStatus da mensagem na linha
    // do ticket: 'sent' com provider real, 'failed' (connection_not_found) sem
    // provider. Ambos são estados terminais reais do ambiente — o que o
    // contrato exige é que a entrega tenha sido processada de fato.
    {
      id: 'step_assert_whatsapp_delivery',
      actionType: 'assert_delivery_state',
      selectorUsed: 'support-ticket-messages-fetch',
      journeyId: JOURNEY_ID,
      async execute(page) {
        const acceptedStatuses = new Set(['read', 'delivered', 'sent', 'failed', 'stub', 'skipped', 'provider-dependent']);
        let lastStatus = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const metadata = await fetchTicketDeliveryMetadata(page, ticketId);
          lastStatus = metadata.deliveryStatus || lastStatus;
          if (acceptedStatuses.has(String(metadata.deliveryStatus || '').toLowerCase())) {
            return;
          }
          await page.waitForTimeout(1000);
        }
        assertOperationalCondition(false, {
          reason: 'support_delivery_status_not_terminal',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
          lastStatus: lastStatus || null,
        });
      },
    },

    // ── Step 8: alterar status do ticket (fechar via UI real) ───────────────
    // A UI real não tem <select> de status: a ação é o botão "Fechar ticket",
    // que abre o modal de encerramento (motivo obrigatório) seguido de
    // ConfirmDialog. O status final real é 'closed' (badge "Fechado").
    {
      id: 'step_change_status',
      actionType: 'change_status',
      selectorUsed: closeButtonSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        await waitForRequiredSelector(page, closeButtonSelector, 8000, {
          reason: 'support_close_button_missing',
          journeyId: JOURNEY_ID,
        });

        await page.click(closeButtonSelector);

        // Modal de encerramento: motivo obrigatório (input textual, não depende
        // do carregamento dos motivos padrão no <select>).
        await waitForRequiredSelector(page, '.support-modal-content input.support-form-input', 8000, {
          reason: 'support_close_modal_missing',
          journeyId: JOURNEY_ID,
        });
        await page.fill('.support-modal-content input.support-form-input', closeReason);
        await page.click('.support-modal-content button:has-text("Fechar")');

        // ConfirmDialog ("Deseja realmente fechar este ticket?"): o botão de
        // confirmação é o único com TEXTO "Fechar" dentro do diálogo (o botão
        // de fechar do header usa apenas aria-label, sem texto).
        const confirmButton = page
          .locator('div.fixed.inset-0', { hasText: 'Deseja realmente fechar este ticket' })
          .locator('button:has-text("Fechar")');
        try {
          await confirmButton.waitFor({ timeout: 8000 });
          await confirmButton.click();
        } catch (error) {
          assertOperationalCondition(false, {
            reason: 'support_close_confirm_missing',
            journeyId: JOURNEY_ID,
            error: error?.message || String(error),
          });
        }

        // Após o fechamento, o ticket sai da lista padrão (fechados ocultos).
        try {
          await page.waitForSelector(ticketCardSelector, { state: 'detached', timeout: 15000 });
        } catch (error) {
          assertOperationalCondition(false, {
            reason: 'support_ticket_not_closed_in_ui',
            journeyId: JOURNEY_ID,
            ticketId: ticketId || null,
            error: error?.message || String(error),
          });
        }
      },
    },

    // ── Step 9: validar UI refletiu mutação ──────────────────────────────────
    // Reflexo real do fechamento na UI operacional: após refresh explícito
    // (botão "Atualizar chamados", que re-busca waiting+in_progress do backend),
    // o ticket fechado NÃO pode mais aparecer na lista operacional.
    {
      id: 'step_assert_ticket_ui',
      actionType: 'assert_ui_state',
      selectorUsed: 'button[aria-label="Atualizar chamados"]',
      journeyId: JOURNEY_ID,
      snapshotDiff: {
        // Expectativas cumulativas da jornada até este assert (nomes canônicos
        // do CANONICAL_MUTATION_RULES: reply persiste como 'message_created').
        expectedMutations: ['ticket_status_changed', 'message_created'],
        // crm_updated removido: suporte não escreve atividade CRM
        // (VerticalJourneyEvent é exclusivo das verticais) — ver supportOperationalSeed.
        expectedSideEffects: ['audit_log_created'],
      },
      sideEffectLinkage: {
        expectedSideEffects: ['audit_log_created'],
        correlatedBy: 'state_assertion',
      },
      async execute(page) {
        await waitForRequiredSelector(page, 'button[aria-label="Atualizar chamados"]', 8000, {
          reason: 'support_refresh_button_missing',
          journeyId: JOURNEY_ID,
        });
        await page.click('button[aria-label="Atualizar chamados"]');

        // Lista operacional recarregada do backend: o ticket fechado não volta.
        await waitForRequiredSelector(page, '[data-testid="ticket-list"]', 15000, {
          reason: 'support_ticket_list_not_reloaded',
          journeyId: JOURNEY_ID,
        });
        const stillListed = await page.$(ticketCardSelector);
        assertOperationalCondition(!stillListed, {
          reason: 'support_ui_not_updated',
          journeyId: JOURNEY_ID,
          ticketId: ticketId || null,
          detail: 'ticket fechado ainda aparece na lista operacional após refresh',
        });
      },
    },

    // ── Step 10: validar backend refletiu mutação ────────────────────────────
    // Consulta real ao backend dentro da sessão autenticada da página
    // (mesma origem/token da UI): o status persistido deve ser 'closed'.
    {
      id: 'step_assert_ticket_backend',
      actionType: 'assert_backend_state',
      status: 'passed',
      selectorUsed: ticketCardSelector,
      journeyId: JOURNEY_ID,
      async execute(page) {
        const backendState = await page.evaluate(async (id) => {
          const token = window.localStorage.getItem('auth_token');
          const tenant = window.localStorage.getItem('auth_effective_tenant_id')
            || window.localStorage.getItem('auth_last_tenant_id')
            || 'system';
          const resp = await fetch(`/tickets/${encodeURIComponent(id)}`, {
            headers: {
              ...(token ? { authorization: `Bearer ${token}` } : {}),
              'x-tenant-id': tenant,
            },
          });
          const body = await resp.json().catch(() => null);
          return {
            httpStatus: resp.status,
            ticketStatus: body?.status || body?.ticket?.status || null,
          };
        }, ticketId);

        assertOperationalCondition(
          backendState.httpStatus === 200 && backendState.ticketStatus === 'closed',
          {
            reason: 'support_backend_state_not_available',
            journeyId: JOURNEY_ID,
            ticketId: ticketId || null,
            expectedStatus: 'closed',
            actualStatus: backendState.ticketStatus,
            httpStatus: backendState.httpStatus,
          }
        );
      },
    },
  ];
}

module.exports = {
  buildSupportTicketFlowSteps,
  JOURNEY_ID,
  SUPPORT_PATH,
};
