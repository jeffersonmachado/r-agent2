#!/usr/bin/env node
'use strict';

/**
 * Smoke do fluxo Inbox/Support/TicketMaintenance.
 *
 * Valida:
 * - autenticação RPA
 * - criação de ticket manual
 * - listagem do inbox + detalhe de conversa
 * - assign / transfer / note
 * - tags (add/remove)
 * - quick replies (create/use/delete)
 * - setting phone-masking (get/update/restore)
 */

const { getOrCreateRpaToken } = require('../core/rpa/utils/rpaTokenManager');
const fs = require('fs');
const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

// Tenant default do smoke: STRICT_TENANT_MODE exige X-Tenant-Id explícito
// para super_admin; definido após o login e aplicado a todas as chamadas.
let smokeTenantId = null;

async function reqJson(url, { method = 'GET', token = null, body = null, tenantId = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const effectiveTenantId = tenantId || smokeTenantId;
  if (effectiveTenantId) headers['X-Tenant-Id'] = String(effectiveTenantId);
  const timeoutMs = Math.max(3000, Number(process.env.L05_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.L05_HTTP_RETRIES || 2));
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: body == null ? undefined : JSON.stringify(body),
      });
      const txt = await res.text().catch(() => '');
      let payload = {};
      try {
        payload = txt ? JSON.parse(txt) : {};
      } catch (_) {
        payload = { raw: txt };
      }
      clearTimeout(timeout);
      return { ok: res.ok, status: res.status, payload };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < retries) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(250 * attempt);
      }
    }
  }
  throw lastErr || new Error('request_failed');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginRpa(baseUrl) {
  const tenantId = String(process.env.TEST_TENANT_ID || 'system').trim() || 'system';
  const rpaToken = getOrCreateRpaToken();
  const login = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: {
      token: rpaToken,
      tenantId,
    },
  });
  expect(login.ok && login.payload?.token, `rpa_login_failed:${login.status}`);
  return {
    token: login.payload.token,
    tenantId: String(login.payload?.agent?.tenantId || tenantId),
    authMode: 'rpa',
  };
}

async function loginAdmin(baseUrl) {
  const username = String(
    process.env.TEST_SUPERADMIN_USERNAME
    || process.env.TEST_USERNAME
    || process.env.TEST_ADMIN_USERNAME
    || process.env.TEST_USER_USERNAME
    || 'systemadmin'
  );
  const password = String(
    process.env.TEST_SUPERADMIN_PASSWORD
    || process.env.TEST_PASSWORD
    || process.env.TEST_ADMIN_PASSWORD
    || process.env.TEST_USER_PASSWORD
    || 'Admin123!'
  );
  const login = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (!login.ok || !login.payload?.token) return null;
  return {
    token: login.payload.token,
    tenantId: String(login.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system'),
    authMode: 'admin',
  };
}

async function resolveOperationalTenantId(baseUrl, token, fallbackTenantId) {
  const explicitTenant = String(process.env.TEST_TENANT_ID || '').trim();
  if (explicitTenant && explicitTenant.toLowerCase() !== 'system') {
    return explicitTenant;
  }

  const tenants = await reqJson(`${baseUrl}/super-admin/tenants`, {
    method: 'GET',
    token,
  });
  if (tenants.ok && Array.isArray(tenants.payload?.tenants)) {
    const candidate = tenants.payload.tenants.find((tenant) => {
      const id = String(tenant?.id || '').trim();
      return id && id.toLowerCase() !== 'system';
    });
    if (candidate?.id) return String(candidate.id);
  }

  return String(fallbackTenantId || 'system');
}

function buildWhatsAppWebhookPayload({ phoneNumber, messageText, phoneNumberId }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: `inbox-smoke-${Date.now()}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: phoneNumber,
            phone_number_id: phoneNumberId,
          },
          contacts: [{
            profile: { name: 'QA Inbox Smoke' },
            wa_id: phoneNumber,
          }],
          messages: [{
            from: phoneNumber,
            id: `wamid.inbox_smoke_${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: messageText },
          }],
        },
      }],
    }],
  };
}

function payloadSnippet(payload) {
  try {
    return JSON.stringify(payload).slice(0, 220);
  } catch (_) {
    return String(payload).slice(0, 220);
  }
}

function evidencePath() {
  return resolveWorkspacePath(
    ROOT,
    runtimeAwarePath(ROOT, 'qa/l05-chatpro-omnichannel-evidence.json', 'INBOX_RUNTIME_EVIDENCE_PATH'),
  );
}

function writeEvidence(payload) {
  const out = evidencePath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

async function main() {
  const baseUrl = apiBaseUrl();
  const adminAuth = await loginAdmin(baseUrl);
  const fallbackRpaAuth = async () => loginRpa(baseUrl);

  let auth = adminAuth;
  if (auth?.token) {
    const operationalTenantId = await resolveOperationalTenantId(baseUrl, auth.token, auth.tenantId);
    if (operationalTenantId && operationalTenantId !== auth.tenantId) {
      const rpaToken = getOrCreateRpaToken();
      const scopedRpa = await reqJson(`${baseUrl}/auth/rpa/login`, {
        method: 'POST',
        body: { token: rpaToken, tenantId: operationalTenantId },
      });
      if (scopedRpa.ok && scopedRpa.payload?.token) {
        auth = {
          token: scopedRpa.payload.token,
          tenantId: String(scopedRpa.payload?.agent?.tenantId || operationalTenantId),
          authMode: 'rpa_scoped',
        };
      }
    }
  } else {
    auth = await fallbackRpaAuth();
  }

  const token = auth.token;
  const authMode = auth.authMode;
  const tenantId = auth.tenantId;
  smokeTenantId = tenantId || null;
  const ts = Date.now();

  // Parte de conversas do Inbox: o seed via webhook cria a conversa no tenant
  // 'system' (channel account do ambiente QA), então as chamadas de conversa
  // usam esse tenant explicitamente — independente do tenant operacional usado
  // na parte de tickets.
  const CONVERSATION_TENANT_ID = 'system';
  let conversationToken = adminAuth?.token || token;
  if (!adminAuth?.token && tenantId !== CONVERSATION_TENANT_ID) {
    const sysRpa = await reqJson(`${baseUrl}/auth/rpa/login`, {
      method: 'POST',
      body: { token: getOrCreateRpaToken(), tenantId: CONVERSATION_TENANT_ID },
    });
    if (sysRpa.ok && sysRpa.payload?.token) {
      conversationToken = sysRpa.payload.token;
    }
  }

  const evidence = {
    smoke: 'L-05',
    generatedAt: new Date().toISOString(),
    ok: false,
    authMode,
    tenantId,
    ticket: {
      id: null,
      created: false,
      assignedTo: null,
      queueAfterTransfer: null,
      originalQueue: null,
      originalAssignedTo: null,
    },
    conversation: {
      id: null,
      created: false,
      assignedTo: null,
      noteFound: false,
      messagesCount: 0,
    },
    operations: {
      assign: false,
      transfer: false,
      note: false,
      addTag: false,
      removeTag: false,
      quickReplyCreate: false,
      quickReplyUse: false,
      quickReplyList: false,
      phoneMaskingToggle: 'not_attempted',
    },
    warnings: [],
  };

  const cleanup = {
    ticketId: null,
    createdTicket: false,
    conversationId: null,
    conversationOriginalAssignedTo: null,
    quickReplyId: null,
    originalMasking: null,
    originalQueue: null,
    originalAssignedTo: null,
  };

  try {
    const phoneNumber = `55119${String(ts).slice(-8)}`;
    const createTicket = await reqJson(`${baseUrl}/tickets`, {
      method: 'POST',
      token,
      body: {
        phoneNumber,
        queue: 'default',
        initialMessage: `smoke inbox ${ts}`,
      },
    });

    expect(
      createTicket.ok && createTicket.payload?.id,
      `ticket_create_failed:${createTicket.status}:${payloadSnippet(createTicket.payload)}`,
    );
    cleanup.ticketId = createTicket.payload.id;
    cleanup.createdTicket = true;
    cleanup.originalQueue = createTicket.payload.queue || 'default';
    cleanup.originalAssignedTo = createTicket.payload.assignedTo || null;
    evidence.ticket.id = cleanup.ticketId;
    evidence.ticket.created = cleanup.createdTicket;
    evidence.ticket.originalQueue = cleanup.originalQueue;
    evidence.ticket.originalAssignedTo = cleanup.originalAssignedTo;

    // --- Conversa do Inbox (desacoplado de tickets) ---
    // Fixture: seed via webhook WhatsApp (mesmo caminho que cria conversas em
    // produção); fallback para conversa existente da listagem do tenant.
    const convPhone = `55118${String(ts).slice(-8)}`;
    const waPhoneNumberId = String(process.env.TEST_WHATSAPP_PHONE_NUMBER_ID || 'test_phone_id');
    const seedWebhook = await reqJson(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      body: buildWhatsAppWebhookPayload({
        phoneNumber: convPhone,
        messageText: `smoke inbox conversa ${ts}`,
        phoneNumberId: waPhoneNumberId,
      }),
    });
    if (!seedWebhook.ok) {
      evidence.warnings.push(`conversation_seed_webhook_failed:${seedWebhook.status}`);
    }

    let conversation = null;
    const convReq = { token: conversationToken, tenantId: CONVERSATION_TENANT_ID };
    for (let attempt = 0; attempt < 6 && !conversation; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const inboxPoll = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, convReq).catch(() => null);
      const polled = Array.isArray(inboxPoll?.payload?.conversations) ? inboxPoll.payload.conversations : [];
      conversation = polled.find((c) => c && String(c.externalId || '') === convPhone) || null;
      if (!conversation) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(400);
      }
    }
    if (!conversation) {
      const inboxList = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, convReq);
      expect(inboxList.ok, `inbox_list_failed:${inboxList.status}`);
      const conversations = Array.isArray(inboxList.payload?.conversations) ? inboxList.payload.conversations : [];
      conversation = conversations.find((c) => c && c.id && c.status !== 'closed' && !c.currentTicketId)
        || conversations.find((c) => c && c.id && c.status !== 'closed')
        || null;
      if (conversation) {
        evidence.warnings.push('conversation_seed_fallback_existing_conversation');
      }
    }
    expect(conversation && conversation.id, 'inbox_no_available_conversation_for_smoke');
    cleanup.conversationId = String(conversation.id);
    cleanup.conversationOriginalAssignedTo = Object.prototype.hasOwnProperty.call(conversation, 'assignedTo')
      ? conversation.assignedTo
      : null;
    evidence.conversation.id = cleanup.conversationId;
    evidence.conversation.created = String(conversation.externalId || '') === convPhone;

    const assignRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.conversationId)}/assign`, {
      method: 'POST',
      ...convReq,
      body: {},
    });
    expect(assignRes.ok && assignRes.payload?.conversation?.assignedTo, `inbox_assign_failed:${assignRes.status}`);
    evidence.operations.assign = true;
    evidence.conversation.assignedTo = assignRes.payload.conversation.assignedTo || null;

    // Listagem deve refletir o assignedTo da conversa.
    const listAfterAssign = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, convReq);
    expect(listAfterAssign.ok, `inbox_list_after_assign_failed:${listAfterAssign.status}`);
    const listedAfterAssign = (Array.isArray(listAfterAssign.payload?.conversations) ? listAfterAssign.payload.conversations : [])
      .find((c) => c && String(c.id) === cleanup.conversationId);
    expect(
      listedAfterAssign && listedAfterAssign.assignedTo === evidence.conversation.assignedTo,
      'inbox_list_assigned_to_mismatch',
    );

    const transferQueue = `ux1_smoke_${ts}`;
    const transferRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.conversationId)}/transfer`, {
      method: 'POST',
      ...convReq,
      body: { queue: transferQueue, assignedTo: null },
    });
    expect(transferRes.ok && transferRes.payload?.conversation, `inbox_transfer_failed:${transferRes.status}`);
    evidence.operations.transfer = true;

    const noteText = `Nota interna smoke ${ts}`;
    const noteRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.conversationId)}/notes`, {
      method: 'POST',
      ...convReq,
      body: { note: noteText },
    });
    expect(noteRes.ok, `inbox_note_failed:${noteRes.status}`);
    evidence.operations.note = true;

    const addTagRes = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(cleanup.ticketId)}/tags`, {
      method: 'POST',
      token,
      body: { tag: 'smoke-ux01' },
    });
    expect(addTagRes.ok && Array.isArray(addTagRes.payload?.tags) && addTagRes.payload.tags.includes('smoke-ux01'), `ticket_tag_add_failed:${addTagRes.status}`);
    evidence.operations.addTag = true;

    const removeTagRes = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(cleanup.ticketId)}/tags/smoke-ux01`, {
      method: 'DELETE',
      token,
    });
    expect(removeTagRes.ok, `ticket_tag_remove_failed:${removeTagRes.status}`);
    evidence.operations.removeTag = true;

    const conversationRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.conversationId)}`, {
      method: 'GET',
      ...convReq,
    });
    expect(conversationRes.ok, `inbox_conversation_failed:${conversationRes.status}`);
    const convPayload = conversationRes.payload?.conversation || {};
    const convMessages = Array.isArray(conversationRes.payload?.messages) ? conversationRes.payload.messages : [];
    // Notas são first-class no GET da conversa (metadata.notes da conversa sem
    // ticket + ledger do ticket quando há currentTicketId).
    const apiNotes = Array.isArray(conversationRes.payload?.notes)
      ? conversationRes.payload.notes
      : (Array.isArray(convPayload?.metadata?.notes) ? convPayload.metadata.notes : []);
    let noteVisible = apiNotes.some((n) => String(n?.note || n?.text || '').includes(`smoke ${ts}`));
    if (!noteVisible && convPayload.currentTicketId) {
      // Compat: conversa com ticket grava a nota no ledger do ticket (sender 'note').
      const ticketDetail = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(convPayload.currentTicketId)}`, {
        method: 'GET',
        ...convReq,
      });
      const ticketPayload = ticketDetail?.payload?.ticket || ticketDetail?.payload || {};
      const ticketMessages = Array.isArray(ticketPayload?.messages) ? ticketPayload.messages : [];
      noteVisible = ticketMessages.some((m) => m?.sender === 'note' && String(m?.text || '').includes(`smoke ${ts}`));
    }
    expect(noteVisible, 'inbox_note_not_found_in_conversation');
    evidence.conversation.messagesCount = convMessages.length;
    evidence.conversation.noteFound = true;

    const createQrRes = await reqJson(`${baseUrl}/quick-replies`, {
      method: 'POST',
      token,
      body: {
        title: `UX01 Smoke ${ts}`,
        message: `Mensagem rápida smoke ${ts}`,
        tags: ['smoke', 'ux01'],
        category: 'smoke',
      },
    });
    expect(createQrRes.ok && createQrRes.payload?.id, `quick_reply_create_failed:${createQrRes.status}`);
    cleanup.quickReplyId = createQrRes.payload.id;
    evidence.operations.quickReplyCreate = true;

    const useQrRes = await reqJson(`${baseUrl}/quick-replies/${encodeURIComponent(cleanup.quickReplyId)}/use`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(useQrRes.ok, `quick_reply_use_failed:${useQrRes.status}`);
    evidence.operations.quickReplyUse = true;

    const listQrRes = await reqJson(`${baseUrl}/quick-replies?search=${encodeURIComponent(`UX01 Smoke ${ts}`)}`, {
      method: 'GET',
      token,
    });
    expect(listQrRes.ok, `quick_reply_list_failed:${listQrRes.status}`);
    const quickReplies = Array.isArray(listQrRes.payload?.quickReplies) ? listQrRes.payload.quickReplies : [];
    expect(quickReplies.some((item) => item?.id === cleanup.quickReplyId), 'quick_reply_not_listed');
    evidence.operations.quickReplyList = true;

    const getMaskingRes = await reqJson(`${baseUrl}/api/tenant-settings/phone-masking`, {
      method: 'GET',
      token,
    });
    expect(getMaskingRes.ok && getMaskingRes.payload?.ok === true, `phone_masking_get_failed:${getMaskingRes.status}`);
    const previousEnabled = !!(getMaskingRes.payload?.value && getMaskingRes.payload.value.enabled);
    cleanup.originalMasking = { enabled: previousEnabled };

    const nextEnabled = !previousEnabled;
    const setMaskingRes = await reqJson(`${baseUrl}/api/tenant-settings/phone-masking`, {
      method: 'POST',
      token,
      body: { value: { enabled: nextEnabled } },
    });
    const maskingUnavailable = setMaskingRes.status === 503
      || setMaskingRes.payload?.error === 'service_unavailable';
    if (maskingUnavailable) {
      // eslint-disable-next-line no-console
      console.warn(`[inbox-smoke] WARN phone_masking_unavailable:${setMaskingRes.status}`);
      evidence.operations.phoneMaskingToggle = 'unavailable';
      evidence.warnings.push(`phone_masking_unavailable:${setMaskingRes.status}`);
    } else {
      expect(setMaskingRes.ok && setMaskingRes.payload?.ok === true, `phone_masking_set_failed:${setMaskingRes.status}`);

      const verifyMaskingRes = await reqJson(`${baseUrl}/api/tenant-settings/phone-masking`, {
        method: 'GET',
        token,
      });
      expect(verifyMaskingRes.ok && verifyMaskingRes.payload?.value?.enabled === nextEnabled, `phone_masking_verify_failed:${verifyMaskingRes.status}`);
      evidence.operations.phoneMaskingToggle = `${previousEnabled}->${nextEnabled}`;
    }

    evidence.ok = true;
    const evPath = writeEvidence(evidence);

    // eslint-disable-next-line no-console
    console.log(`[inbox-smoke] OK ticket=${cleanup.ticketId} conversation=${cleanup.conversationId} queue=${transferQueue} quickReply=${cleanup.quickReplyId} phoneMasking=${previousEnabled}->${nextEnabled} evidence=${evPath}`);
  } finally {
    if (cleanup.quickReplyId) {
      const qrDelete = await reqJson(`${baseUrl}/quick-replies/${encodeURIComponent(cleanup.quickReplyId)}`, {
        method: 'DELETE',
        token,
      });
      if (!qrDelete.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[inbox-smoke] WARN quick_reply_cleanup_failed:${cleanup.quickReplyId}:${qrDelete.status}`);
      }
    }

    if (cleanup.ticketId && cleanup.createdTicket) {
      const closeRes = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(cleanup.ticketId)}/close`, {
        method: 'POST',
        token,
        body: { closeReasonName: 'Smoke test UX-01' },
      });
      if (!closeRes.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[inbox-smoke] WARN ticket_cleanup_failed:${cleanup.ticketId}:${closeRes.status}`);
      }
    }

    if (cleanup.conversationId && cleanup.conversationOriginalAssignedTo) {
      const restoreAssign = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.conversationId)}/assign`, {
        method: 'POST',
        token: conversationToken,
        tenantId: CONVERSATION_TENANT_ID,
        body: { assigneeId: cleanup.conversationOriginalAssignedTo },
      });
      if (!restoreAssign.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[inbox-smoke] WARN conversation_restore_failed:${cleanup.conversationId}:${restoreAssign.status}`);
      }
    }

    if (cleanup.originalMasking) {
      const restoreRes = await reqJson(`${baseUrl}/api/tenant-settings/phone-masking`, {
        method: 'POST',
        token,
        body: { value: cleanup.originalMasking },
      });
      if (!restoreRes.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[inbox-smoke] WARN phone_masking_restore_failed:${restoreRes.status}`);
      }
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    try {
      const out = writeEvidence({
        smoke: 'L-05',
        generatedAt: new Date().toISOString(),
        ok: false,
        error: err?.message || String(err),
      });
      // eslint-disable-next-line no-console
      console.error(`[inbox-smoke] evidence=${out}`);
    } catch (_) {}
    // eslint-disable-next-line no-console
    console.error('[inbox-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
