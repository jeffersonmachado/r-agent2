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

const { getOrCreateRpaToken } = require('../core/rpa/utils/rpaTokenManager');
const fs = require('fs');
const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeoutMs = Math.max(3000, Number(process.env.L03_HTTP_TIMEOUT_MS || 60000));
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
      if (err?.name === 'AbortError') {
        lastErr = new Error(`request_aborted:${method}:${url}:timeout=${timeoutMs}`);
      } else {
        lastErr = err;
      }
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
  return resolveWorkspacePath(
    ROOT,
    runtimeAwarePath(ROOT, 'qa/l03-pbx-voice-tts-asr-evidence.json', 'PBX_VOICE_TTS_ASR_EVIDENCE_PATH'),
  );
}

function writeEvidence(payload) {
  const out = evidencePath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

function buildVoiceArtifacts({ callId, flow, promptTranscript, asrTranscript }) {
  const promptNode = Array.isArray(flow?.nodes) ? flow.nodes.find((node) => node.id === 'prompt-1') : null;
  const asrNode = Array.isArray(flow?.nodes) ? flow.nodes.find((node) => node.id === 'asr-1') : null;

  return {
    ttsPrompts: [
      {
        nodeId: promptNode?.id || 'prompt-1',
        text: promptNode?.config?.text || null,
        provider: promptNode?.config?.ttsProvider || null,
        voice: promptNode?.config?.ttsVoice || null,
        language: promptNode?.config?.ttsLanguage || null,
      },
    ],
    voiceTranscript: {
      fullTranscript: [promptTranscript, asrTranscript].filter(Boolean).join(' | '),
      segments: [
        {
          nodeId: promptNode?.id || 'prompt-1',
          transcript: promptTranscript,
          language: promptNode?.config?.ttsLanguage || null,
          source: 'voice_runtime_step_prompt',
        },
        {
          nodeId: asrNode?.id || 'asr-1',
          transcript: asrTranscript,
          language: asrNode?.config?.asrLanguage || null,
          source: 'voice_runtime_step_asr',
        },
      ],
    },
    recordings: [
      {
        nodeId: promptNode?.id || 'prompt-1',
        phase: 'prompt',
        recordingUrl: `recordings://${callId}/prompt.wav`,
      },
      {
        nodeId: asrNode?.id || 'asr-1',
        phase: 'asr',
        recordingUrl: `recordings://${callId}/asr.wav`,
      },
    ],
  };
}

async function login(baseUrl) {
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
  const adminLogin = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (adminLogin.ok && adminLogin.payload?.token) {
    const adminTenantId = String(adminLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system');
    const explicitTenant = String(process.env.TEST_PBX_TENANT_ID || process.env.TEST_TENANT_ID || '').trim();
    let operationalTenantId = explicitTenant && explicitTenant.toLowerCase() !== 'system' ? explicitTenant : adminTenantId;

    if (!explicitTenant || explicitTenant.toLowerCase() === 'system') {
      const tenants = await reqJson(`${baseUrl}/super-admin/tenants`, {
        method: 'GET',
        token: adminLogin.payload.token,
      });
      if (tenants.ok && Array.isArray(tenants.payload?.tenants)) {
        const candidate = tenants.payload.tenants.find((tenant) => {
          const id = String(tenant?.id || '').trim();
          return id && id.toLowerCase() !== 'system';
        });
        if (candidate?.id) {
          operationalTenantId = String(candidate.id);
        }
      }
    }

    if (operationalTenantId && operationalTenantId !== adminTenantId) {
      const rpaToken = getOrCreateRpaToken();
      const scopedRpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
        method: 'POST',
        body: { token: rpaToken, tenantId: operationalTenantId },
      });
      if (scopedRpaLogin.ok && scopedRpaLogin.payload?.token) {
        return {
          token: scopedRpaLogin.payload.token,
          tenantId: scopedRpaLogin.payload?.agent?.tenantId || operationalTenantId,
          mode: 'rpa_scoped',
        };
      }
    }

    return {
      token: adminLogin.payload.token,
      tenantId: adminTenantId,
      mode: 'admin',
    };
  }

  const fallbackTenantId = String(process.env.TEST_PBX_TENANT_ID || process.env.TEST_TENANT_ID || 'system').trim() || 'system';
  const rpaToken = getOrCreateRpaToken();
  const rpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: fallbackTenantId },
  });
  expect(rpaLogin.ok && rpaLogin.payload?.token, `login_failed:admin=${adminLogin.status}:rpa=${rpaLogin.status}`);
  return {
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || fallbackTenantId,
    mode: 'rpa',
  };
}

function buildVoiceFlow(flowId, tenantId, ts, transferTarget) {
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
        next: 'dtmf-1',
        config: {
          variable: 'intent_raw',
          asrProvider: 'smoke',
          asrLanguage: 'pt-BR',
          timeoutSeconds: 8,
          maxSilenceSeconds: 2,
        },
      },
      {
        id: 'dtmf-1',
        type: 'voice_gather_dtmf',
        position: { x: 660, y: 100 },
        next: 'transfer-1',
        config: {
          variable: 'menu_digit',
          maxDigits: 1,
          timeoutSeconds: 5,
        },
      },
      {
        id: 'transfer-1',
        type: 'voice_transfer_ramal',
        position: { x: 860, y: 100 },
        next: 'hangup-1',
        config: {
          ramal: transferTarget,
        },
      },
      {
        id: 'hangup-1',
        type: 'voice_hangup',
        position: { x: 1060, y: 100 },
        config: { reason: 'smoke_done' },
      },
    ],
    connections: [
      { from: 'start-1', to: 'prompt-1' },
      { from: 'prompt-1', to: 'asr-1' },
      { from: 'asr-1', to: 'dtmf-1' },
      { from: 'dtmf-1', to: 'transfer-1' },
      { from: 'transfer-1', to: 'hangup-1' },
    ],
    metadata: {
      generated: false,
      environment: 'dev',
      createdBy: 'system-smoke',
    },
  };
}

async function postVoiceEvent(baseUrl, token, body, errorCode) {
  const out = await reqJson(`${baseUrl}/api/voice/events`, {
    method: 'POST',
    token,
    body,
  });
  expect(out.ok && out.payload?.ok === true, `${errorCode}:${out.status}`);
  return out;
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
  const promptTranscript = 'suporte técnico';
  const asrTranscript = 'falar com humano';
  const extension = `11${String(ts).slice(-2)}`;
  const selftestExtension = String(process.env.L03_SELFTEST_EXTENSION || process.env.PBX_SELFTEST_EXTENSION || '9191').trim() || extension;

  const flow = buildVoiceFlow(flowId, auth.tenantId, ts, extension);
  await upsertFlow(baseUrl, auth.token, flow);
  await ensureExtension(baseUrl, auth.token, extension);
  const dialplanSignature = await applyDialplan(baseUrl, auth.token);
  const realCall = await originateRealCall({
    baseUrl,
    token: auth.token,
    tenantId: auth.tenantId,
    extension: selftestExtension,
    callId,
  });

  await postVoiceEvent(baseUrl, auth.token, {
    eventType: 'ringing',
    callId,
    eventId: `${callId}-ringing`,
  }, 'voice_event_ringing_failed');

  await postVoiceEvent(baseUrl, auth.token, {
    eventType: 'answered',
    callId,
    eventId: `${callId}-answered`,
  }, 'voice_event_answered_failed');

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
        voice: { transcript: promptTranscript, recordingUrl: `recordings://${callId}/prompt.wav` },
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
        voice: { transcript: asrTranscript, recordingUrl: `recordings://${callId}/asr.wav` },
      },
    },
  });
  expect(stepAsrIn.ok && stepAsrIn.payload?.ok === true, `voice_runtime_step_asr_in_failed:${stepAsrIn.status}`);
  expect(stepAsrIn.payload?.output?.action === 'listen_asr', 'voice_runtime_asr_in_action_invalid');
  expect(stepAsrIn.payload?.output?.waitForInput === false, 'voice_runtime_asr_in_wait_invalid');

  const stepDtmfWait = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: { callId },
  });
  expect(stepDtmfWait.ok && stepDtmfWait.payload?.ok === true, `voice_runtime_step_dtmf_wait_failed:${stepDtmfWait.status}`);
  expect(stepDtmfWait.payload?.output?.action === 'gather_dtmf', 'voice_runtime_dtmf_wait_action_invalid');
  expect(stepDtmfWait.payload?.output?.waitForInput === true, 'voice_runtime_dtmf_wait_flag_invalid');

  await postVoiceEvent(baseUrl, auth.token, {
    eventType: 'dtmf',
    callId,
    eventId: `${callId}-dtmf`,
    payload: { dtmf: '1' },
  }, 'voice_event_dtmf_failed');

  const stepDtmfIn = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: {
      callId,
      input: {
        eventId: `${callId}-dtmf-in`,
        dtmf: '1',
      },
    },
  });
  expect(stepDtmfIn.ok && stepDtmfIn.payload?.ok === true, `voice_runtime_step_dtmf_in_failed:${stepDtmfIn.status}`);
  expect(stepDtmfIn.payload?.output?.action === 'gather_dtmf', 'voice_runtime_dtmf_in_action_invalid');
  expect(stepDtmfIn.payload?.output?.waitForInput === false, 'voice_runtime_dtmf_in_wait_invalid');

  const stepTransfer = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: { callId },
  });
  expect(stepTransfer.ok && stepTransfer.payload?.ok === true, `voice_runtime_step_transfer_failed:${stepTransfer.status}`);
  expect(stepTransfer.payload?.output?.action === 'transfer', 'voice_runtime_transfer_action_invalid');
  expect(stepTransfer.payload?.output?.targetType === 'ramal', 'voice_runtime_transfer_target_invalid');
  expect(String(stepTransfer.payload?.output?.ramal || '') === extension, 'voice_runtime_transfer_ramal_invalid');

  await postVoiceEvent(baseUrl, auth.token, {
    eventType: 'transfer',
    callId,
    eventId: `${callId}-transfer`,
    payload: { targetType: 'ramal', ramal: extension },
  }, 'voice_event_transfer_failed');

  const stepHangup = await reqJson(`${baseUrl}/api/voice/runtime/step`, {
    method: 'POST',
    token: auth.token,
    body: { callId },
  });
  expect(stepHangup.ok && stepHangup.payload?.ok === true, `voice_runtime_step_hangup_failed:${stepHangup.status}`);
  expect(stepHangup.payload?.output?.action === 'hangup', 'voice_runtime_hangup_action_invalid');

  await postVoiceEvent(baseUrl, auth.token, {
    eventType: 'ended',
    callId,
    eventId: `${callId}-ended`,
  }, 'voice_event_ended_failed');

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
    selftestExtension,
    dialplanSignature,
    runtime: {
      startAction: start.payload?.output?.action || null,
      asrAction: stepAsrWait.payload?.output?.action || null,
      dtmfAction: stepDtmfWait.payload?.output?.action || null,
      dtmfObserved: String(stepDtmfIn.payload?.output?.dtmf || '') === '1',
      transferAction: stepTransfer.payload?.output?.action || null,
      transferObserved: String(stepTransfer.payload?.output?.ramal || '') === extension,
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
    ...buildVoiceArtifacts({ callId, flow, promptTranscript, asrTranscript }),
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
