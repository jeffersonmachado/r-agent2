#!/usr/bin/env node
/**
 * Conversor único: Ripabx legado (MariaDB + XML) -> Postgres (PBX v1)
 *
 * Escopo inicial (v1):
 * - Cria/garante registro `pbx_tenants` para um tenant_key (alvo)
 * - Importa ramais de `ramal.xml` (legado) para `pbx_extensions`
 * - Materializa ramais no Asterisk Realtime (ps_endpoints/ps_auths/ps_aors)
 *
 * Próximos passos (iterativos):
 * - trunks/interconexao, filas, DID/DDR, URA (call_rules), etc.
 *
 * Uso:
 *   TENANT_KEY=results PBX_LEGACY_ROOT=/opt/results/telefonia/ripabx node scripts/pbx-import.js
 *
 * Variáveis:
 * - TENANT_KEY (obrigatório): tenant_key destino no r-agent2
 * - PBX_LEGACY_ROOT / PBX_LEGACY_XML_DIR (para localizar XMLs)
 * - DATABASE_URL / PG* (já usadas pelo Sequelize do r-agent2)
 */

const crypto = require('crypto');
const path = require('path');
const { extractTag, parseXmlBlocks, normalizeName } = require('./pbxImportLegacyXml');

function fatal(msg, extra = null) {
  // eslint-disable-next-line no-console
  console.error(`[pbx-import] ${msg}`);
  if (extra) {
    // eslint-disable-next-line no-console
    console.error(extra);
  }
  process.exit(1);
}

function jsonLog(obj) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(obj));
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function pjsipId(tenantKey, rawId) {
  return `${tenantKey}__${rawId}`;
}

async function main() {
  const tenantKey = String(process.env.TENANT_KEY || '').trim();
  if (!tenantKey) fatal('TENANT_KEY é obrigatório');

  // Lazy import local modules (respeita config/env existentes)
  // eslint-disable-next-line global-require
  const { connect, close } = require(path.join(__dirname, '..', 'api', 'db', 'sequelize'));
  // eslint-disable-next-line global-require
  const models = require(path.join(__dirname, '..', 'api', 'db', 'models'));
  // eslint-disable-next-line global-require
  const pbxLegacy = require(path.join(__dirname, '..', 'api', 'services', 'pbxLegacy'));

  const report = {
    ok: false,
    tenantKey,
    imported: {
      tenants: 0,
      extensions: 0,
      trunks: 0,
      queues: 0,
      dids: 0,
      callRules: 0,
      pjsip: { endpoints: 0, auths: 0, aors: 0 },
    },
    warnings: [],
    errors: [],
  };

  try {
    await connect();

    const PbxTenant = models.PbxTenant();
    const PbxExtension = models.PbxExtension();
    const pbxTrunks = require(path.join(__dirname, '..', 'api', 'services', 'pbx', 'pbxTrunksService'));
    const pbxQueues = require(path.join(__dirname, '..', 'api', 'services', 'pbx', 'pbxQueuesService'));
    const pbxDids = require(path.join(__dirname, '..', 'api', 'services', 'pbx', 'pbxDidsService'));
    const pbxCallRules = require(path.join(__dirname, '..', 'api', 'services', 'pbx', 'pbxCallRulesService'));

    // Ensure PBX tenant record
    const tenantRow = await PbxTenant.findOne({ where: { tenantKey } });
    if (!tenantRow) {
      await PbxTenant.create({
        id: makeId('pbx_tenant'),
        tenantKey,
        name: tenantKey,
        status: 'active',
        settings: {},
      });
      report.imported.tenants += 1;
    }

    // Read legacy extensions from XML
    const legacyRamais = pbxLegacy.listRamais();
    if (!Array.isArray(legacyRamais)) {
      report.warnings.push('listRamais retornou valor inesperado; nada importado');
    }

    // Import each extension
    // Use raw queries via Sequelize connection from connect()
    // eslint-disable-next-line global-require
    const { getSequelize } = require(path.join(__dirname, '..', 'api', 'db', 'sequelize'));
    const sq = getSequelize();
    if (!sq) throw new Error('Sequelize não inicializado após connect()');

    // Basic defaults for endpoint materialization
    const defaultAllow = 'ulaw,alaw';
    const defaultDisallow = 'all';

    for (const r of legacyRamais) {
      const ext = String(r?.ramal || '').trim();
      if (!ext) continue;

      const existing = await PbxExtension.findOne({ where: { tenantKey, extension: ext } });
      if (!existing) {
        await PbxExtension.create({
          id: makeId('pbx_ext'),
          tenantKey,
          extension: ext,
          displayName: r?.nome || null,
          authUsername: r?.usuario || ext,
          authPassword: r?.senha || null,
          calleridName: r?.nome || null,
          calleridNumber: ext,
          voicemailEnabled: false,
          codecs: [],
          endpointOptions: { legacy: r || {} },
          status: 'active',
        });
        report.imported.extensions += 1;
      }

      // Materialize to realtime ps_* using deterministic IDs
      const id = pjsipId(tenantKey, ext);

      // ps_auths
      await sq.query(
        `INSERT INTO ps_auths (id, auth_type, username, password, created_at, updated_at)
         VALUES (:id, 'userpass', :username, :password, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           password = EXCLUDED.password,
           updated_at = NOW()`,
        { replacements: { id, username: r?.usuario || ext, password: r?.senha || '' } },
      );
      report.imported.pjsip.auths += 1;

      // ps_aors
      await sq.query(
        `INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency, created_at, updated_at)
         VALUES (:id, 1, 'yes', 60, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
        { replacements: { id } },
      );
      report.imported.pjsip.aors += 1;

      // ps_endpoints
      await sq.query(
        `INSERT INTO ps_endpoints (id, aors, auth, context, disallow, allow, direct_media, dtmf_mode, callerid, rewrite_contact, rtp_symmetric, force_rport, ice_support, allow_transfer, allow_subscribe, created_at, updated_at)
         VALUES (:id, :id, :id, :context, :disallow, :allow, 'no', 'rfc4733', :callerid, 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           aors = EXCLUDED.aors,
           auth = EXCLUDED.auth,
           context = EXCLUDED.context,
           disallow = EXCLUDED.disallow,
           allow = EXCLUDED.allow,
           callerid = EXCLUDED.callerid,
           updated_at = NOW()`,
        {
          replacements: {
            id,
            context: tenantKey,
            disallow: defaultDisallow,
            allow: defaultAllow,
            callerid: `${r?.nome || ext} <${ext}>`,
          },
        },
      );
      report.imported.pjsip.endpoints += 1;
    }

    // -------------------------------------------------------------------
    // Import trunks (interconexao.xml) - best-effort tolerant parser
    // -------------------------------------------------------------------
    try {
      const { readXmlFile } = require(path.join(__dirname, '..', 'api', 'services', 'pbxLegacy', 'xmlStore'));
      const interXml = readXmlFile('interconexao.xml');
      if (!interXml) {
        report.warnings.push('interconexao.xml não encontrado (troncos não importados)');
      } else {
        const blocks = parseXmlBlocks(interXml, 'interconexao');
        for (const b of blocks) {
          const name = normalizeName(extractTag(b, 'nome') || extractTag(b, 'name'), 'trunk');
          const host = extractTag(b, 'host') || extractTag(b, 'ip') || null;
          const user = extractTag(b, 'usuario') || extractTag(b, 'username') || null;
          const pass = extractTag(b, 'senha') || extractTag(b, 'password') || null;
          const contact = host ? `sip:${host}` : null;
          // eslint-disable-next-line no-await-in-loop
          await pbxTrunks.upsertTrunk({
            tenantKey,
            payload: {
              name,
              type: 'pjsip',
              transport: null,
              auth: { username: user, password: pass },
              aor: { contact, maxContacts: 1 },
              endpoint: { allow: 'ulaw,alaw', disallow: 'all', direct_media: 'no' },
              status: 'active',
            },
            actorUserId: null,
          });
          report.imported.trunks += 1;
        }
      }
    } catch (err) {
      report.warnings.push(`Falha ao importar interconexao.xml: ${err?.message || String(err)}`);
    }

    // -------------------------------------------------------------------
    // Import queues (fila.xml) - best-effort tolerant parser
    // -------------------------------------------------------------------
    try {
      const { readXmlFile } = require(path.join(__dirname, '..', 'api', 'services', 'pbxLegacy', 'xmlStore'));
      const filaXml = readXmlFile('fila.xml');
      if (!filaXml) {
        report.warnings.push('fila.xml não encontrado (filas não importadas)');
      } else {
        const blocks = parseXmlBlocks(filaXml, 'fila');
        for (const b of blocks) {
          const name = normalizeName(extractTag(b, 'nome') || extractTag(b, 'name'), 'queue');
          const strategy = extractTag(b, 'estrategia') || extractTag(b, 'strategy') || null;
          // eslint-disable-next-line no-await-in-loop
          await pbxQueues.upsertQueue({
            tenantKey,
            payload: {
              name,
              displayName: extractTag(b, 'descricao') || extractTag(b, 'display') || null,
              strategy,
              options: { legacy: { xml: b.slice(0, 4000) } },
            },
            actorUserId: null,
          });
          report.imported.queues += 1;
        }
      }
    } catch (err) {
      report.warnings.push(`Falha ao importar fila.xml: ${err?.message || String(err)}`);
    }

    // -------------------------------------------------------------------
    // Import DID/DDR (ddr.xml) - best-effort tolerant parser
    // -------------------------------------------------------------------
    try {
      const { readXmlFile } = require(path.join(__dirname, '..', 'api', 'services', 'pbxLegacy', 'xmlStore'));
      const ddrXml = readXmlFile('ddr.xml');
      if (!ddrXml) {
        report.warnings.push('ddr.xml não encontrado (DIDs não importados)');
      } else {
        const blocks = parseXmlBlocks(ddrXml, 'ddr');
        for (const b of blocks) {
          const did = extractTag(b, 'did') || extractTag(b, 'numero') || extractTag(b, 'ddr') || null;
          if (!did) continue;
          const targetExt = extractTag(b, 'ramal') || extractTag(b, 'destino') || null;
          const actions = targetExt ? [{ type: 'extension', ref: String(targetExt).trim() }] : [{ type: 'hangup' }];
          // eslint-disable-next-line no-await-in-loop
          await pbxDids.upsertDid({
            tenantKey,
            payload: { did: String(did).trim(), enabled: true, match: { legacy: true }, actions },
            actorUserId: null,
          });
          report.imported.dids += 1;
        }
      }
    } catch (err) {
      report.warnings.push(`Falha ao importar ddr.xml: ${err?.message || String(err)}`);
    }

    // -------------------------------------------------------------------
    // Snapshot legacy URA dialplan (conf/ura.conf) as call_rule (optional)
    // -------------------------------------------------------------------
    try {
      const legacyRoot = process.env.PBX_LEGACY_ROOT || '';
      const uraPath = legacyRoot ? path.join(legacyRoot, 'conf', 'ura.conf') : null;
      if (uraPath && require('fs').existsSync(uraPath)) {
        const dialplanText = require('fs').readFileSync(uraPath, 'utf8');
        await pbxCallRules.upsertCallRule({
          tenantKey,
          payload: {
            type: 'ivr_dialplan_text',
            name: 'legacy_ura_conf',
            enabled: true,
            definition: { contextSuffix: 'legacy_ura_conf', dialplanText },
          },
          actorUserId: null,
        });
        report.imported.callRules += 1;
      } else {
        report.warnings.push('conf/ura.conf não encontrado (snapshot de URA não gerado)');
      }
    } catch (err) {
      report.warnings.push(`Falha ao snapshot de URA: ${err?.message || String(err)}`);
    }

    // -------------------------------------------------------------------
    // MariaDB inventory (best-effort): list tables if configured
    // -------------------------------------------------------------------
    try {
      const { getPool } = require(path.join(__dirname, '..', 'api', 'services', 'pbxLegacy', 'mariadbClient'));
      const pool = await getPool();
      if (!pool) {
        report.warnings.push('MariaDB não configurado (PBX_MARIADB_*); import via DB ignorado');
      } else {
        const [rows] = await pool.query('SHOW TABLES');
        const n = Array.isArray(rows) ? rows.length : 0;
        report.warnings.push(`MariaDB configurado: ${n} tabela(s) detectada(s) (import DB ainda não implementado)`);
      }
    } catch (err) {
      report.warnings.push(`Falha ao consultar MariaDB: ${err?.message || String(err)}`);
    }

    report.ok = true;
    jsonLog(report);
  } catch (err) {
    report.errors.push(err?.message || String(err));
    jsonLog(report);
    fatal('Falha no conversor', err);
  } finally {
    try {
      // eslint-disable-next-line no-await-in-loop
      await close();
    } catch {
      // ignore
    }
  }
}

main();

