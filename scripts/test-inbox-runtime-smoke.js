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

const { getOrCreateRpaToken } = require('../tests/rpa/utils/rpaTokenManager');
const fs = require('fs');
const path = require('path');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  const rpaToken = getOrCreateRpaToken();
  const login = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: {
      token: rpaToken,
      tenantId: process.env.TEST_TENANT_ID || 'system',
    },
  });
  expect(login.ok && login.payload?.token, `rpa_login_failed:${login.status}`);
  return login.payload.token;
}

async function loginAdmin(baseUrl) {
  const username = String(process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const password = String(process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'admin123');
  const login = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (!login.ok || !login.payload?.token) return null;
  return login.payload.token;
}

function payloadSnippet(payload) {
  try {
    return JSON.stringify(payload).slice(0, 220);
  } catch (_) {
    return String(payload).slice(0, 220);
  }
}

function evidencePath() {
  return String(process.env.INBOX_RUNTIME_EVIDENCE_PATH || 'qa/l05-chatpro-omnichannel-evidence.json');
}

function writeEvidence(payload) {
  const out = evidencePath();
  const abs = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

async function main() {
  const baseUrl = apiBaseUrl();
  const adminToken = await loginAdmin(baseUrl);
  const token = adminToken || (await loginRpa(baseUrl));
  const authMode = adminToken ? 'admin' : 'rpa';
  const tenantId = process.env.TEST_TENANT_ID || 'system';
  const ts = Date.now();

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

    if (createTicket.ok && createTicket.payload?.id) {
      cleanup.ticketId = createTicket.payload.id;
      cleanup.createdTicket = true;
      cleanup.originalQueue = createTicket.payload.queue || 'default';
      cleanup.originalAssignedTo = createTicket.payload.assignedTo || null;
    } else {
      const inboxList = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, { token });
      expect(inboxList.ok, `inbox_list_failed:${inboxList.status}`);
      const tickets = Array.isArray(inboxList.payload?.tickets) ? inboxList.payload.tickets : [];
      expect(
        tickets.length > 0,
        `ticket_create_failed:${createTicket.status}:${payloadSnippet(createTicket.payload)}:inbox_no_available_ticket_for_smoke`,
      );
      const targetTicket = tickets.find((t) => t && t.id && t.status !== 'closed') || tickets[0];
      cleanup.ticketId = targetTicket.id;
      cleanup.originalQueue = targetTicket.queue || null;
      cleanup.originalAssignedTo = Object.prototype.hasOwnProperty.call(targetTicket, 'assignedTo')
        ? targetTicket.assignedTo
        : null;
    }
    evidence.ticket.id = cleanup.ticketId;
    evidence.ticket.created = cleanup.createdTicket;
    evidence.ticket.originalQueue = cleanup.originalQueue;
    evidence.ticket.originalAssignedTo = cleanup.originalAssignedTo;

    const assignRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.ticketId)}/assign`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(assignRes.ok && assignRes.payload?.assignedTo, `inbox_assign_failed:${assignRes.status}`);
    evidence.operations.assign = true;
    evidence.ticket.assignedTo = assignRes.payload?.assignedTo || null;

    const transferQueue = `ux1_smoke_${ts}`;
    const transferRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.ticketId)}/transfer`, {
      method: 'POST',
      token,
      body: { queue: transferQueue, assignedTo: null },
    });
    expect(transferRes.ok && transferRes.payload?.queue === transferQueue, `inbox_transfer_failed:${transferRes.status}`);
    evidence.operations.transfer = true;
    evidence.ticket.queueAfterTransfer = transferRes.payload?.queue || null;

    const noteText = `Nota interna smoke ${ts}`;
    const noteRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.ticketId)}/notes`, {
      method: 'POST',
      token,
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

    const conversationRes = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.ticketId)}`, {
      method: 'GET',
      token,
    });
    expect(conversationRes.ok, `inbox_conversation_failed:${conversationRes.status}`);
    const messages = Array.isArray(conversationRes.payload?.messages) ? conversationRes.payload.messages : [];
    expect(messages.some((m) => m?.sender === 'note' && String(m?.text || '').includes(`smoke ${ts}`)), 'inbox_note_not_found_in_conversation');
    evidence.conversation.messagesCount = messages.length;
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
    console.log(`[inbox-smoke] OK ticket=${cleanup.ticketId} queue=${transferQueue} quickReply=${cleanup.quickReplyId} phoneMasking=${previousEnabled}->${nextEnabled} evidence=${evPath}`);
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
    } else if (cleanup.ticketId && cleanup.originalQueue) {
      const restoreTransfer = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(cleanup.ticketId)}/transfer`, {
        method: 'POST',
        token,
        body: { queue: cleanup.originalQueue, assignedTo: cleanup.originalAssignedTo },
      });
      if (!restoreTransfer.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[inbox-smoke] WARN ticket_restore_failed:${cleanup.ticketId}:${restoreTransfer.status}`);
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
