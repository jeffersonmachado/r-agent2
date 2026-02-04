const net = require('net');

function parseAmiLines(buffer) {
  return buffer.split(/\r?\n/);
}

function buildAction(action, params = {}) {
  const lines = [`Action: ${action}`];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${v}`);
  }
  lines.push('', '');
  return lines.join('\r\n');
}

/**
 * Cliente AMI minimalista (login -> action -> logoff).
 * Usado para originate (click2call/campanhas).
 */
async function withAmiConnection(fn) {
  const host = process.env.AMI_HOST || 'asterisk';
  const port = Number(process.env.AMI_PORT || 5038);
  const username = process.env.AMI_USERNAME || 'ragent2';
  const secret = process.env.AMI_SECRET || 'ragent2';
  const timeoutMs = Number(process.env.AMI_TIMEOUT_MS || 8000);

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    let buf = '';
    let closed = false;

    function cleanup() {
      if (closed) return;
      closed = true;
      try { socket.destroy(); } catch {}
    }

    socket.on('timeout', () => {
      cleanup();
      reject(Object.assign(new Error('AMI timeout'), { code: 'ami_timeout' }));
    });
    socket.on('error', (err) => {
      cleanup();
      reject(Object.assign(err, { code: 'ami_socket_error' }));
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
    });
    socket.on('connect', async () => {
      try {
        // Login
        socket.write(buildAction('Login', { Username: username, Secret: secret, Events: 'off' }));
        await new Promise(r => setTimeout(r, 120)); // pequeno delay para receber resposta
        const lines = parseAmiLines(buf);
        if (!lines.some(l => /^Response:\s*Success/i.test(l))) {
          throw Object.assign(new Error('AMI login failed'), { code: 'ami_login_failed', details: lines.slice(0, 30) });
        }

        const result = await fn({
          write: (action, params) => socket.write(buildAction(action, params)),
          readSnapshot: () => parseAmiLines(buf),
        });

        // Logoff best-effort
        try { socket.write(buildAction('Logoff', {})); } catch {}
        cleanup();
        resolve(result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

async function originate({
  channel,
  context,
  exten,
  priority = 1,
  callerId = null,
  timeoutMs = 30000,
  variables = {},
}) {
  if (!channel) throw Object.assign(new Error('channel é obrigatório'), { code: 'ami_channel_required' });
  if (!context) throw Object.assign(new Error('context é obrigatório'), { code: 'ami_context_required' });
  if (!exten) throw Object.assign(new Error('exten é obrigatório'), { code: 'ami_exten_required' });

  return await withAmiConnection(async (ami) => {
    const vars = Object.entries(variables || {}).map(([k, v]) => `${k}=${v}`).join('|');
    ami.write('Originate', {
      Channel: channel,
      Context: context,
      Exten: exten,
      Priority: priority,
      Timeout: Number(timeoutMs),
      CallerID: callerId || undefined,
      Variable: vars || undefined,
      Async: 'true',
    });
    return { ok: true };
  });
}

async function command(commandText) {
  const cmd = String(commandText || '').trim();
  if (!cmd) throw Object.assign(new Error('command é obrigatório'), { code: 'ami_command_required' });
  return await withAmiConnection(async (ami) => {
    ami.write('Command', { Command: cmd });
    // snapshot best-effort (AMI is line-based; we keep it minimal here)
    await new Promise(r => setTimeout(r, 180));
    const lines = ami.readSnapshot();
    return { ok: true, lines };
  });
}

module.exports = {
  originate,
  command,
};

