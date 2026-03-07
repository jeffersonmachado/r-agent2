// whatsappInboundService.js - Pipeline unificado de inbound WhatsApp (Cloud webhook e QR)
'use strict';

const logger = require('../utils/logger');
const channelGatewayService = require('./channelGatewayService');
const { resolveOrCreateTicketFromIncomingMessage, appendTicketMessage } = require('./conversationTicketLinkService');
const { autoAssignTicket } = require('./routingService');
const { emitEvent } = require('./websocketService');
const { processNormalizedInboundEvent } = require('./messageProcessor');
const { getTicket, updateTicket } = require('./queueService');
const outboundQueueService = require('./outboundQueueService');
const whatsappQrService = require('./whatsappQrService');
const { handleScheduleWhatsAppReply } = require('./scheduleWhatsAppResponder');
const { checkFeature } = require('./planLimitsService');
const { sendToUser, trimPreview } = require('./push');
const whatsappIvrService = require('./whatsappIvrService');
const {
  resolveWhatsAppIvrRouting,
  buildTicketPatchFromRouting,
} = require('./whatsappIvrRoutingService');
const whatsappIvrStateService = require('./whatsappIvrStateService');
const aiIntentService = require('./aiIntentService');
const {
  shouldNotifyTicketMessage,
  selectRecipientUserIdsForTicket,
  consumeMessageDedup,
} = require('./push/notificationRules');
const uraDecisionAuditService = require('./uraDecisionAuditService');

function jsonSafe(obj) {
  try { return JSON.stringify(obj); } catch (_) { return '[unserializable]'; }
}

function isHumanMode(ticket) {
  const mode = (ticket?.mode || 'bot');
  return mode === 'human' || mode === 'paused';
}

function resolveInboundConnectionIdentifiers(payload = {}) {
  const connectionId = payload?.__qr?.connectionId ? String(payload.__qr.connectionId).trim() : null;
  const phoneNumberIdRaw = payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null;
  const phoneNumberId = phoneNumberIdRaw != null ? String(phoneNumberIdRaw).trim() : null;
  return { connectionId, phoneNumberId };
}

function buildInboundSessionId(payload = {}, message = {}, fallbackConversationId = null) {
  const from = message?.from ? String(message.from).trim() : null;
  const { connectionId, phoneNumberId } = resolveInboundConnectionIdentifiers(payload);

  if (connectionId && from) return `whatsapp_qr_${connectionId}_${from}`;
  if (phoneNumberId && from) return `whatsapp_cloud_${phoneNumberId}_${from}`;

  const channelSuffix = phoneNumberId || connectionId || String(fallbackConversationId || 'unknown');
  const fromSuffix = from || 'unknown';
  return `whatsapp_${channelSuffix}_${fromSuffix}`;
}

function buildPushBody({ from, text }) {
  const sender = String(from || 'Contato');
  return `${sender}: ${trimPreview(text || '', 100)}`;
}

function summarizeInboundByType(messageType, fallbackFileName = null) {
  const mt = String(messageType || '').toLowerCase();
  if (mt === 'image') return '[imagem]';
  if (mt === 'audio' || mt === 'voice') return '[audio]';
  if (mt === 'video') return '[video]';
  if (mt === 'document' || mt === 'file') return fallbackFileName ? `[documento] ${fallbackFileName}` : '[documento]';
  if (mt === 'sticker') return '[sticker]';
  if (mt === 'location') return '[localizacao]';
  if (mt === 'contacts') return '[contatos]';
  if (mt === 'interactive') return '[interativo]';
  return '[mensagem]';
}

function normalizeInboundMediaType(messageType) {
  const mt = String(messageType || '').toLowerCase();
  if (mt === 'image' || mt === 'audio' || mt === 'video') return mt;
  if (mt === 'document' || mt === 'file') return 'document';
  return 'text';
}

function isMenuResetCommand(text) {
  return String(text || '').trim().toLowerCase() === 'menu';
}

function renderMenuMessage(config, menuOptions = [], { retry = false } = {}) {
  const menu = config?.menu || {};
  const header = retry
    ? String(menu.retryTemplate || '').trim()
    : String(menu.greetingTemplate || '').trim();
  const lines = menuOptions.map((item) => {
    const label = String(item.menuLabel || item.departmentName || item.departmentId || '').trim();
    const description = String(item.menuDescription || '').trim();
    return description
      ? `${item.optionNumber}. ${label} - ${description}`
      : `${item.optionNumber}. ${label}`;
  });
  return [header, ...lines].filter(Boolean).join('\n');
}

function renderMenuConfirmation(config, routingResult) {
  const template = String(config?.menu?.confirmationTemplate || '').trim();
  if (!template) return null;
  return template.replace(/\{\{\s*department\s*\}\}/gi, String(routingResult?.departmentName || 'atendimento'));
}

async function sendWhatsAppTextOutbound({ tenantId, conversationId = null, to = null, text = '' }) {
  const bodyText = String(text || '').trim();
  if (!tenantId || !bodyText || !to) return null;
  return outboundQueueService.enqueueOutbound({
    tenantId: String(tenantId),
    channelType: 'whatsapp',
    conversationId: conversationId ? String(conversationId) : null,
    message: {
      to: String(to),
      type: 'text',
      body: { text: bodyText },
    },
  });
}

function minutesBetween(fromIso, now) {
  if (!fromIso) return Number.POSITIVE_INFINITY;
  const fromTs = new Date(fromIso).getTime();
  const nowTs = now instanceof Date ? now.getTime() : Date.now();
  if (!Number.isFinite(fromTs) || !Number.isFinite(nowTs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowTs - fromTs) / 60000);
}

async function applyWhatsAppIvr({
  tenantId,
  ticket,
  conversationId = null,
  sessionId,
  messageId = null,
  contactPhone = null,
  text = '',
  now = new Date(),
}) {
  if (!tenantId || !ticket?.id || !sessionId) {
    return { handled: false, ticket };
  }

  const normalizedText = String(text || '').trim();
  const resetRequested = isMenuResetCommand(normalizedText);
  let state = await whatsappIvrStateService.getState({ tenantId, sessionId }).catch(() => null);

  if (resetRequested) {
    await whatsappIvrStateService.resetState({ tenantId, sessionId }).catch(() => null);
    state = null;
  } else if (state?.status === 'routed') {
    return { handled: false, ticket, reason: 'already_routed' };
  }

  const ivrOut = await whatsappIvrService.getNormalizedWhatsAppIvrSetting({ tenantId }).catch(() => ({ ok: false }));
  if (!ivrOut?.ok || ivrOut?.value?.enabled !== true) {
    return { handled: false, ticket };
  }

  const config = ivrOut.value;
  const menuOptions = Array.isArray(ivrOut.menuOptions) ? ivrOut.menuOptions : [];
  const currentState = state && typeof state === 'object' ? state : null;
  const throttledMenuPrompt = currentState?.status === 'awaiting_choice'
    && minutesBetween(currentState.lastMenuSentAt, now) < 0.5;
  const aiResult = config.aiEnabled === true
    ? await aiIntentService.classifyIncomingMessage({
      tenantId,
      text: normalizedText,
      config,
      departments: Array.isArray(ivrOut.departments) ? ivrOut.departments : [],
      ticket,
      history: Array.isArray(ticket?.context?.metadata?.recentMessages) ? ticket.context.metadata.recentMessages : [],
      channel: 'whatsapp',
    }).catch((err) => {
      logger.warn('[WhatsAppIVR] Falha ao classificar intencao; seguindo com fallback', {
        tenantId,
        ticketId: ticket?.id || null,
        error: err?.message || String(err || 'unknown_error'),
      });
      return null;
    })
    : null;

  const routingResult = resolveWhatsAppIvrRouting({
    config,
    departments: Array.isArray(ivrOut.departments) ? ivrOut.departments : [],
    text: normalizedText,
    aiResult,
    now,
    menuState: currentState,
  });

  if (!routingResult || routingResult.action === 'noop') {
    return { handled: false, ticket };
  }

  let nextTicket = ticket;
  const ticketPatch = buildTicketPatchFromRouting({ ticket, routingResult });
  if (ticketPatch) {
    if (aiResult) {
      ticketPatch.context = {
        ...(ticketPatch.context || {}),
        metadata: {
          ...((ticketPatch.context && ticketPatch.context.metadata) || {}),
          whatsappIvrDecision: {
            intent: aiResult.intent || null,
            secondaryIntent: aiResult.secondaryIntent || null,
            entities: aiResult.entities || {},
            confidence: aiResult.confidence || 0,
            explanation: aiResult.explanation || null,
            reasoning: aiResult.reasoning || [],
            ragUsed: aiResult.ragUsed === true,
            providerStatus: aiResult.providerStatus || null,
            contextUsed: aiResult.contextUsed || null,
            departmentId: routingResult?.departmentId || null,
            departmentName: routingResult?.departmentName || null,
            queueName: routingResult?.queueName || null,
            modeUsed: routingResult?.modeUsed || null,
            selectedVia: routingResult?.selectedVia || null,
          },
        },
      };
    }
    const updated = updateTicket(ticket.id, ticketPatch);
    if (updated) nextTicket = updated;
  }

  if (aiResult) {
    logger.info('[WhatsAppIVR] Decisao de roteamento', {
      tenantId,
      ticketId: ticket?.id || null,
      sessionId,
      intent: aiResult.intent || null,
      secondaryIntent: aiResult.secondaryIntent || null,
      confidence: aiResult.confidence || 0,
      departmentId: routingResult?.departmentId || null,
      action: routingResult?.action || null,
      modeUsed: routingResult?.modeUsed || null,
      selectedVia: routingResult?.selectedVia || null,
      ragUsed: aiResult.ragUsed === true,
      providerStatus: aiResult.providerStatus || null,
      contextUsed: aiResult.contextUsed || null,
      explanation: aiResult.explanation || null,
    });
  }

  await uraDecisionAuditService.recordDecision({
    tenantId,
    ticketId: nextTicket?.id || ticket?.id || null,
    messageId,
    aiResult,
    routingResult,
  }).catch(() => null);

  if (routingResult.action === 'route') {
    const chosenViaMenu = routingResult.selectedVia === 'menu';
    if (chosenViaMenu) {
      const confirmationText = renderMenuConfirmation(config, routingResult);
      if (confirmationText) {
        await sendWhatsAppTextOutbound({
          tenantId,
          conversationId,
          to: contactPhone,
          text: confirmationText,
        }).catch(() => null);
      }
      await whatsappIvrStateService.setState({
        tenantId,
        sessionId,
        timeoutSeconds: Number(config?.menu?.timeoutSeconds || 600),
        state: {
          status: 'routed',
          conversationId,
          lastMenuSentAt: new Date(now).toISOString(),
          attempts: Number(currentState?.attempts || 0),
          selectedDepartmentId: routingResult.departmentId || null,
          selectedVia: routingResult.selectedVia || null,
          lastAction: routingResult.action || 'route',
        },
      }).catch(() => null);
      return { handled: true, stopPipeline: true, ticket: nextTicket, routingResult };
    }

    if (currentState?.status === 'awaiting_choice') {
      await whatsappIvrStateService.setState({
        tenantId,
        sessionId,
        timeoutSeconds: Number(config?.menu?.timeoutSeconds || 600),
        state: {
          status: 'routed',
          conversationId,
          lastMenuSentAt: currentState.lastMenuSentAt || null,
          attempts: Number(currentState.attempts || 0),
          selectedDepartmentId: routingResult.departmentId || null,
          selectedVia: routingResult.selectedVia || null,
          lastAction: routingResult.action || 'route',
        },
      }).catch(() => null);
    }

    return { handled: false, ticket: nextTicket, routingResult };
  }

  if (routingResult.action === 'create_ticket' || routingResult.action === 'collect_info') {
    const lastPromptAt = currentState?.lastMenuSentAt || null;
    if (minutesBetween(lastPromptAt, now) >= 1) {
      await sendWhatsAppTextOutbound({
        tenantId,
        conversationId,
        to: contactPhone,
        text: routingResult.offHoursMessage,
      }).catch(() => null);
    }
    await whatsappIvrStateService.setState({
      tenantId,
      sessionId,
      timeoutSeconds: Number(config?.menu?.timeoutSeconds || 600),
      state: {
        status: 'idle',
        conversationId,
        lastMenuSentAt: new Date(now).toISOString(),
        attempts: 0,
        selectedDepartmentId: routingResult.departmentId || null,
        selectedVia: routingResult.selectedVia || null,
        lastAction: routingResult.action || null,
      },
    }).catch(() => null);
    return { handled: true, stopPipeline: true, ticket: nextTicket, routingResult };
  }

  if (routingResult.action === 'show_menu') {
    if (menuOptions.length === 0) {
      return { handled: false, ticket: nextTicket };
    }

    const attempts = currentState?.status === 'awaiting_choice'
      ? Number(currentState.attempts || 0) + 1
      : 1;
    const maxAttempts = Number(config?.menu?.maxAttempts || 3);

    if (attempts > maxAttempts) {
      await whatsappIvrStateService.resetState({ tenantId, sessionId }).catch(() => null);
      return { handled: false, ticket: nextTicket, reason: 'menu_max_attempts' };
    }

    if (!throttledMenuPrompt) {
      await sendWhatsAppTextOutbound({
        tenantId,
        conversationId,
        to: contactPhone,
        text: renderMenuMessage(config, menuOptions, { retry: currentState?.status === 'awaiting_choice' }),
      }).catch(() => null);
    }

    await whatsappIvrStateService.setState({
      tenantId,
      sessionId,
      timeoutSeconds: Number(config?.menu?.timeoutSeconds || 600),
      state: {
        status: 'awaiting_choice',
        conversationId,
        lastMenuSentAt: new Date(now).toISOString(),
        attempts,
        selectedDepartmentId: null,
        selectedVia: null,
        lastAction: routingResult.action || 'show_menu',
      },
    }).catch(() => null);

    return { handled: true, stopPipeline: true, ticket: nextTicket, routingResult };
  }

  return { handled: false, ticket: nextTicket, routingResult };
}

// Normaliza o identificador da conversa para evitar duplicação de ticket em cenários Baileys/MD
// onde o WhatsApp alterna entre JID @lid e @s.whatsapp.net.
function normalizeExternalConversationId({ normalized, payload, message }) {
  const direct = normalized?.externalConversationId;
  if (direct) return String(direct);

  // Preferir JID alternativo quando o raw vier como @lid
  const qr = payload?.__qr || null;
  const jidRaw = qr?.remoteJidRaw || qr?.remoteJid || null;
  const jidAlt = qr?.remoteJidAlt || null;

  let jid = jidRaw;
  if (typeof jidRaw === 'string' && jidRaw.endsWith('@lid') && typeof jidAlt === 'string' && jidAlt.endsWith('@s.whatsapp.net')) {
    jid = jidAlt;
  }

  // Cloud já entrega 'from' numérico; QR runner entrega 'from' numérico também.
  const from = message?.from ? String(message.from) : null;
  if (from) return from;

  if (typeof jid === 'string' && jid.includes('@')) return jid.split('@')[0];
  if (jid) return String(jid);
  return null;
}

/**
 * Processa inbound WhatsApp de forma consistente:
 * - Persiste no ChannelGateway (idempotente)
 * - Resolve/cria ticket
 * - Registra mensagem no ledger do ticket
 * - Se ticket em modo humano: emite evento e não roda bot
 * - Caso contrário: tenta rodar engine (best-effort)
 */
async function handleWhatsAppInbound({
  source = 'unknown',
  tenantId,
  payload,
  normalized,
  traceId = null,
  deps = null,
}) {
  const message = payload?.message || null;
  const value = payload?.value || null;

  const externalMessageId = normalized?.externalMessageId || (message?.id ? String(message.id) : null);
  const externalConversationId = normalizeExternalConversationId({ normalized, payload, message });

  
  // 0) Log obrigatório (pré-tenant): ajuda a debugar inbound que é descartado antes de virar ticket
  try {
    const phoneNumberId = payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null;
    const from = payload?.message?.from || payload?.value?.messages?.[0]?.from || null;
    const msgType = payload?.message?.type || payload?.value?.messages?.[0]?.type || null;
    logger.warn('WA_IN_PRE', 'Inbound recebido (antes de resolver tenant)', {
      traceId: traceId || 'n/a',
      source,
      tenantId: tenantId || null,
      externalMessageId,
      externalConversationId,
      phone_number_id: phoneNumberId,
      from,
      msgType,
    });
  } catch (_) { /* não quebra pipeline */ }

// 1) Persistência + idempotência
  const ingest = await channelGatewayService.ingestIncoming('whatsapp', payload, { tenantId }).catch((e) => {
    logger.error(`[WA_PIPE_GATEWAY_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId, externalMessageId, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return null;
  });

  const effectiveTenantId = tenantId || ingest?.tenantId || null;
  if (!effectiveTenantId) {
    logger.error('WA_PIPE_SKIP', 'tenant-not-resolved (discard seguro)', { traceId: traceId || 'n/a', source, externalMessageId, externalConversationId, phone_number_id: payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null, reason: 'tenant_not_resolved' });
    return { ok: false, reason: 'tenant_not_resolved' };
  }

  if (ingest?.persist?.idempotent === true) {
    logger.debug(`[WA_PIPE_SKIP] idempotent traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId: effectiveTenantId, externalMessageId })}`);
    return { ok: true, idempotent: true };
  }

  const resolvedConnection = await whatsappQrService.resolveConnectionForInbound(effectiveTenantId, payload).catch(() => null);
  const resolvedConnectionId = resolvedConnection?.id ? String(resolvedConnection.id) : (payload?.__qr?.connectionId ? String(payload.__qr.connectionId) : null);
  const resolvedBotEnabled = resolvedConnection?.botEnabled === true;
  const resolvedBotFlowId = resolvedBotEnabled && resolvedConnection?.botFlowId ? String(resolvedConnection.botFlowId) : null;
  const inboundSessionId = buildInboundSessionId(payload, message, externalConversationId);

  let blockedByPlan = false;
  if (resolvedBotEnabled) {
    const featureCheck = await checkFeature(effectiveTenantId, 'whatsapp_bot').catch(() => ({ allowed: false }));
    blockedByPlan = !featureCheck.allowed;
  }

  const modeFromConnection = (!resolvedConnection || blockedByPlan || !resolvedBotEnabled || !resolvedBotFlowId)
    ? 'human'
    : 'bot';

  logger.info('WA_INBOUND_ROUTE', {
    traceId: traceId || 'n/a',
    tenantId: effectiveTenantId,
    source,
    connectionId: resolvedConnectionId,
    phone_number_id: payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null,
    mode: modeFromConnection,
    flowId: modeFromConnection === 'bot' ? resolvedBotFlowId : null,
    blockedByPlan,
    hasConnection: !!resolvedConnection,
  });

  const inboundMessageType = String(
    normalized?.messageType
    || message?.type
    || (message?.text?.body ? 'text' : 'unknown')
  ).toLowerCase();
  const inboundFileName = String(
    normalized?.raw?.message?.document?.filename
    || message?.document?.filename
    || ''
  ).trim() || null;
  const inboundMimeType = String(
    normalized?.media?.mimeType
    || normalized?.raw?.message?.document?.mime_type
    || normalized?.raw?.message?.image?.mime_type
    || normalized?.raw?.message?.video?.mime_type
    || normalized?.raw?.message?.audio?.mime_type
    || message?.document?.mime_type
    || message?.image?.mime_type
    || message?.video?.mime_type
    || message?.audio?.mime_type
    || ''
  ).trim() || null;
  const inboundMediaUrl = String(
    normalized?.media?.url
    || normalized?.raw?.message?.document?.id
    || normalized?.raw?.message?.image?.id
    || normalized?.raw?.message?.video?.id
    || normalized?.raw?.message?.audio?.id
    || message?.document?.id
    || message?.image?.id
    || message?.video?.id
    || message?.audio?.id
    || ''
  ).trim() || null;
  const messageTextRaw = typeof normalized?.text === 'string'
    ? normalized.text
    : (message?.text?.body ? String(message.text.body) : '');
  const messageText = messageTextRaw && String(messageTextRaw).trim()
    ? String(messageTextRaw)
    : summarizeInboundByType(inboundMessageType, inboundFileName);

  const iso = normalized?.timestamp || (() => {
    const ts = message?.timestamp ? Number(message.timestamp) : null;
    return ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
  })();

  logger.info(`[WA_PIPE_START] traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId: effectiveTenantId, externalConversationId, externalMessageId, preview: messageText.slice(0, 200) })}`);

  // 2) Resolve/cria ticket
  const link = await resolveOrCreateTicketFromIncomingMessage(
    effectiveTenantId,
    'whatsapp',
    String(externalConversationId || ''),
    { 
      phone: message?.from ? String(message.from) : null,
      // Fallback para __qr.contactName garante nome mesmo quando value.contacts não vier preenchido.
      name: normalized?.sender?.name || payload?.__qr?.contactName || null
    },
    { initialMode: modeFromConnection }
  ).catch((e) => {
    logger.error(`[WA_PIPE_TICKET_RESOLVE_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ tenantId: effectiveTenantId, externalConversationId, externalMessageId, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return null;
  });

  const ticket = link?.ticket || null;
  if (!ticket?.id) {
    logger.warn(`[WA_PIPE_SKIP] no-ticket traceId=${traceId || 'n/a'} ${jsonSafe({ tenantId: effectiveTenantId, externalConversationId, externalMessageId })}`);
    return { ok: false, reason: 'ticket_not_resolved' };
  }

  // Ponto de integracao da URA WhatsApp:
  // a resolucao operacional consolidada fica em `whatsappIvrRoutingService.resolveWhatsAppIvrRouting`.
  // A ativacao direta no pipeline foi mantida separada para evitar regressao no fluxo atual de tickets/handoff
  // ate a etapa dedicada de rollout controlado por tenant/canal.

  // 2.1) Ledger do ticket (idempotente por externalMessageId)
  let effectiveTicket = ticket;
  try {
    const updated = appendTicketMessage(ticket.id, {
      direction: 'in',
      text: messageText,
      externalMessageId,
      timestamp: iso,
      messageType: normalizeInboundMediaType(inboundMessageType),
      mediaUrl: inboundMediaUrl,
      mimeType: inboundMimeType,
      fileName: inboundFileName,
    });
    if (updated) effectiveTicket = updated;
  } catch (e) {
    logger.warn(`[WA_PIPE_APPEND_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: ticket.id, externalMessageId, errMessage: e?.message || String(e) })}`);
  }

  // Mantém política de auto-retorno alinhada com o estado atual do canal.
  // Canal sem bot ativo => ticket não pode retornar automaticamente para bot por inatividade.
  if (effectiveTicket && effectiveTicket.status !== 'closed') {
    const currentContext = effectiveTicket.context && typeof effectiveTicket.context === 'object'
      ? effectiveTicket.context
      : {};
    const currentMetadata = currentContext.metadata && typeof currentContext.metadata === 'object'
      ? currentContext.metadata
      : {};
    const desiredRouteMode = modeFromConnection;
    const desiredAllowReturn = desiredRouteMode === 'bot'
      ? (currentContext.allowReturnToBot !== false)
      : false;
    const desiredTicketOrigin = desiredRouteMode === 'human'
      ? 'human_chat'
      : (currentMetadata.ticketOrigin || 'bot_flow');

    const needsPolicySync = (
      currentContext.allowReturnToBot !== desiredAllowReturn ||
      currentMetadata.channelBotEnabled !== resolvedBotEnabled ||
      currentMetadata.connectionId !== resolvedConnectionId ||
      currentMetadata.inboundRouteMode !== desiredRouteMode ||
      currentMetadata.ticketOrigin !== desiredTicketOrigin
    );

    if (needsPolicySync) {
      const patchedTicket = updateTicket(effectiveTicket.id, {
        context: {
          ...currentContext,
          allowReturnToBot: desiredAllowReturn,
          metadata: {
            ...currentMetadata,
            channelBotEnabled: resolvedBotEnabled,
            connectionId: resolvedConnectionId,
            inboundRouteMode: desiredRouteMode,
            ticketOrigin: desiredTicketOrigin,
          },
        },
      });
      if (patchedTicket) effectiveTicket = patchedTicket;
    }
  }

  // Garante consistência visual/operacional: conexão sem bot => ticket em modo humano.
  if (effectiveTicket && effectiveTicket.status !== 'closed' && modeFromConnection === 'human' && (effectiveTicket.mode || 'bot') !== 'human') {
    const forcedHuman = updateTicket(effectiveTicket.id, { mode: 'human', pauseReason: null });
    if (forcedHuman) effectiveTicket = forcedHuman;
    await link?.conversation?.update?.({
      current_ticket_id: effectiveTicket.id,
      status: 'human',
      last_message_at: new Date(),
      updated_at: new Date(),
    }).catch(() => null);
  }

  // 2.2) Roteador operacional de respostas de agendamento (WhatsApp-first).
  // Executa antes do gate bot↔humano e não depende do motor de IA.
  try {
    const scheduleReplyResult = await handleScheduleWhatsAppReply({
      tenantId: effectiveTenantId,
      messageText,
      contactId: message?.from ? String(message.from) : null,
      conversationId: effectiveTicket?.conversationId || ingest?.persist?.conversationId || null,
      from: message?.from ? String(message.from) : null,
      payload,
      normalized,
      inboundMessageId: externalMessageId || null,
      traceId,
    });
    if (scheduleReplyResult?.handled) {
      logger.info('[WA_PIPE_SCHEDULE_REPLY]', {
        traceId: traceId || 'n/a',
        tenantId: effectiveTenantId,
        ticketId: effectiveTicket?.id || null,
        scheduleId: scheduleReplyResult?.scheduleId || null,
        action: scheduleReplyResult?.action || null,
      });
    }
  } catch (scheduleErr) {
    logger.warn('[WA_PIPE_SCHEDULE_REPLY_WARN]', {
      traceId: traceId || 'n/a',
      tenantId: effectiveTenantId,
      ticketId: effectiveTicket?.id || null,
      error: scheduleErr?.message || String(scheduleErr),
    });
  }

  // 2.3) URA WhatsApp operacional.
  // Executa apenas quando o canal segue em modo bot e o ticket ainda nao esta em handover humano.
  try {
    if (effectiveTicket && effectiveTicket.status !== 'closed' && !isHumanMode(effectiveTicket) && modeFromConnection === 'bot') {
      const ivrResult = await applyWhatsAppIvr({
        tenantId: effectiveTenantId,
        ticket: effectiveTicket,
        conversationId: effectiveTicket?.conversationId || ingest?.persist?.conversationId || null,
        sessionId: inboundSessionId,
        messageId: externalMessageId || null,
        contactPhone: message?.from ? String(message.from) : null,
        text: messageText,
        now: new Date(),
      });
      if (ivrResult?.ticket) {
        effectiveTicket = ivrResult.ticket;
      }
      const postIvrState = await whatsappIvrStateService.getState({
        tenantId: effectiveTenantId,
        sessionId: inboundSessionId,
      }).catch(() => null);
      const ticketIvrContext = effectiveTicket?.context?.whatsappIvr
        || effectiveTicket?.context?.metadata?.whatsappIvr
        || null;
      if (ivrResult?.routingResult) {
        logger.info('[WA_PIPE_IVR]', {
          traceId: traceId || 'n/a',
          tenantId: effectiveTenantId,
          ticketId: effectiveTicket?.id || null,
          action: ivrResult.routingResult.action || null,
          modeUsed: ivrResult.routingResult.modeUsed || null,
          departmentId: ivrResult.routingResult.departmentId || null,
          queueName: ivrResult.routingResult.queueName || null,
          selectedVia: ivrResult.routingResult.selectedVia || null,
        });
      }
      const shouldStopForIvr = ivrResult?.stopPipeline === true
        || ivrResult?.routingResult?.action === 'show_menu'
        || ivrResult?.routingResult?.action === 'create_ticket'
        || ivrResult?.routingResult?.action === 'collect_info'
        || (ivrResult?.routingResult?.action === 'route' && ivrResult?.routingResult?.selectedVia === 'menu')
        || postIvrState?.lastAction === 'show_menu'
        || postIvrState?.lastAction === 'create_ticket'
        || postIvrState?.lastAction === 'collect_info'
        || (postIvrState?.lastAction === 'route' && postIvrState?.selectedVia === 'menu')
        || ticketIvrContext?.modeUsed === 'off_hours'
        || (postIvrState?.status === 'routed' && ticketIvrContext?.selectedVia === 'menu');
      if (shouldStopForIvr) {
        return {
          ok: true,
          mode: 'ivr',
          ticketId: effectiveTicket?.id || null,
          connectionId: resolvedConnectionId,
          ivrAction: ivrResult?.routingResult?.action
            || postIvrState?.lastAction
            || (ticketIvrContext?.modeUsed === 'off_hours' ? 'create_ticket' : null),
        };
      }
    }
  } catch (ivrErr) {
    logger.warn('[WA_PIPE_IVR_WARN]', {
      traceId: traceId || 'n/a',
      tenantId: effectiveTenantId,
      ticketId: effectiveTicket?.id || null,
      error: ivrErr?.message || String(ivrErr),
    });
  }

  // 3) Modo humano/pausado: não roda bot
  if (effectiveTicket && effectiveTicket.status !== 'closed' && (isHumanMode(effectiveTicket) || modeFromConnection === 'human')) {
    if ((effectiveTicket.mode || 'bot') === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
      autoAssignTicket(effectiveTicket.id).catch(() => null);
    }
    try {
      emitEvent('ticket.message.received', {
        ticketId: effectiveTicket.id,
        message: messageText,
        sender: 'user',
        ticket: effectiveTicket,
      }, { tenantId: effectiveTicket.tenantId, agentId: effectiveTicket.assignedTo });
    } catch (e) {
      logger.warn(`[WA_PIPE_HUMAN_EMIT_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e) })}`);
    }

    // Push para app mobile (somente destinatários relevantes; mínimo: assignedTo)
    if (shouldNotifyTicketMessage(effectiveTicket)) {
      const dedup = consumeMessageDedup({
        tenantId: effectiveTicket.tenantId,
        ticketId: effectiveTicket.id,
        externalMessageId,
      });

      if (!dedup.duplicate) {
        const recipients = selectRecipientUserIdsForTicket(effectiveTicket);
        for (const userId of recipients) {
          // eslint-disable-next-line no-await-in-loop
          await sendToUser({
            tenantId: effectiveTicket.tenantId,
            userId,
            notification: {
              title: 'Nova mensagem no WhatsApp',
              body: buildPushBody({ from: message?.from, text: messageText }),
            },
            data: {
              tenantId: effectiveTicket.tenantId,
              ticketId: effectiveTicket.id,
              channel: 'whatsapp',
              conversationId: effectiveTicket.conversationId || '',
              kind: 'ticket_message',
            },
            context: {
              tenantId: effectiveTicket.tenantId,
              ticketId: effectiveTicket.id,
            },
          }).catch((err) => {
            logger.warn('[WA_PIPE_PUSH_WARN]', {
              traceId: traceId || 'n/a',
              ticketId: effectiveTicket.id,
              tenantId: effectiveTicket.tenantId,
              userId,
              error: err?.message || String(err),
            });
            return null;
          });
        }
      }
    }

    logger.info(`[WA_PIPE_HUMAN_MODE_ON] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, mode: effectiveTicket.mode, connectionId: resolvedConnectionId, blockedByPlan })}`);
    return { ok: true, mode: 'human', ticketId: effectiveTicket.id, connectionId: resolvedConnectionId };
  }

  // 4) Bot: processa engine (best-effort)
  try {
    const flows = deps?.flows;
    const sessionEvents = deps?.sessionEvents;
    const saveSessionEvents = deps?.saveSessionEvents;
    if (!flows || !sessionEvents) {
      // Sem dependências do runtime do server.js: ainda assim ticket/ledger já foram criados.
      logger.warn(`[WA_PIPE_BOT_SKIPPED] traceId=${traceId || 'n/a'} ${jsonSafe({ reason: 'missing_deps', ticketId: effectiveTicket.id })}`);
      return { ok: true, mode: 'bot_skipped', ticketId: effectiveTicket.id };
    }

    await processNormalizedInboundEvent({
      event_type: 'message',
      channel: 'whatsapp',
      media: normalizeInboundMediaType(inboundMessageType) === 'document' ? 'file' : normalizeInboundMediaType(inboundMessageType),
      direction: 'inbound',
      tenant_id: effectiveTenantId,
      lead_id: message?.from ? String(message.from) : null,
      session_id: inboundSessionId,
      timestamp: iso || new Date().toISOString(),
      payload: {
        text: messageText,
        media: {
          type: normalizeInboundMediaType(inboundMessageType),
          url: inboundMediaUrl,
          mimeType: inboundMimeType,
          fileName: inboundFileName,
        },
        raw: message || null,
      },
      metadata: {
        message_id: externalMessageId || null,
        conversation_id: ingest?.persist?.conversationId || null,
        source,
      },
      voice_metadata: {},
      trace_id: traceId || externalMessageId || `${inboundSessionId}-${Date.now()}`,
      correlation_id: ingest?.persist?.conversationId || externalConversationId || inboundSessionId,
    }, {
      flows,
      sessionEvents,
      saveSessionEvents,
      flowId: resolvedBotFlowId || null,
    });

    // Após a engine processar a mensagem, recupera o ticket atualizado e emite evento
    // para que o frontend atualize a lista de conversas com a última mensagem
    try {
      const updatedTicket = getTicket(effectiveTicket.id);
      if (updatedTicket) {
        emitEvent('ticket.message.received', {
          ticketId: updatedTicket.id,
          message: messageText,
          sender: 'user',
          ticket: updatedTicket, // Inclui ticket completo para atualização local no frontend
        }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
      }
    } catch (e) {
      logger.warn(`[WA_PIPE_BOT_EMIT_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e) })}`);
    }

    logger.info(`[WA_PIPE_BOT_DONE] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, connectionId: resolvedConnectionId, flowId: resolvedBotFlowId })}`);
    return { ok: true, mode: 'bot', ticketId: effectiveTicket.id, connectionId: resolvedConnectionId, flowId: resolvedBotFlowId };
  } catch (e) {
    logger.error(`[WA_PIPE_BOT_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return { ok: false, reason: 'bot_error', ticketId: effectiveTicket.id };
  }
}

module.exports = {
  handleWhatsAppInbound,
  applyWhatsAppIvr,
};
