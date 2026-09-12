const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { makePjsipId, makeTrunkPjsipId } = require('./pbxId');
const crypto = require('crypto');

function makeQueueRtName(tenantKey, queueName) {
  return `${tenantKey}__${queueName}`;
}

/**
 * Converte um dialplan em texto (formato asterisk.conf) para linhas realtime.
 * Suporta apenas subset:
 * - [context]
 * - exten => exten,priority,App(AppData)
 * - priority: número ou 'n'
 */
function parseAsteriskDialplanText(raw) {
  const text = String(raw || '');
  const lines = text.split(/\r?\n/);
  let currentContext = null;
  /** @type {Record<string, Record<string, number>>} */
  const nextPriority = {};
  const rows = [];

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line || line.startsWith(';')) continue;

    const ctx = line.match(/^\[([^\]]+)\]$/);
    if (ctx) {
      currentContext = ctx[1].trim();
      continue;
    }

    const ex = line.match(/^exten\s*=>\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([A-Za-z0-9_]+)\s*(?:\((.*)\))?\s*$/);
    if (!ex) continue;
    if (!currentContext) continue;

    const exten = ex[1].trim();
    const pr = ex[2].trim();
    const app = ex[3].trim();
    const appdata = (ex[4] ?? '').trim();

    nextPriority[currentContext] ||= {};
    nextPriority[currentContext][exten] ||= 1;

    let priority = Number(pr);
    if (!Number.isFinite(priority)) {
      // 'n' ou label: apenas incrementa
      priority = nextPriority[currentContext][exten];
    }
    nextPriority[currentContext][exten] = Math.max(nextPriority[currentContext][exten], priority + 1);

    rows.push({ context: currentContext, exten, priority, app, appdata });
  }

  return rows;
}

function computeDialplanSignature(rows) {
  const h = crypto.createHash('sha256');
  for (const r of rows || []) {
    // stable-ish representation (order already deterministic by builder)
    h.update(`${r.context}|${r.exten}|${r.priority}|${r.app}|${r.appdata}\n`);
  }
  return h.digest('hex').slice(0, 24);
}

async function ensureExtensionsTable() {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');
  await sq.query(
    `CREATE TABLE IF NOT EXISTS extensions (
      id bigserial PRIMARY KEY,
      context varchar(40) NOT NULL,
      exten varchar(40) NOT NULL,
      priority integer NOT NULL,
      app varchar(40) NOT NULL,
      appdata varchar(256) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )`
  );
  await sq.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS extensions_context_exten_priority_uq
     ON extensions (context, exten, priority)`
  );
}

/**
 * Gera linhas dialplan para um tenant (sem escrever no banco).
 */
async function buildTenantDialplanRows({ tenantKey }) {
  const PbxDid = models.PbxDid();
  const PbxQueue = models.PbxQueue();
  const PbxCallRule = models.PbxCallRule();
  const PbxRoute = models.PbxRoute();

  const rows = [];
  const recordingEnabled = String(process.env.PBX_RECORDING_ENABLED || '').toLowerCase() === 'true';
  const mixmonitorDir = process.env.PBX_MIXMONITOR_DIR || '/var/spool/asterisk/monitor/pbx';
  const selftestExtension = String(process.env.PBX_SELFTEST_EXTENSION || '9191').trim();

  if (selftestExtension) {
    rows.push({
      context: tenantKey,
      exten: selftestExtension,
      priority: 1,
      app: 'NoOp',
      appdata: 'PBX selftest extension',
    });
    rows.push({
      context: tenantKey,
      exten: selftestExtension,
      priority: 2,
      app: 'Set',
      appdata: `CDR(accountcode)=${tenantKey}`,
    });
    rows.push({
      context: tenantKey,
      exten: selftestExtension,
      priority: 3,
      app: 'Answer',
      appdata: '',
    });
    rows.push({
      context: tenantKey,
      exten: selftestExtension,
      priority: 4,
      app: 'Wait',
      appdata: '1',
    });
    rows.push({
      context: tenantKey,
      exten: selftestExtension,
      priority: 5,
      app: 'Hangup',
      appdata: '',
    });
  }

  // 1) Discagem interna (ramais)
  // Dial(PJSIP/${tenantKey}__${EXTEN})
  rows.push({
    context: tenantKey,
    exten: '_X.',
    priority: 1,
    app: 'NoOp',
    appdata: 'PBX internal dial',
  });
  rows.push({
    context: tenantKey,
    exten: '_X.',
    priority: 2,
    app: 'Set',
    appdata: `CDR(accountcode)=${tenantKey}`,
  });
  if (recordingEnabled) {
    rows.push({
      context: tenantKey,
      exten: '_X.',
      priority: 3,
      app: 'MixMonitor',
      appdata: `${mixmonitorDir}/${tenantKey}__${'${UNIQUEID}'}.wav,b`,
    });
    rows.push({
      context: tenantKey,
      exten: '_X.',
      priority: 4,
      app: 'Dial',
      appdata: `PJSIP/${makePjsipId(tenantKey, '${EXTEN}')},30`,
    });
  } else {
    rows.push({
      context: tenantKey,
      exten: '_X.',
      priority: 3,
      app: 'Dial',
      appdata: `PJSIP/${makePjsipId(tenantKey, '${EXTEN}')},30`,
    });
  }

  // 2) Acesso a filas por nome numérico (se fila for um número)
  const queues = await PbxQueue.findAll({ where: { tenantKey }, order: [['name', 'ASC']] });
  for (const q of queues) {
    const qName = String(q.name);
    if (!/^\d+$/.test(qName)) continue;
    const rtName = makeQueueRtName(tenantKey, qName);
    rows.push({ context: tenantKey, exten: qName, priority: 1, app: 'NoOp', appdata: `Queue ${rtName}` });
    if (recordingEnabled) {
      rows.push({ context: tenantKey, exten: qName, priority: 2, app: 'Set', appdata: `CDR(accountcode)=${tenantKey}` });
      rows.push({ context: tenantKey, exten: qName, priority: 3, app: 'MixMonitor', appdata: `${mixmonitorDir}/${tenantKey}__${'${UNIQUEID}'}.wav,b` });
      rows.push({ context: tenantKey, exten: qName, priority: 4, app: 'Queue', appdata: `${rtName}` });
      rows.push({ context: tenantKey, exten: qName, priority: 5, app: 'Hangup', appdata: '' });
    } else {
      rows.push({ context: tenantKey, exten: qName, priority: 2, app: 'Set', appdata: `CDR(accountcode)=${tenantKey}` });
      rows.push({ context: tenantKey, exten: qName, priority: 3, app: 'Queue', appdata: `${rtName}` });
      rows.push({ context: tenantKey, exten: qName, priority: 4, app: 'Hangup', appdata: '' });
    }
  }

  // 2.5) Rotas de saída (pbx_routes direction=outbound) -> dialplan
  // Convenção (MVP):
  // - match.pattern: ex: "_9X." (Asterisk pattern) ou match.exten: "011"
  // - actions[0]:
  //   - {type:"trunk", ref:"<trunkName>", stripPrefixLen?:number, prefix?:string}
  //   - {type:"extension", ref:"1001"}
  //   - {type:"queue", ref:"support"}
  //   - {type:"hangup"}
  const outRoutes = await PbxRoute.findAll({
    where: { tenantKey, direction: 'outbound', enabled: true },
    order: [['priority', 'ASC'], ['name', 'ASC']],
  });
  for (const r of outRoutes) {
    const match = r.match && typeof r.match === 'object' ? r.match : {};
    const extenPattern = match.pattern || match.exten || null;
    if (!extenPattern) continue;
    const exten = String(extenPattern).trim();
    if (!exten) continue;

    rows.push({ context: tenantKey, exten, priority: 1, app: 'NoOp', appdata: `Outbound route ${r.name}` });
    rows.push({ context: tenantKey, exten, priority: 2, app: 'Set', appdata: `CDR(accountcode)=${tenantKey}` });

    const a0 = Array.isArray(r.actions) ? r.actions[0] : null;
    if (!a0 || typeof a0 !== 'object') {
      rows.push({ context: tenantKey, exten, priority: 3, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'trunk' && a0.ref) {
      const trunkId = makeTrunkPjsipId(tenantKey, String(a0.ref));
      const stripLen = Number.isFinite(Number(a0.stripPrefixLen)) ? Number(a0.stripPrefixLen) : 0;
      const baseNumber = stripLen > 0 ? `${'${EXTEN:'}${stripLen}}` : '${EXTEN}';
      const prefix = a0.prefix ? String(a0.prefix) : '';
      const dialNumber = `${prefix}${baseNumber}`;
      const dialAppData = `PJSIP/${dialNumber}@${trunkId},60`;
      if (recordingEnabled) {
        rows.push({ context: tenantKey, exten, priority: 3, app: 'MixMonitor', appdata: `${mixmonitorDir}/${tenantKey}__${'${UNIQUEID}'}.wav,b` });
        rows.push({ context: tenantKey, exten, priority: 4, app: 'Dial', appdata: dialAppData });
        rows.push({ context: tenantKey, exten, priority: 5, app: 'Hangup', appdata: '' });
      } else {
        rows.push({ context: tenantKey, exten, priority: 3, app: 'Dial', appdata: dialAppData });
        rows.push({ context: tenantKey, exten, priority: 4, app: 'Hangup', appdata: '' });
      }
      continue;
    }

    if (a0.type === 'extension' && a0.ref) {
      const pjsip = makePjsipId(tenantKey, String(a0.ref));
      rows.push({ context: tenantKey, exten, priority: 3, app: 'Dial', appdata: `PJSIP/${pjsip},30` });
      rows.push({ context: tenantKey, exten, priority: 4, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'queue' && a0.ref) {
      const rtName = makeQueueRtName(tenantKey, String(a0.ref));
      rows.push({ context: tenantKey, exten, priority: 3, app: 'Queue', appdata: `${rtName}` });
      rows.push({ context: tenantKey, exten, priority: 4, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'hangup') {
      rows.push({ context: tenantKey, exten, priority: 3, app: 'Hangup', appdata: '' });
      continue;
    }

    rows.push({ context: tenantKey, exten, priority: 3, app: 'Hangup', appdata: '' });
  }

  // 3) DID/DDR (entrada) via pbx_dids
  const dids = await PbxDid.findAll({ where: { tenantKey, enabled: true }, order: [['did', 'ASC']] });
  for (const d of dids) {
    const did = String(d.did);
    const actions = Array.isArray(d.actions) ? d.actions : [];
    rows.push({ context: tenantKey, exten: did, priority: 1, app: 'NoOp', appdata: `Inbound DID ${did}` });
    rows.push({ context: tenantKey, exten: did, priority: 2, app: 'Set', appdata: `CDR(accountcode)=${tenantKey}` });

    // ação 1 (MVP)
    const a0 = actions[0] || null;
    if (!a0 || typeof a0 !== 'object') {
      rows.push({ context: tenantKey, exten: did, priority: 3, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'queue' && a0.ref) {
      const rtName = makeQueueRtName(tenantKey, String(a0.ref));
      rows.push({ context: tenantKey, exten: did, priority: 3, app: 'Queue', appdata: `${rtName}` });
      rows.push({ context: tenantKey, exten: did, priority: 4, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'extension' && a0.ref) {
      const pjsip = makePjsipId(tenantKey, String(a0.ref));
      rows.push({ context: tenantKey, exten: did, priority: 3, app: 'Dial', appdata: `PJSIP/${pjsip},30` });
      rows.push({ context: tenantKey, exten: did, priority: 4, app: 'Hangup', appdata: '' });
      continue;
    }

    if (a0.type === 'ivr' && a0.ref) {
      // Convenção: IVR materializa como exten `ivr_<suffix>` no contexto do tenant
      const suffix = String(a0.ref).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
      rows.push({ context: tenantKey, exten: did, priority: 3, app: 'Goto', appdata: `${tenantKey},ivr_${suffix},1` });
      continue;
    }

    rows.push({ context: tenantKey, exten: did, priority: 3, app: 'Hangup', appdata: '' });
  }

  // 4) URA - dialplan raw (texto) em pbx_call_rules
  // Convenção: type='ivr_dialplan_text', definition: { contextSuffix, dialplanText }
  const ivrs = await PbxCallRule.findAll({ where: { tenantKey, type: 'ivr_dialplan_text', enabled: true } });
  for (const r of ivrs) {
    const contextSuffix = String(r.definition?.contextSuffix || r.name || r.id).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
    const baseExten = `ivr_${contextSuffix}`.slice(0, 40);
    const dialplanText = String(r.definition?.dialplanText || '');
    const parsed = parseAsteriskDialplanText(dialplanText);
    for (const row of parsed) {
      // materializa tudo no contexto do tenant, namespaced por IVR
      const originalExten = String(row.exten || '').trim() || 's';
      const mappedExten = (originalExten === 's')
        ? baseExten
        : `${baseExten}__${originalExten}`.slice(0, 40);
      rows.push({ ...row, context: tenantKey, exten: mappedExten });
    }
  }

  return rows;
}

/**
 * Materializa dialplan realtime no Postgres.
 */
async function applyTenantDialplan({ tenantKey }) {
  const rows = await buildTenantDialplanRows({ tenantKey });
  const result = await applyTenantDialplanRows({ tenantKey, rows });
  const signature = computeDialplanSignature(rows);
  return { ...result, signature };
}

// PERFORMANCE (2026-09-12): o apply fazia UM INSERT por linha. O tenant `system`
// gera 8323 linhas de dialplan, e isso significava 8323 round-trips ao Postgres:
// medido em 38,5s. O smoke de PBX (`test:pbx:voice:tts-asr:smoke`) usa timeout de
// 60s no POST /api/pbx/dialplan/apply e estourava; sem o dialplan aplicado a
// evidência enterprise saía `ok=false` (sinais `cdr` e `hangupCauses` ausentes),
// o que travava RAP-068 e, por consequência, a selagem do release.
// Agora os inserts vão em lotes de DIALPLAN_INSERT_CHUNK dentro de uma transação
// (o DELETE + todos os lotes são atômicos): ~17 statements no lugar de 8323.
const DIALPLAN_INSERT_CHUNK = 500;

async function applyTenantDialplanRows({ tenantKey, rows = [] }) {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');
  await ensureExtensionsTable();

  const safeRows = Array.isArray(rows) ? rows : [];

  return sq.transaction(async (transaction) => {
    // Remove dialplan antigo do tenant (apenas contextos no namespace do tenant)
    await sq.query(
      `DELETE FROM extensions WHERE context = :ctx OR context LIKE :prefix`,
      { replacements: { ctx: tenantKey, prefix: `${tenantKey}__%` }, transaction }
    );

    for (let offset = 0; offset < safeRows.length; offset += DIALPLAN_INSERT_CHUNK) {
      const chunk = safeRows.slice(offset, offset + DIALPLAN_INSERT_CHUNK);
      const values = [];
      const replacements = {};

      chunk.forEach((row, index) => {
        values.push(`(:ctx${index}, :exten${index}, :prio${index}, :app${index}, :data${index}, NOW(), NOW())`);
        replacements[`ctx${index}`] = row.context;
        replacements[`exten${index}`] = row.exten;
        replacements[`prio${index}`] = row.priority;
        replacements[`app${index}`] = row.app;
        replacements[`data${index}`] = row.appdata;
      });

      await sq.query(
        `INSERT INTO extensions (context, exten, priority, app, appdata, created_at, updated_at)
         VALUES ${values.join(', ')}
         ON CONFLICT (context, exten, priority) DO UPDATE SET
           app = EXCLUDED.app,
           appdata = EXCLUDED.appdata,
           updated_at = NOW()`,
        { replacements, transaction }
      );
    }

    return { count: safeRows.length };
  });
}

module.exports = {
  buildTenantDialplanRows,
  applyTenantDialplan,
  applyTenantDialplanRows,
  parseAsteriskDialplanText,
  computeDialplanSignature,
};
