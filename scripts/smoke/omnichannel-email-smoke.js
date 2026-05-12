'use strict';

const fs = require('fs');
const path = require('path');
const { SMTPServer } = require('smtp-server');
const notificationService = require('../../api/services/notificationService');

const ROOT_DIR = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT_DIR, 'qa', 'smoke', 'prod-like');
const REPLAY_PATH = path.join(OUT_DIR, 'omnichannel_email-replay.json');
const EVIDENCE_PATH = path.join(OUT_DIR, 'omnichannel_email-evidence.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isoNow() {
  return new Date().toISOString();
}

async function startSmtpCaptureServer() {
  const messages = [];
  const server = new SMTPServer({
    disabledCommands: ['AUTH'],
    authOptional: true,
    hideSTARTTLS: true,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        messages.push({
          from: session.envelope && session.envelope.mailFrom ? session.envelope.mailFrom.address : null,
          to: Array.isArray(session.envelope && session.envelope.rcptTo)
            ? session.envelope.rcptTo.map((entry) => entry.address)
            : [],
          raw: Buffer.concat(chunks).toString('utf8'),
          receivedAt: isoNow(),
        });
        callback(null);
      });
      stream.on('error', callback);
    },
  });

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.server.address();
      resolve(address && typeof address === 'object' ? address.port : 1025);
    });
  });

  return {
    server,
    port,
    messages,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

async function main() {
  const smtp = await startSmtpCaptureServer();
  const previousEnv = {
    NOTIFICATION_EMAIL_ENABLED: process.env.NOTIFICATION_EMAIL_ENABLED,
    EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST,
    EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT,
    EMAIL_SMTP_SECURE: process.env.EMAIL_SMTP_SECURE,
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
  };

  try {
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    process.env.EMAIL_SMTP_HOST = '127.0.0.1';
    process.env.EMAIL_SMTP_PORT = String(smtp.port);
    process.env.EMAIL_SMTP_SECURE = 'false';
    process.env.EMAIL_FROM_ADDRESS = 'qa@example.test';
    process.env.EMAIL_FROM_NAME = 'QA Waves';

    const startedAt = isoNow();
    const dispatch = await notificationService.dispatchNotification({
      tenantId: 'tenant-omnichannel-email-smoke',
      jobId: `job-email-smoke-${Date.now()}`,
      fallbackPayload: {
        tenantId: 'tenant-omnichannel-email-smoke',
        channel: 'email',
        recipient: 'destinatario@example.test',
        eventType: 'welcome_sent',
        message: 'Email provider check via smtp local capture',
        metadata: {
          vertical: 'omnichannel',
          providerCheck: true,
          smoke: 'omnichannel_email',
        },
      },
    });
    const finishedAt = isoNow();

    if (!dispatch.ok) {
      throw new Error(dispatch.error || 'email_dispatch_failed');
    }
    if (!smtp.messages.length) {
      throw new Error('email_not_captured_by_smtp_server');
    }

    const evidence = {
      capability: 'omnichannel_email',
      journeyId: 'omnichannel_email',
      status: 'GO',
      startedAt,
      finishedAt,
      smtp: {
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
      },
      delivery: {
        id: dispatch.delivery && dispatch.delivery.id ? dispatch.delivery.id : null,
        status: dispatch.delivery && dispatch.delivery.status ? dispatch.delivery.status : null,
        providerMessageId: (dispatch.delivery && dispatch.delivery.provider_message_id) || (dispatch.result && dispatch.result.providerMessageId) || null,
        recipientMasked: dispatch.delivery && dispatch.delivery.recipient_masked ? dispatch.delivery.recipient_masked : null,
      },
      capturedMessage: smtp.messages[0],
    };

    writeJson(EVIDENCE_PATH, evidence);

    const replay = {
      id: `prod-like-replay-omnichannel_email-${Date.now()}`,
      journeyId: 'omnichannel_email',
      scenarioId: 'omnichannel_email_provider_check',
      status: 'GO',
      startedAt,
      finishedAt,
      generatedAt: finishedAt,
      tracePath: EVIDENCE_PATH,
      evidencePath: EVIDENCE_PATH,
      screenshots: [],
      logs: [
        { level: 'info', timestamp: startedAt, message: 'omnichannel_email smtp provider check started' },
        { level: 'info', timestamp: finishedAt, message: `evidence=${EVIDENCE_PATH}` },
        { level: 'info', timestamp: finishedAt, message: 'Email provider check returned non-stub status' },
      ],
      steps: [
        {
          id: 'smtp_delivery',
          type: 'api',
          timestamp: finishedAt,
          status: 'passed',
          channel: 'email',
          title: 'omnichannel_email smtp provider check',
          details: 'Real email dispatch validated against in-process SMTP capture server.',
          screenshotAfter: EVIDENCE_PATH,
          proofChain: {
            artifact: EVIDENCE_PATH,
            provider: 'smtp',
            deliveryStatus: dispatch.delivery && dispatch.delivery.status ? dispatch.delivery.status : null,
          },
        },
      ],
      proofChain: {
        capability: 'omnichannel_email',
        provider: 'smtp',
        evidencePath: EVIDENCE_PATH,
      },
      summary: {
        capability: 'omnichannel_email',
        deliveryStatus: dispatch.delivery && dispatch.delivery.status ? dispatch.delivery.status : null,
        messageCount: smtp.messages.length,
      },
    };

    writeJson(REPLAY_PATH, replay);
    console.log(JSON.stringify({ ok: true, replayPath: REPLAY_PATH, evidencePath: EVIDENCE_PATH, messageCount: smtp.messages.length }, null, 2));
  } finally {
    await smtp.close().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
