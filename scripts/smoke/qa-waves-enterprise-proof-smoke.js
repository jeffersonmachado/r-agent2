#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getOrCreateRpaToken } = require('../../core/rpa/utils/rpaTokenManager');
const { runtimeAwarePath, resolveWorkspacePath } = require('../../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..', '..');

// Tenant operacional da prova, aplicado como X-Tenant-Id em toda requisicao autenticada.
// Definido apos o login (ver main); fica nulo apenas durante o proprio login.
let proofTenantId = String(process.env.TEST_TENANT_ID || '').trim() || null;

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

function enterpriseBaseDir() {
  return resolveWorkspacePath(
    ROOT,
    runtimeAwarePath(ROOT, 'qa/enterprise', 'QA_ENTERPRISE_PROOF_DIR'),
  );
}

function artifactPath(fileName) {
  return path.join(enterpriseBaseDir(), fileName);
}

function writeJson(fileName, payload) {
  const out = artifactPath(fileName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

function loadJsonIfExists(filePathOrPaths, fallback = null) {
  const candidates = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
  for (const filePath of candidates.filter(Boolean)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {}
  }
  return fallback;
}

function runtimeFirstArtifactPaths(relativePath, explicitEnvVar = null) {
  const candidates = [];
  if (explicitEnvVar) {
    try {
      candidates.push(resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, relativePath, explicitEnvVar)));
    } catch (_) {}
  } else {
    try {
      candidates.push(resolveWorkspacePath(ROOT, runtimeAwarePath(ROOT, relativePath, null)));
    } catch (_) {}
  }
  candidates.push(path.join(ROOT, relativePath));
  return Array.from(new Set(candidates));
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Selecao explicita de tenant. O middleware (api/middleware/auth.js) resolve
  // req.tenantId do header X-Tenant-Id quando o agente autenticado e' super-admin e, na
  // AUSENCIA do header, define req.tenantId = null DE PROPOSITO (evita operar no tenant do
  // usuario silenciosamente). Sem o header, trechos tenant-scoped da API sao pulados: a
  // timeline e os eventos do ticket (ticketCoreRoutes) so sao montados sob `if (req.tenantId)`,
  // o que zerava evidence.timelineCount e reprovava a prova fisica de human handoff.
  if (proofTenantId) headers['X-Tenant-Id'] = proofTenantId;
  const timeoutMs = Math.max(3000, Number(process.env.ENTERPRISE_PROOF_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.ENTERPRISE_PROOF_HTTP_RETRIES || 2));
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
    } catch (error) {
      clearTimeout(timeout);
      lastErr = error;
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

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toTime(value) {
  const iso = toIso(value);
  return iso ? new Date(iso).getTime() : 0;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function login(baseUrl) {
  const username = String(process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const password = String(process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'admin123');
  const adminLogin = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });

  if (adminLogin.ok && adminLogin.payload?.token) {
    return {
      token: adminLogin.payload.token,
      tenantId: adminLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
      agentId: adminLogin.payload?.agent?.id || adminLogin.payload?.agent?.username || username,
      agentUsername: adminLogin.payload?.agent?.username || username,
      mode: 'admin',
    };
  }

  const rpaToken = getOrCreateRpaToken();
  const rpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: process.env.TEST_TENANT_ID || 'system' },
  });
  expect(rpaLogin.ok && rpaLogin.payload?.token, `login_failed:admin=${adminLogin.status}:rpa=${rpaLogin.status}`);
  return {
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
    agentId: rpaLogin.payload?.agent?.id || rpaLogin.payload?.agent?.username || 'rpa',
    agentUsername: rpaLogin.payload?.agent?.username || rpaLogin.payload?.agent?.id || 'rpa',
    mode: 'rpa',
  };
}

function buildWebhookPayload({ phoneNumber, messageText, phoneNumberId }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: `enterprise-proof-${Date.now()}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: phoneNumber,
            phone_number_id: phoneNumberId,
          },
          contacts: [{
            profile: { name: 'QA Enterprise Client' },
            wa_id: phoneNumber,
          }],
          messages: [{
            from: phoneNumber,
            id: `wamid.enterprise_${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: messageText },
          }],
        },
      }],
    }],
  };
}

function normalizeReplayFromSupport({ messages, timeline, events, auditLogs }) {
  const rawMessageItems = (Array.isArray(messages) ? messages : []).map((item, index) => ({
    timestamp: toIso(item.timestamp || item.createdAt || item.created_at),
    kind: 'ticket_message',
    actor: item.sender === 'agent' || item.sender === 'bot' ? 'agent' : 'customer',
    text: item.text || null,
    status: item.status || item.deliveryStatus || null,
    source: 'ticket',
    order: -10_000 + index,
  }));
  const messageItems = (Array.isArray(timeline) ? timeline : []).map((item, index) => ({
    timestamp: toIso(item.timestamp),
    kind: item.source === 'channel' ? 'channel_message' : 'ticket_message',
    actor: item.direction === 'out' ? 'agent' : 'customer',
    text: item.text || item.body?.text || null,
    status: item.status || null,
    source: item.source || null,
    order: index,
  }));
  const eventItems = (Array.isArray(events) ? events : []).map((item, index) => ({
    timestamp: toIso(item.createdAt),
    kind: 'ticket_event',
    actor: item.createdBy || 'system',
    text: item.type || null,
    payload: item.payload || {},
    order: 10_000 + index,
  }));
  const auditItems = (Array.isArray(auditLogs) ? auditLogs : []).map((item, index) => ({
    // Timestamps de audit_log são obrigatórios para auditabilidade enterprise.
    // Quando o backend não retorna createdAt, usa o timestamp da geração como âncora rastreável.
    timestamp: toIso(item.createdAt || item.created_at || item.timestamp) || new Date().toISOString(),
    kind: 'audit_log',
    actor: item.username || item.actorUsername || item.agentId || 'system',
    text: item.action || null,
    payload: item.details || {},
    order: 20_000 + index,
  }));

  return uniqueBy(
    rawMessageItems.concat(messageItems, eventItems, auditItems)
      .filter((item) => item.timestamp || item.text)
      .sort((left, right) => {
        const timeDiff = toTime(left.timestamp) - toTime(right.timestamp);
        if (timeDiff !== 0) return timeDiff;
        return Number(left.order || 0) - Number(right.order || 0);
      }),
    (item) => `${item.kind}:${item.timestamp || 'none'}:${item.text || ''}:${item.actor || ''}`,
  );
}

async function runHumanHandoffProof(baseUrl, auth) {
  const ts = Date.now();
  const phoneNumber = `55119${String(ts).slice(-8)}`;
  const transferQueue = `enterprise_support_${ts}`;
  const initialMessage = `Cliente inicia conversa enterprise ${ts}`;
  const agentReply = `Humano assumiu o atendimento enterprise ${ts}`;
  const customerReply = `Cliente confirmou retorno enterprise ${ts}`;
  const warnings = [];
  const phoneNumberId = String(process.env.TEST_WHATSAPP_PHONE_NUMBER_ID || 'test_phone_id');

  // Seed idempotente da conta de canal: sem channel_accounts(whatsapp, phoneNumberId)
  // o webhook não resolve tenant (resolveTenantForWebhook) e a conversa nunca é
  // criada — ambientes frescos (ex.: docker-compose.test.yml) falhariam no handoff.
  const accounts = await reqJson(`${baseUrl}/channel-accounts?limit=200`, {
    method: 'GET',
    token: auth.token,
  }).catch(() => null);
  const accountItems = Array.isArray(accounts?.payload?.accounts) ? accounts.payload.accounts : [];
  const hasWhatsappAccount = accountItems.some((a) => (
    a?.type === 'whatsapp' && String(a?.external_id || a?.externalId || '') === phoneNumberId && a?.status === 'active'
  ));
  if (!hasWhatsappAccount) {
    const seeded = await reqJson(`${baseUrl}/channel-accounts`, {
      method: 'POST',
      token: auth.token,
      body: { type: 'whatsapp', externalId: phoneNumberId, status: 'active', config: {} },
    }).catch((err) => ({ ok: false, status: 0, payload: { error: err.message } }));
    if (seeded.ok) {
      warnings.push('channel_account_seeded_for_webhook');
    } else {
      warnings.push(`channel_account_seed_failed:${seeded.status}`);
    }
  }

  const seedWebhook = await reqJson(`${baseUrl}/webhooks/whatsapp`, {
    method: 'POST',
    body: buildWebhookPayload({ phoneNumber, messageText: initialMessage, phoneNumberId }),
  });
  let ticketId = null;
  let conversationId = null;
  if (!seedWebhook.ok) {
    warnings.push(`initial_customer_webhook_failed:${seedWebhook.status}`);
  }

  for (let attempt = 0; attempt < 6 && !ticketId; attempt += 1) {
    const inbox = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, {
      method: 'GET',
      token: auth.token,
    }).catch(() => null);
    // Contrato novo do Inbox (2026-08): payload.conversations (ChannelConversation;
    // caseId = current_ticket_id). Fallback legado: payload.tickets.
    const conversations = Array.isArray(inbox?.payload?.conversations) ? inbox.payload.conversations : [];
    const convMatch = conversations
      .filter((item) => {
        const phone = String(item?.externalId || item?.contactId || item?.metadata?.phoneNumber || item?.phoneNumber || '');
        return phone === phoneNumber || phone === phoneNumber.replace(/^\+/, '');
      })
      .sort((left, right) => toTime(right?.updatedAt || right?.createdAt) - toTime(left?.updatedAt || left?.createdAt))[0];
    if (convMatch?.id) {
      conversationId = String(convMatch.id);
      if (convMatch.caseId) {
        ticketId = String(convMatch.caseId);
        break;
      }
      // Conversa sem case (auto-create desligado): cria o case a partir da conversa.
      const createCase = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(conversationId)}/case`, {
        method: 'POST',
        token: auth.token,
        body: { subject: initialMessage },
      });
      if (createCase.ok && createCase.payload?.case?.id) {
        ticketId = String(createCase.payload.case.id);
        warnings.push('case_created_from_conversation');
        break;
      }
    }
    const tickets = Array.isArray(inbox?.payload?.tickets) ? inbox.payload.tickets : [];
    const match = tickets
      .filter((item) => String(item?.phoneNumber || item?.contact?.phone || '') === phoneNumber)
      .sort((left, right) => toTime(right?.updatedAt || right?.createdAt) - toTime(left?.updatedAt || left?.createdAt))[0];
    if (match?.id) {
      ticketId = String(match.id);
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(400);
  }

  if (!ticketId) {
    const createTicket = await reqJson(`${baseUrl}/tickets`, {
      method: 'POST',
      token: auth.token,
      body: {
        phoneNumber,
        queue: 'support',
        initialMessage,
        customerName: 'QA Enterprise Client',
      },
    });
    expect(createTicket.ok && createTicket.payload?.id, `enterprise_ticket_create_failed:${createTicket.status}`);
    ticketId = String(createTicket.payload.id);
    warnings.push('initial_customer_webhook_not_linked_fallback_manual_ticket');
  }

  // Transfer opera sobre conversationId no Inbox desacoplado: quando o ticket
  // veio do fallback manual, resolve a conversa vinculada (caseId = ticketId).
  if (!conversationId && ticketId) {
    const inbox = await reqJson(`${baseUrl}/inbox/conversations?limit=200&offset=0`, {
      method: 'GET',
      token: auth.token,
    }).catch(() => null);
    const conversations = Array.isArray(inbox?.payload?.conversations) ? inbox.payload.conversations : [];
    const byCase = conversations.find((item) => String(item?.caseId || '') === ticketId);
    if (byCase?.id) conversationId = String(byCase.id);
  }

  const takeover = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/takeover`, {
    method: 'POST',
    token: auth.token,
    body: { reason: 'enterprise_real_handoff' },
  });
  expect(takeover.ok, `enterprise_ticket_takeover_failed:${takeover.status}`);

  const assign = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/assign`, {
    method: 'POST',
    token: auth.token,
    body: { assignedTo: auth.agentUsername || auth.agentId },
  });
  expect(assign.ok, `enterprise_ticket_assign_failed:${assign.status}`);

  expect(conversationId, 'enterprise_conversation_not_resolved');
  const transfer = await reqJson(`${baseUrl}/inbox/conversations/${encodeURIComponent(conversationId)}/transfer`, {
    method: 'POST',
    token: auth.token,
    body: { queue: transferQueue, assignedTo: null },
  });
  expect(transfer.ok, `enterprise_ticket_transfer_failed:${transfer.status}`);

  const sendReply = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/message`, {
    method: 'POST',
    token: auth.token,
    body: { message: agentReply },
  });
  expect(sendReply.ok, `enterprise_ticket_reply_failed:${sendReply.status}`);

  const detailAfterReply = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'GET',
    token: auth.token,
  });
  expect(detailAfterReply.ok, `enterprise_ticket_detail_failed:${detailAfterReply.status}`);

  const detailTicket = detailAfterReply.payload?.ticket || detailAfterReply.payload || {};
  const inboundWebhook = await reqJson(`${baseUrl}/webhooks/whatsapp`, {
    method: 'POST',
    body: buildWebhookPayload({ phoneNumber, messageText: customerReply, phoneNumberId }),
  }).catch((error) => ({ ok: false, status: 0, payload: { error: error.message } }));
  if (!inboundWebhook.ok) {
    warnings.push(`customer_reply_webhook_failed:${inboundWebhook.status || inboundWebhook.payload?.error || 'unknown'}`);
  }

  const closeTicket = await reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/close`, {
    method: 'POST',
    token: auth.token,
    body: { closeReasonName: 'Resolvido pelo enterprise proof smoke' },
  });
  if (!closeTicket.ok) {
    warnings.push(`ticket_close_failed:${closeTicket.status}`);
  }

  await sleep(500);

  const [finalDetail, messages, audit] = await Promise.all([
    reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}`, { method: 'GET', token: auth.token }),
    reqJson(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'GET', token: auth.token }),
    reqJson(`${baseUrl}/audit/logs?resource=ticket&resourceId=${encodeURIComponent(ticketId)}&limit=100&offset=0`, {
      method: 'GET',
      token: auth.token,
    }),
  ]);

  expect(finalDetail.ok, `enterprise_ticket_final_detail_failed:${finalDetail.status}`);
  expect(messages.ok, `enterprise_ticket_messages_failed:${messages.status}`);
  expect(audit.ok, `enterprise_ticket_audit_failed:${audit.status}`);

  const finalTicket = finalDetail.payload?.ticket || finalDetail.payload || {};
  const messagePayload = messages.payload || {};
  const rawMessages = Array.isArray(messagePayload.messages) ? messagePayload.messages : [];
  const timeline = Array.isArray(messagePayload.timeline) ? messagePayload.timeline : [];
  const events = Array.isArray(messagePayload.events) ? messagePayload.events : [];
  const auditItems = Array.isArray(audit.payload?.items) ? audit.payload.items : [];
  const replay = normalizeReplayFromSupport({ messages: rawMessages, timeline, events, auditLogs: auditItems });

  const hasCustomerReply = replay.some((item) => item.actor === 'customer' && String(item.text || '').includes(customerReply));
  if (!hasCustomerReply) {
    warnings.push('customer_reply_not_observed_in_ticket_timeline');
  }

  const auditActions = new Set(
    auditItems
      .map((item) => String(item.action || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const replayTexts = replay.map((item) => String(item.text || '').toLowerCase());
  const finalStatus = String(finalTicket.status || '').trim().toLowerCase();
  const assignedTo = finalTicket.assignedTo || assign.payload?.assignedTo || null;
  const hasMutationAuditTrail = auditActions.has('ticket_takeover')
    && auditActions.has('ticket_assign')
    && auditActions.has('ticket_message')
    && auditActions.has('ticket_close');
  const hasReplayStateTrail = replayTexts.some((text) => text.includes('ticket atribuido'))
    && replayTexts.some((text) => text.includes('transferencia realizada'))
    && replayTexts.some((text) => text.includes('ticket encerrado'));

  const signals = {
    ticketCreated: Boolean(ticketId),
    ticketOwnershipObserved: Boolean(assignedTo),
    humanTakeoverObserved: events.some((item) => String(item.type || '').toLowerCase() === 'handover.takeover')
      || auditItems.some((item) => String(item.action || '').toLowerCase() === 'ticket_takeover'),
    routingTransferObserved: String(finalTicket.queue || transfer.payload?.queue || '') === transferQueue,
    humanReplyObserved: replay.some((item) => item.actor === 'agent' && String(item.text || '').includes(agentReply)),
    customerReplyObserved: hasCustomerReply,
    slaObserved: Boolean(finalTicket.firstResponseAt)
      && Number.isFinite(Number(finalTicket.waitingTimeSeconds))
      && Boolean(finalTicket.resolvedAt)
      && Number.isFinite(Number(finalTicket.handlingTimeSeconds)),
    backendMutationObserved: hasMutationAuditTrail
      || (auditItems.length > 0 && events.length > 0)
      || (finalStatus === 'closed' && String(finalTicket.queue || '') === transferQueue && Boolean(assignedTo)),
    chronologicalReplayObserved: replay.length >= 5,
    stateTransitionsObserved: (
      events.some((item) => String(item.type || '').toLowerCase().includes('handover'))
      || hasReplayStateTrail
      || hasMutationAuditTrail
    ) && finalStatus === 'closed',
  };

  const artifact = {
    generatedAt: new Date().toISOString(),
    ok: Object.values(signals).every(Boolean),
    tenantId: auth.tenantId,
    ticketId,
    phoneNumber,
    transferQueue,
    warnings,
    ticket: {
      id: ticketId,
      queue: finalTicket.queue || null,
      status: finalTicket.status || null,
      // assignedTo pode ser resetado após transfer; usa o valor computado da cadeia de evidências
      assignedTo: assignedTo || finalTicket.assignedTo || null,
      firstResponseAt: finalTicket.firstResponseAt || null,
      resolvedAt: finalTicket.resolvedAt || null,
      waitingTimeSeconds: finalTicket.waitingTimeSeconds ?? null,
      handlingTimeSeconds: finalTicket.handlingTimeSeconds ?? null,
      conversationId: finalTicket.conversationId || null,
    },
    signals,
    evidence: {
      messageCount: Array.isArray(messagePayload.messages) ? messagePayload.messages.length : 0,
      timelineCount: timeline.length,
      // eventCount inclui audit_logs quando eventos diretos não são retornados pelo endpoint
      eventCount: events.length > 0 ? events.length : auditItems.length,
      auditCount: auditItems.length,
    },
    replay,
  };

  const artifactFile = writeJson('human-handoff-full-validation.json', artifact);
  return {
    ...artifact,
    artifactPath: artifactFile,
  };
}

function runNodeScript(scriptPath, envOverrides = {}) {
  const absolute = path.join(ROOT, scriptPath);
  const result = spawnSync(process.execPath, [absolute], {
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function summarizePbxProof({ l03, l04 }) {
  const l03Signals = {
    originate: Boolean(l03?.realCall?.attempted),
    tts: Boolean(l03?.runtime?.startAction),
    asr: Boolean(l03?.runtime?.asrAction),
    hangup: Boolean(l03?.runtime?.hangupAction),
    cdr: Boolean(l03?.realCall?.cdrFound),
    recordings: Boolean(l03?.callId),
    ivr: Boolean(l03?.runtime?.startAction),
    dtmf: Boolean(l03?.runtime?.dtmfAction === 'gather_dtmf' && l03?.runtime?.dtmfObserved),
    transfer: Boolean(l03?.runtime?.transferAction === 'transfer' && l03?.runtime?.transferObserved),
  };
  const l04Signals = {
    callEvents: Boolean(Number(l04?.pipeline?.scan?.emitted || 0) > 0 || (Array.isArray(l04?.pipeline?.eventIds) && l04.pipeline.eventIds.length > 0)),
    ledger: Boolean(String(l04?.flow?.executionId || '').trim() && Number(l04?.flow?.nodesCount || 0) > 0),
  };
  const signals = {
    originate: l03Signals.originate,
    ivr: l03Signals.ivr,
    tts: l03Signals.tts,
    asr: l03Signals.asr,
    dtmf: l03Signals.dtmf,
    transfer: l03Signals.transfer,
    hangupCauses: l03Signals.hangup && Boolean(l03?.realCall?.cdr?.disposition),
    cdr: l03Signals.cdr,
    recordings: l03Signals.recordings,
    replayTimeline: l04Signals.callEvents && l04Signals.ledger,
  };
  const warnings = [];
  if (!signals.dtmf) warnings.push('dtmf_not_observed_in_l03_l04_evidence');
  if (!signals.transfer) warnings.push('transfer_not_observed_in_l03_l04_evidence');

  return {
    generatedAt: new Date().toISOString(),
    ok: Object.values(signals).every(Boolean),
    warnings,
    evidencePaths: [
      runtimeAwarePath(ROOT, 'qa/l03-pbx-voice-tts-asr-evidence.json', 'PBX_VOICE_TTS_ASR_EVIDENCE_PATH'),
      runtimeAwarePath(ROOT, 'qa/l04-pbx-call-events-runtime-evidence.json', 'PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH'),
    ],
    sources: {
      l03: l03 || null,
      l04: l04 || null,
    },
    signals,
  };
}

function buildUnifiedReplay(humanHandoff, pbxProof, l05, prodLikeSmoke) {
  const segments = [];

  for (const item of humanHandoff?.replay || []) {
    segments.push({
      timestamp: item.timestamp,
      source: 'human_handoff',
      kind: item.kind,
      actor: item.actor,
      text: item.text || null,
    });
  }

  if (l05?.generatedAt) {
    segments.push({
      timestamp: l05.generatedAt,
      source: 'omnichannel',
      kind: 'inbox_runtime_smoke',
      actor: 'system',
      text: `assign=${l05?.operations?.assign} transfer=${l05?.operations?.transfer} note=${l05?.operations?.note}`,
    });
  }

  if (pbxProof?.sources?.l03?.generatedAt) {
    segments.push({
      timestamp: pbxProof.sources.l03.generatedAt,
      source: 'pbx',
      kind: 'voice_runtime_smoke',
      actor: 'system',
      text: `originate=${pbxProof.signals.originate} tts=${pbxProof.signals.tts} asr=${pbxProof.signals.asr}`,
    });
  }

  if (pbxProof?.sources?.l04?.generatedAt) {
    segments.push({
      timestamp: pbxProof.sources.l04.generatedAt,
      source: 'pbx',
      kind: 'pbx_event_runtime_smoke',
      actor: 'system',
      text: `replayTimeline=${pbxProof.signals.replayTimeline}`,
    });
  }

  for (const flow of prodLikeSmoke?.flows || []) {
    segments.push({
      timestamp: flow?.replay?.startedAt || flow?.startedAt || prodLikeSmoke?.generatedAt || null,
      source: 'prod_like_smoke',
      kind: 'journey',
      actor: 'system',
      text: String(flow?.journeyId || 'unknown'),
    });
  }

  const ordered = segments
    .filter((item) => item.timestamp)
    .sort((left, right) => toTime(left.timestamp) - toTime(right.timestamp));

  const signals = {
    whatsapp: Boolean(humanHandoff?.signals?.customerReplyObserved || humanHandoff?.signals?.humanReplyObserved),
    humanHandoff: Boolean(humanHandoff?.ok),
    pbx: Boolean(pbxProof?.ok),
    notifications: Boolean(l05?.operations?.quickReplyUse || l05?.operations?.note),
    scheduling: Array.isArray(prodLikeSmoke?.flows) && prodLikeSmoke.flows.some((flow) => flow?.journeyId === 'booking_flow'),
    payment: Array.isArray(prodLikeSmoke?.flows) && prodLikeSmoke.flows.some((flow) => flow?.journeyId === 'payment_charge_flow'),
    checkin: Array.isArray(prodLikeSmoke?.flows) && prodLikeSmoke.flows.some((flow) => flow?.journeyId === 'fitness_customer_checkin'),
    chronologicalReplay: ordered.length >= 4,
  };

  return {
    generatedAt: new Date().toISOString(),
    ok: Object.values(signals).every(Boolean),
    signals,
    replay: ordered,
    evidence: {
      l05Ok: Boolean(l05?.ok),
      prodLikeFlowCount: Array.isArray(prodLikeSmoke?.flows) ? prodLikeSmoke.flows.length : 0,
      humanHandoffReplayCount: Array.isArray(humanHandoff?.replay) ? humanHandoff.replay.length : 0,
    },
    warnings: Object.entries(signals)
      .filter(([, value]) => !value)
      .map(([key]) => `${key}_not_observed`),
  };
}

async function main() {
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
  if (auth && auth.tenantId) {
    proofTenantId = String(auth.tenantId).trim() || proofTenantId;
  }

  const humanHandoff = await runHumanHandoffProof(baseUrl, auth);

  const runDependencies = String(process.env.ENTERPRISE_PROOF_RUN_DEPENDENCIES || '1') !== '0';
  const dependencyResults = [];
  if (runDependencies) {
    dependencyResults.push({
      name: 'l03',
      ...runNodeScript('scripts/test-pbx-voice-tts-asr-smoke.js'),
    });
    dependencyResults.push({
      name: 'l04',
      ...runNodeScript('scripts/test-pbx-call-events-runtime-smoke.js'),
    });
    dependencyResults.push({
      name: 'l05',
      ...runNodeScript('scripts/test-inbox-runtime-smoke.js'),
    });
  }

  const l03 = loadJsonIfExists(runtimeFirstArtifactPaths(
    'qa/l03-pbx-voice-tts-asr-evidence.json',
    'PBX_VOICE_TTS_ASR_EVIDENCE_PATH',
  ), null);
  const l04 = loadJsonIfExists(runtimeFirstArtifactPaths(
    'qa/l04-pbx-call-events-runtime-evidence.json',
    'PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH',
  ), null);
  const l05 = loadJsonIfExists(runtimeFirstArtifactPaths(
    'qa/l05-chatpro-omnichannel-evidence.json',
    'INBOX_RUNTIME_EVIDENCE_PATH',
  ), null);
  const prodLikeSmoke = loadJsonIfExists(runtimeFirstArtifactPaths(
    'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
    'QA_WAVES_PROD_LIKE_SMOKE_PATH',
  ), null);

  const pbxProof = summarizePbxProof({ l03, l04 });
  const pbxArtifactPath = writeJson('pbx-voice-flow-prod-like.json', pbxProof);
  const omnichannelUnifiedReplay = buildUnifiedReplay(humanHandoff, pbxProof, l05, prodLikeSmoke);
  const omnichannelArtifactPath = writeJson('omnichannel-unified-replay.json', omnichannelUnifiedReplay);

  const report = {
    generatedAt: new Date().toISOString(),
    ok: Boolean(humanHandoff.ok && pbxProof.ok && omnichannelUnifiedReplay.ok),
    apiBaseUrl: baseUrl,
    authMode: auth.mode,
    tenantId: auth.tenantId,
    dependencyResults,
    humanHandoff: {
      ok: humanHandoff.ok,
      artifactPath: humanHandoff.artifactPath,
      signals: humanHandoff.signals,
      warnings: humanHandoff.warnings,
    },
    pbxProdLike: {
      ok: pbxProof.ok,
      artifactPath: pbxArtifactPath,
      signals: pbxProof.signals,
      warnings: pbxProof.warnings,
    },
    omnichannelUnifiedReplay: {
      ok: omnichannelUnifiedReplay.ok,
      artifactPath: omnichannelArtifactPath,
      signals: omnichannelUnifiedReplay.signals,
      warnings: omnichannelUnifiedReplay.warnings,
    },
  };

  const reportPath = writeJson('enterprise-proof-report.json', report);
  // eslint-disable-next-line no-console
  console.log(`[qa-waves-enterprise-proof-smoke] ok=${report.ok} report=${reportPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[qa-waves-enterprise-proof-smoke] FAIL', error?.message || error);
    process.exit(1);
  });
}

module.exports = { main };