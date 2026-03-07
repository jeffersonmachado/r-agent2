/**
 * Automations (v1) - low-code.
 *
 * Armazena definições de automação em tenant_settings para MVP.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');
const nlpService = require('./nlpService');

const SETTINGS_KEY = 'automations';

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    automations: Array.isArray(obj.automations) ? obj.automations : [],
  };
}

function normalizeAutomation(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    name: item.name ? String(item.name) : '',
    description: item.description ? String(item.description) : '',
    status: item.status ? String(item.status) : 'draft',
    definition: item.definition && typeof item.definition === 'object' ? item.definition : {},
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    publishedAt: item.publishedAt || null,
    lastRunAt: item.lastRunAt || null,
    lastRunId: item.lastRunId || null,
    lastRunStatus: item.lastRunStatus || null,
    lastRunAiAnalysis: item.lastRunAiAnalysis || item.last_run_ai_analysis || null,
  };
}

async function getStore(tenantId) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function saveStore(tenantId, store) {
  const payload = normalizeStore(store);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: payload });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function listAutomations(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const items = out.store.automations.map(normalizeAutomation).filter(Boolean);
  return { ok: true, automations: items };
}

async function upsertAutomation(tenantId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date().toISOString();
  const id = input?.id ? String(input.id) : `auto-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeAutomation({
    id,
    name: input?.name ? String(input.name).trim() : '',
    description: input?.description ? String(input.description).trim() : '',
    status: input?.status ? String(input.status) : 'draft',
    definition: input?.definition && typeof input.definition === 'object' ? input.definition : {},
    updatedAt: now,
  });

  const idx = out.store.automations.findIndex((a) => a && a.id === id);
  if (idx >= 0) {
    const prev = normalizeAutomation(out.store.automations[idx]);
    out.store.automations[idx] = {
      ...prev,
      ...next,
      createdAt: prev?.createdAt || now,
    };
  } else {
    out.store.automations.push({ ...next, createdAt: now });
  }

  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, automation: next, automations: saved.store.automations.map(normalizeAutomation).filter(Boolean) };
}

async function publishAutomation(tenantId, automationId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.automations.findIndex((a) => a && String(a.id) === String(automationId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const next = normalizeAutomation({
    ...out.store.automations[idx],
    status: 'published',
    updatedAt: now,
    publishedAt: now,
  });
  out.store.automations[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, automation: next };
}

async function runAutomation(tenantId, automationId, runContext = {}) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.automations.findIndex((a) => a && String(a.id) === String(automationId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let normalizedContext = null;
  const sessionId = runContext && runContext.session_id ? String(runContext.session_id).trim() : '';
  if (sessionId) {
    try {
      const contextApi = require('../context');
      normalizedContext = await contextApi.getNormalizedContext(tenantId, sessionId);
    } catch (_) {
      normalizedContext = null;
    }
  }

  const extractTextForAiAnalysis = () => {
    const contextInput = runContext && typeof runContext === 'object' ? runContext : {};
    const fromContext = [
      contextInput.text,
      contextInput.message,
      contextInput.user_input,
      contextInput.input,
      contextInput.inputText,
    ];
    for (const value of fromContext) {
      const text = String(value || '').trim();
      if (text) return text;
    }

    const lastEvent = normalizedContext && normalizedContext.last_event && typeof normalizedContext.last_event === 'object'
      ? normalizedContext.last_event
      : {};
    const body = lastEvent && lastEvent.body && typeof lastEvent.body === 'object'
      ? lastEvent.body
      : {};
    const payload = lastEvent && lastEvent.payload && typeof lastEvent.payload === 'object'
      ? lastEvent.payload
      : {};

    const fromEvent = [
      lastEvent.text,
      lastEvent.message,
      body.text,
      body.caption,
      payload.text,
      payload.message,
    ];
    for (const value of fromEvent) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  };

  let aiAnalysis = null;
  const analysisText = extractTextForAiAnalysis();
  if (analysisText) {
    try {
      const nlp = await nlpService.analyzeText(analysisText, true);
      aiAnalysis = {
        text: analysisText,
        intent: nlp && nlp.intent ? String(nlp.intent) : null,
        sentiment: nlp && nlp.sentiment ? String(nlp.sentiment) : null,
        entities_count: nlp && nlp.entities && typeof nlp.entities === 'object'
          ? Object.keys(nlp.entities).length
          : 0,
      };
    } catch (_) {
      aiAnalysis = {
        text: analysisText,
        intent: null,
        sentiment: null,
        entities_count: 0,
        error: 'nlp_analysis_failed',
      };
    }
  }

  const next = normalizeAutomation({
    ...out.store.automations[idx],
    lastRunAt: now,
    lastRunId: runId,
    lastRunStatus: 'queued',
    lastRunAiAnalysis: aiAnalysis,
    updatedAt: now,
  });
  out.store.automations[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return {
    ok: true,
    automation: next,
    run: {
      id: runId,
      status: 'queued',
      queuedAt: now,
      session_id: sessionId || null,
      normalized_context: normalizedContext || null,
      ai_analysis: aiAnalysis,
    },
  };
}

module.exports = {
  listAutomations,
  upsertAutomation,
  publishAutomation,
  runAutomation,
};
