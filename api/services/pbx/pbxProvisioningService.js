const models = require('../../db/models');

function normalizeMac(raw) {
  const mac = String(raw || '').trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (!mac || mac.length !== 12) {
    const err = new Error('invalid_mac');
    err.code = 'invalid_mac';
    throw err;
  }
  return mac;
}

function generateGrandstreamCfg({ extensionRow, serverHost }) {
  const ext = extensionRow.extension;
  const authUsername = extensionRow.authUsername || ext;
  const authPassword = extensionRow.authPassword || '';
  const prov = extensionRow?.endpointOptions?.provisioning || null;

  // Nota: Grandstream aceita muitos parâmetros. Aqui é um “mínimo viável”.
  // O cliente deve ajustar modelo/firmware depois.
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gs_provision version="1">');
  lines.push('  <config version="1">');
  lines.push(`    <P271>sip:${serverHost}</P271>`); // SIP Server
  lines.push(`    <P47>${authUsername}</P47>`); // SIP User ID
  lines.push(`    <P35>${authUsername}</P35>`); // Authenticate ID
  lines.push(`    <P34>${authPassword}</P34>`); // Authenticate Password
  lines.push(`    <P3>${ext}</P3>`); // Name (label)
  // Template hooks (best-effort): mantemos mínimo para não quebrar firmwares.
  if (prov?.model || prov?.firmware || prov?.timezone || prov?.ntpServer || prov?.transport || prov?.srtp || prov?.codecs) {
    lines.push('    <!-- provisioning profile (best-effort metadata) -->');
    if (prov?.template) lines.push(`    <!-- template: ${String(prov.template)} -->`);
    if (prov?.model) lines.push(`    <!-- model: ${String(prov.model)} -->`);
    if (prov?.firmware) lines.push(`    <!-- firmware: ${String(prov.firmware)} -->`);
    if (prov?.timezone) lines.push(`    <!-- timezone: ${String(prov.timezone)} -->`);
    if (prov?.ntpServer) lines.push(`    <!-- ntp: ${String(prov.ntpServer)} -->`);
    if (prov?.transport) lines.push(`    <!-- transport: ${String(prov.transport)} -->`);
    if (prov?.srtp) lines.push('    <!-- srtp: true -->');
    if (Array.isArray(prov?.codecs)) lines.push(`    <!-- codecs: ${prov.codecs.join(',')} -->`);
  }
  lines.push('  </config>');
  lines.push('</gs_provision>');
  return { filename: null, contentType: 'application/xml; charset=utf-8', body: lines.join('\n') + '\n' };
}

function generateAvaya46xxsettings({ extensionRow, serverHost }) {
  const ext = extensionRow.extension;
  const authUsername = extensionRow.authUsername || ext;
  const authPassword = extensionRow.authPassword || '';
  const prov = extensionRow?.endpointOptions?.provisioning || null;

  // Nota: Avaya tem muitos parâmetros por firmware/modelo.
  // Aqui entregamos base SIP mínima + placeholders; o cliente pode expandir.
  const lines = [];
  lines.push('## Auto-gerado pelo r-agent2 (PBX provisioning)');
  lines.push(`## Ramal: ${ext}`);
  if (prov?.template) lines.push(`## Template: ${String(prov.template)}`);
  if (prov?.model) lines.push(`## Model: ${String(prov.model)}`);
  if (prov?.firmware) lines.push(`## Firmware: ${String(prov.firmware)}`);
  lines.push(`SET SIPDOMAIN "${serverHost}"`);
  lines.push(`SET SIP_CONTROLLER_LIST "${serverHost}"`);
  lines.push('## Credenciais SIP');
  lines.push(`SET SIP_AUTHNAME "${authUsername}"`);
  lines.push(`SET SIP_PASSWORD "${authPassword}"`);
  lines.push(`SET SIP_USERNAME "${authUsername}"`);
  lines.push('## (Opcional) ajustar codecs/transport/TLS conforme política do cliente');
  return { filename: '46xxsettings.txt', contentType: 'text/plain; charset=utf-8', body: lines.join('\n') + '\n' };
}

async function resolveExtensionByMac({ tenantKey, mac }) {
  const PbxExtension = models.PbxExtension();
  const items = await PbxExtension.findAll({ where: { tenantKey } });
  const found = items
    .map((r) => r.toJSON())
    .find((r) => {
      const prov = r?.endpointOptions?.provisioning || null;
      if (!prov?.enabled) return false;
      if (!prov?.mac) return false;
      return String(prov.mac).toUpperCase() === String(mac).toUpperCase();
    });
  return found || null;
}

async function generateProvisioning({ tenantKey, vendor, mac, serverHost }) {
  const normVendor = String(vendor || '').trim().toLowerCase();
  if (!['grandstream', 'avaya'].includes(normVendor)) {
    const err = new Error('invalid_provisioning_vendor');
    err.code = 'invalid_provisioning_vendor';
    throw err;
  }

  const normMac = normalizeMac(mac);
  const extRow = await resolveExtensionByMac({ tenantKey, mac: normMac });
  if (!extRow) {
    const err = new Error('extension_not_found_for_mac');
    err.code = 'extension_not_found_for_mac';
    throw err;
  }

  // Template selection (vendor/model/firmware) - v1.1
  const prov = extRow?.endpointOptions?.provisioning || null;
  const template = prov?.template ? String(prov.template).trim().toLowerCase() : null;

  const templates = {
    grandstream: {
      default: generateGrandstreamCfg,
      minimal: generateGrandstreamCfg,
      'grandstream-minimal': generateGrandstreamCfg,
    },
    avaya: {
      default: generateAvaya46xxsettings,
      minimal: generateAvaya46xxsettings,
      'avaya-minimal': generateAvaya46xxsettings,
    },
  };

  const vendorTemplates = templates[normVendor] || {};
  const fn = (template && vendorTemplates[template]) ? vendorTemplates[template] : vendorTemplates.default;
  if (!fn) {
    const err = new Error('invalid_provisioning_template');
    err.code = 'invalid_provisioning_template';
    throw err;
  }
  return fn({ extensionRow: extRow, serverHost });
}

module.exports = {
  normalizeMac,
  generateProvisioning,
};

