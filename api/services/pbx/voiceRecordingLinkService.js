'use strict';

/**
 * Voice + Digital: liga a gravação da chamada (pbx_recordings) à mensagem
 * type='call' do Inbox e, quando a policy de gravação do tenant permite,
 * transcreve o áudio (Whisper por tenant) e persiste em body.transcription.
 *
 * Join implícito: pbx_recordings.uniqueid == body.call.uniqueid e
 * external_message_id = pbx-call:<tenantId>:<uniqueid>.
 *
 * É chamada dos dois lados da corrida (best-effort, idempotente):
 * - voiceInboxBridgeService, ao registrar a chamada (gravação já escaneada);
 * - pbxRecordingsService.scanAndUpsertRecordings, ao descobrir o .wav
 *   (chamada já estava no Inbox).
 */

const fs = require('fs');
const logger = require('../../utils/logger');
const models = require('../../db/models');
const { getRecordingPolicy } = require('./pbxRecordingPolicyService');
const { transcribeAudio } = require('../audioTranscriptionService');

function logWarn(event, extra) {
  try {
    logger.warn(event, extra);
  } catch (_) {}
}

async function findCallMessage({ tenantId, uniqueid }) {
  const MessageModel = models.ChannelMessage();
  return MessageModel.findOne({
    where: {
      tenant_key: String(tenantId),
      external_message_id: `pbx-call:${String(tenantId)}:${String(uniqueid)}`,
    },
  }).catch(() => null);
}

async function findRecording({ tenantId, uniqueid }) {
  const RecordingModel = models.PbxRecording();
  return RecordingModel.findOne({
    where: { tenantKey: String(tenantId), uniqueid: String(uniqueid) },
  }).catch(() => null);
}

/**
 * Tenta transcrever o áudio da gravação. Falha fail-soft: qualquer erro
 * (sem API key do tenant, provider indisponível, arquivo ilegível) vira
 * apenas ausência de transcrição — a chamada continua no Inbox.
 * Timeout duro: o scan de gravações não pode ficar refém da rede.
 */
async function tryTranscribe({ tenantId, recording }) {
  const filePath = recording?.storage?.path;
  if (!filePath || !fs.existsSync(filePath)) return null;
  const audioData = fs.readFileSync(filePath);
  const timeoutMs = Math.max(1000, Number(process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS) || 60000);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  });
  const result = await Promise.race([
    transcribeAudio({
      audioData,
      provider: 'whisper',
      tenantId: String(tenantId),
    }),
    timeout,
  ]).finally(() => clearTimeout(timer));
  if (!result || result.timeout || !result.text || result.error) return null;
  return {
    text: String(result.text),
    language: result.language || 'pt',
    provider: result.provider || 'whisper',
    transcribedAt: new Date().toISOString(),
  };
}

/**
 * Liga gravação ↔ mensagem de chamada e anexa transcrição quando possível.
 * Idempotente: se recordingId e transcrição já estão presentes, não faz nada.
 */
async function linkRecordingToCallMessage({ tenantId, uniqueid } = {}) {
  if (!tenantId || !uniqueid) return { linked: false, reason: 'invalid_input' };

  const message = await findCallMessage({ tenantId, uniqueid });
  if (!message) return { linked: false, reason: 'message_not_found' };

  const recording = await findRecording({ tenantId, uniqueid });
  if (!recording) return { linked: false, reason: 'recording_not_found' };

  const body = message.body && typeof message.body === 'object' ? message.body : {};
  const alreadyLinked = body.call && body.call.recordingId === recording.id;
  if (alreadyLinked && body.transcription) {
    return { linked: true, skipped: true, recordingId: recording.id, transcribed: true };
  }

  const nextBody = {
    ...body,
    call: { ...(body.call || {}), recordingId: recording.id },
  };

  let transcription = body.transcription || null;
  if (!transcription) {
    // A transcrição só roda quando a gravação está habilitada para o tenant
    // (a gravação em si já é gated pelo dialplan/policy no momento da chamada).
    const policyOut = await getRecordingPolicy({ tenantKey: String(tenantId) }).catch(() => null);
    const policy = policyOut?.policy || {};
    if (policy.enabled) {
      transcription = await tryTranscribe({ tenantId, recording }).catch((err) => {
        logWarn('[VoiceRecordingLink] Transcrição fail-soft', { tenantId, uniqueid, error: String(err?.message || err) });
        return null;
      });
      if (transcription) nextBody.transcription = transcription;
    }
  }

  await message.update({ body: nextBody, updated_at: new Date() });

  // P5.15 — Voice → Intent → NBA: transcrição nova dispara a análise de
  // insight (IA do tenant) que grava o insight na mensagem e projeta um
  // WorkspaceInsight na entidade (a NBA existente passa a responder à
  // ligação). Fire-and-forget best-effort: nunca bloqueia o link nem o scan.
  if (transcription && !body.transcription) {
    // eslint-disable-next-line global-require
    const { processCallInsight } = require('../voice/callInsightBridgeService');
    Promise.resolve()
      .then(() => processCallInsight({ tenantId, message }))
      .then((out) => {
        if (out?.processed) {
          try {
            // eslint-disable-next-line global-require
            const { emitEvent } = require('../websocketService');
            emitEvent('conversation.updated', {
              tenantId: String(tenantId),
              conversationId: String(message.conversation_id || ''),
              transcriptInsight: true,
            });
          } catch (err) {
            logWarn('[VoiceRecordingLink] Emissão WS de insight fail-soft', { tenantId, uniqueid, error: String(err?.message || err) });
          }
        }
      })
      .catch((err) => logWarn('[VoiceRecordingLink] Insight de chamada fail-soft', { tenantId, uniqueid, error: String(err?.message || err) }));
  }

  return {
    linked: true,
    recordingId: recording.id,
    messageId: message.id,
    transcribed: !!transcription,
  };
}

module.exports = {
  linkRecordingToCallMessage,
};
