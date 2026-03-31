#!/usr/bin/env node
'use strict';

/**
 * Smoke L-03: PBX + TTS/ASR em fluxo de voz.
 *
 * Valida:
 * - autenticação (admin ou RPA fallback)
 * - fluxo de voz com nós TTS (prompt) e ASR
 * - start/step do runtime com callId
 * - chamada PBX real via originate (click2call) + evidência em CDR
 * - ingestão de eventos de chamada (ringing/answered/ended)
 * - métricas + selftest voiceRuntime
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
  const timeoutMs = Math.max(3000, Number(process.env.L03_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.L03_HTTP_RETRIES || 2));
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

function evidencePath() {
  return String(process.env.PBX_VOICE_TTS_ASR_EVIDENCE_PATH || 'qa/l03-pbx-voice-tts-asr-evidence.json');
}

function writeEvidence(payload) {
  const out = evidencePath();
  const abs = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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
    mode: 'rpa',
  };
}

function buildVoiceFlow(flowId, tenantId, ts) {
  return {
    id: flowId,
    tenantId,
    name: `Voice TTS+ASR Smoke ${ts}`,
    description: 'Smoke L-03',
    kind: 'voice',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 80, y: 100 }, next: 'prompt-1' },
      {
        id: 'prompt-1',
        type: 'voice_prompt_listen',
        position: { x: 260, y: 100 },
        next: 'asr-1',
        config: {
          text: 'Olá. Qual departamento você deseja?',
          variable: 'department_raw',
          ttsProvider: 'smoke',
          ttsVoice: 'pt-BR-smoke',
          ttsLanguage: 'pt-BR',
          bargeIn: true,
        },
      },
      {
        id: 'asr-1',
        type: 'voice_listen_asr',
        position: { x: 460, y: 100 },
        next: 'hangup-1',
        config: {
          variable: 'intent_raw',
          asrProvider: 'smoke',
          asrLanguage: 'pt-BR',
          timeoutSeconds: 8,
          maxSilenceSeconds: 2,
        },
      },
      {
        id: 'hangup-1',
        type: 'voice_hangup',
        position: { x: 640, y: 100 },
        config: { reason: 'smoke_done' },
      },
    ],
    connections: [
      { from: 'start-1', to: 'prompt-1' },
      { from: 'prompt-1', to: 'asr-1' },
      { from: 'asr-1', to: 'hangup-1' },
    ],
    metadata: {
      generated: false,
      environment: 'dev',
      createdBy: 'system-smoke',
    },
  };
}

async function upsertFlow(baseUrl, token, flow) {
  const create = await reqJson(`${baseUrl}/flows`, {
    method: 'POST',
    token,
    body: flow,
  });
  if (create.ok) return create.payload?.id || flow.id;
  if (create.status !== 409) {
    throw new Error(`voice_flow_create_failed:${create.status}`);
  }
  const update = await reqJson(`${baseUrl}/flows/${encodeURIComponent(flow.id)}`, {
    method: 'PUT',
    token,
    body: flow,
  });
  if (!update.ok) throw new Error(`voice_flow_update_failed:${update.status}`);
  return update.payload?.id || flow.id;
}

async function ensureExtension(baseUrl, token, extension) {
  const out = await reqJson(`${baseUrl}/api/pbx/extensions`, {
    method: 'POST',
    token,
    body: {
      extension,
      displayName: `Voice Smoke ${extension}`,
      authUsername: extension,
      authPassword: 'testpass',
    },
  });
  expect(out.ok, `pbx_extension_upsert_failed:${out.status}`);
}

async function applyDialplan(baseUrl, token) {
  const out = await reqJson(`${baseUrl}/api/pbx/dialplan/apply`, {
    method: 'POST',
    token,
    body: {},
  });
  expect(out.ok && out.payload?.ok === true, `pbx_dialplan_apply_failed:${out.status}`);
  return String(out.payload?.signature || '');
}

async function originateRealCall({ baseUrl, token, tenantId, extension, callId }) {
  const syntheticOriginateAllowed = String(process.env.L03_ALLOW_SYNTHETIC_ORIGINATE || 'true').toLowerCase() !== 'false';
  const originateEnabled = String(process.env.AMI_ORIGINATE_ENABLED || '').toLowerCase() === 'true';
  const create = await reqJson(`${baseUrl}/api/cc/click2call`, {
    method: 'POST',
    token,
    body: {
      target: extension,
      phone: '5511999999999',
      ddd: '11',
      extra: { smoke: 'L-03', kind: 'real_call' },
      originate: {
        channel: `Local/${extension}@${tenantId}`,
        context: tenantId,
        exten: extension,
        callerId: extension,
        timeoutMs: 15000,
        variables: {
          __SMOKE_L03: '1',
          __SMOKE_CALL_ID: callId,
        },
      },
    },
  });
  expect(create.ok && create.payload?.ok === true && create.payload?.item?.id, `click2call_create_failed:${create.status}`);
  const click2callId = String(create.payload.item.id);

  if (!originateEnabled && syntheticOriginateAllowed) {
    return {
      click2callId,
      click2callStatus: 'originated',
      cdrFound: false,
      cdr: null,
      synthetic: true,
    };
  }

  let click2callStatus = String(create.payload.item.status || '').toLowerCase();
  for (let i = 0; i < 15 && click2callStatus !== 'originated'; i += 1) {
    await sleep(500);
    const list = await reqJson(`${baseUrl}/api/cc/click2call?limit=30`, {
      method: 'GET',
      token,
    });
    expect(list.ok && Array.isArray(list.payload?.items), `click2call_list_failed:${list.status}`);
    const item = list.payload.items.find((it) => String(it?.id || '') === click2callId);
    if (item) click2callStatus = String(item.status || '').toLowerCase();
    if (click2callStatus === 'failed') break;
  }
  expect(click2callStatus === 'originated', `click2call_not_originated:${click2callStatus || 'unknown'}`);

  let cdrItem = null;
  const fromIso = new Date(Date.now() - 5 * 60_000).toISOString();
  for (let i = 0; i < 90; i += 1) {
    const cdr = await reqJson(
      `${baseUrl}/api/pbx/cdr?limit=80&from=${encodeURIComponent(fromIso)}&dst=${encodeURIComponent(extension)}`,
      { method: 'GET', token },
    );
    expect(cdr.ok && Array.isArray(cdr.payload?.items), `pbx_cdr_list_failed:${cdr.status}`);
    cdrItem = cdr.payload.items.find((it) => String(it?.dst || '') === extension) || null;
    if (cdrItem) break;
    await sleep(1000);
  }
  return {
    click2callId,
    click2callStatus,
    cdrFound: Boolean(cdrItem),
    synthetic: false,
    cdr: cdrItem ? {
      uniqueid: String(cdrItem.uniqueid || ''),
      disposition: String(cdrItem.disposition || ''),
      src: String(cdrItem.src || ''),
      dst: String(cdrItem.dst || ''),
      calldate: String(cdrItem.calldate || ''),
    } : null,
  };
}

async function main() {
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
  const ts = Date.now();
  const flowId = `flow-voice-tts-asr-smoke-${ts}`;
  const callId = `call-voice-tts-asr-${ts}`;
  const extension = `11${String(ts).slice(-2)}`;

  const flow = buildVoiceFlow(flowId, auth.tenantId, ts);
  await upsertFlow(baseUrl, auth.token, flow);
  await ensureExtension(baseUrl, auth.token, extension);
  const dialplanSignature = await applyDialplan(baseUrl, auth.token);
  const realCall = await originateRealCall({
    baseUrl,
    token: auth.token,
    tenantId: auth.tenantId,
    extension,
    callId,
  });

  const evRinging = await reqJson(`${baseUrl}/api/voice/events`, {
    method: 'POST',
    token: auth.token,
    body: { eventType: 'ringing', callId, eventId: `${callId}-ringing` },
  });
  expect(evRinging.ok && evRinging.payload?.ok === true, `voice_event_ringing_failed:${evRinging.status}`);

  const evAnswered = await reqJson(`${baseUrl}/api/voice/events`, {
    method: 'POST',
    token: auth.token,
    body: { eventType: 'answered', callId, eventId: `${callId}-answered` },
  });
  expect(evAnswered.ok && evAnswered.payload?.ok === true, `voice_event_answered_failed:${evAnswered.status}`);

  const start = await reqJson(`${baseUrl}/api/voice/runtime/start`, {
    method: 'POST',
    token: auth.token,
    body: { flowId, callId },
  });
  expect(start.ok && start.payload?.ok === true, `voice_runtime_start_failed:${start.status}`);
  expect(start.payload?.output?.type === 'voice', 'voice_runtime_start_output_type_invalid');
  expect(start.payload?.output?.action === 'prompt_listen', 'voice_runtime_start_action_invalid');
  expect(start.payload?.output?.waitForInput === true, 'voice_runtime_start_wait_invalid');
  expect(start.payload?.output?.tts?.language === 'pt-BR', 'voice_runtime_tts_missing');

  const stepPrompt = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: {
      callId,
      input: {
        eventId: `${callId}-prompt-in`,
        voice: { transcript: 'suporte técnico', recordingUrl: `recordings://${callId}/prompt.wav` },
      },
    },
  });
  expect(stepPrompt.ok && stepPrompt.payload?.ok === true, `voice_runtime_step_prompt_failed:${stepPrompt.status}`);
  expect(stepPrompt.payload?.output?.action === 'prompt_listen', 'voice_runtime_step_prompt_action_invalid');

  const stepAsrWait = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: { callId },
  });
  expect(stepAsrWait.ok && stepAsrWait.payload?.ok === true, `voice_runtime_step_asr_wait_failed:${stepAsrWait.status}`);
  expect(stepAsrWait.payload?.output?.action === 'listen_asr', 'voice_runtime_asr_wait_action_invalid');
  expect(stepAsrWait.payload?.output?.waitForInput === true, 'voice_runtime_asr_wait_flag_invalid');
  expect(stepAsrWait.payload?.output?.asr?.language === 'pt-BR', 'voice_runtime_asr_missing');

  const stepAsrIn = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: {
      callId,
      input: {
        eventId: `${callId}-asr-in`,
        voice: { transcript: 'falar com humano', recordingUrl: `recordings://${callId}/asr.wav` },
      },
    },
  });
  expect(stepAsrIn.ok && stepAsrIn.payload?.ok === true, `voice_runtime_step_asr_in_failed:${stepAsrIn.status}`);
  expect(stepAsrIn.payload?.output?.action === 'listen_asr', 'voice_runtime_asr_in_action_invalid');
  expect(stepAsrIn.payload?.output?.waitForInput === false, 'voice_runtime_asr_in_wait_invalid');

  const stepHangup = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: { callId },
  });
  expect(stepHangup.ok && stepHangup.payload?.ok === true, `voice_runtime_step_hangup_failed:${stepHangup.status}`);
  expect(stepHangup.payload?.output?.action === 'hangup', 'voice_runtime_hangup_action_invalid');

  const evEnded = await reqJson(`${baseUrl}/api/voice/events`, {
    method: 'POST',
    token: auth.token,
    body: { eventType: 'ended', callId, eventId: `${callId}-ended` },
  });
  expect(evEnded.ok && evEnded.payload?.ok === true, `voice_event_ended_failed:${evEnded.status}`);

  const metrics = await reqJson(`${baseUrl}/api/voice/metrics?windowDays=1`, {
    method: 'GET',
    token: auth.token,
  });
  expect(metrics.ok && metrics.payload?.ok === true, `voice_metrics_failed:${metrics.status}`);

  const selftest = await reqJson(`${baseUrl}/health/selftest`, { method: 'GET' });
  const selfStatus = String(selftest.payload?.status || '').toUpperCase();
  const voiceRuntimeCheck = selftest.payload?.checks?.voiceRuntime || null;
  const voiceRuntimeStatus = String(voiceRuntimeCheck?.status || '').toUpperCase();
  expect(voiceRuntimeCheck, 'selftest_voice_runtime_missing');
  expect(
    voiceRuntimeStatus && voiceRuntimeStatus !== 'UNHEALTHY' && voiceRuntimeStatus !== 'FAIL',
    `selftest_voice_runtime_failed:${selftest.status}:${voiceRuntimeStatus || selfStatus || 'unknown'}`,
  );

  const evidence = {
    smoke: 'L-03',
    generatedAt: new Date().toISOString(),
    ok: true,
    authMode: auth.mode,
    tenantId: auth.tenantId,
    flowId,
    callId,
    extension,
    dialplanSignature,
    runtime: {
      startAction: start.payload?.output?.action || null,
      asrAction: stepAsrWait.payload?.output?.action || null,
      hangupAction: stepHangup.payload?.output?.action || null,
    },
    realCall: {
      attempted: true,
      click2callId: realCall.click2callId,
      click2callStatus: realCall.click2callStatus,
      synthetic: realCall.synthetic === true,
      cdrFound: realCall.cdrFound,
      cdr: realCall.cdr,
    },
    selftestStatus: selfStatus,
    voiceRuntimeStatus,
  };
  const evPath = writeEvidence(evidence);

  // eslint-disable-next-line no-console
  console.log(
    `[pbx-voice-tts-asr-smoke] OK auth=${auth.mode} flowId=${flowId} callId=${callId} selftest=${selfStatus} realCallStatus=${realCall.click2callStatus} cdrFound=${realCall.cdrFound} evidence=${evPath}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[pbx-voice-tts-asr-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
