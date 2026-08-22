/**
 * Node marketplace catalog (v1 - interno).
 *
 * Objetivo:
 * - Expor catálogo básico de nodes disponíveis
 * - Preparar governança para futuras extensões/plugins
 */
'use strict';

const fs = require('fs');
const path = require('path');
const dbStateStore = require('../../qa/state/dbStateStore');

const MARKETPLACE_KEY = 'governance/node-marketplace-registry.json';

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}

const REGISTRY_PATH = path.resolve(__dirname, '../../governance/node-marketplace-registry.json');

function ensureRegistryFile() {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify({ items: [] }, null, 2));
  }
}

function loadRegistry() {
  try {
    ensureRegistryFile();
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return parsed;
    }
  } catch (_) {}
  return { items: [] };
}

function saveRegistry(registry) {
  ensureRegistryFile();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  // RAP-078: DB canônico + JSON como export derivado.
  dbStateStore.saveSyncExport(MARKETPLACE_KEY, registry);
}

function listBuiltinNodes() {
  return [
    { id: 'start', label: 'Start', category: 'core', version: '1.0' },
    { id: 'message', label: 'Message', category: 'core', version: '1.0' },
    { id: 'user_input', label: 'User Input', category: 'core', version: '1.0' },
    { id: 'router', label: 'Router', category: 'core', version: '1.0' },
    { id: 'schedule_router', label: 'Schedule Router', category: 'core', version: '1.0' },
    { id: 'options', label: 'Options', category: 'core', version: '1.0' },
    { id: 'merge', label: 'Merge', category: 'core', version: '1.0' },
    { id: 'set_variable', label: 'Set Variable', category: 'core', version: '1.0' },
    { id: 'handoff', label: 'Handoff', category: 'core', version: '1.0' },
    { id: 'end', label: 'End', category: 'core', version: '1.0' },
    { id: 'ai', label: 'AI', category: 'ai', version: '1.0' },
    { id: 'ai_task', label: 'AI Task', category: 'ai', version: '1.0' },
    { id: 'semantic_router', label: 'Semantic Router', category: 'ai', version: '1.0' },
    { id: 'rag_answer', label: 'RAG Answer', category: 'ai', version: '1.0' },
    { id: 'business_entry', label: 'Business Entry', category: 'ai', version: '1.0' },
    { id: 'api', label: 'API Request', category: 'integrations', version: '1.0' },
    { id: 'subflow', label: 'Subflow', category: 'core', version: '1.0' },
    { id: 'get_flow_info', label: 'Get Flow Info', category: 'persistence', version: '1.0' },
    { id: 'get_queue_status', label: 'Get Queue Status', category: 'persistence', version: '1.0' },
    { id: 'get_config_value', label: 'Get Config Value', category: 'persistence', version: '1.0' },
    { id: 'list_flows', label: 'List Flows', category: 'persistence', version: '1.0' },
    { id: 'get_current_time', label: 'Get Current Time', category: 'system', version: '1.0' },
    { id: 'generate_uuid', label: 'Generate UUID', category: 'system', version: '1.0' },
    { id: 'delay', label: 'Delay', category: 'system', version: '1.0' },
    { id: 'format_date', label: 'Format Date', category: 'system', version: '1.0' },
    { id: 'random_number', label: 'Random Number', category: 'system', version: '1.0' },
    { id: 'get_user_info', label: 'Get User Info', category: 'system', version: '1.0' },
    { id: 'voice_prompt_listen', label: 'Voice Prompt + Listen', category: 'voice', version: '0.1' },
    { id: 'voice_listen_asr', label: 'Voice ASR', category: 'voice', version: '0.1' },
    { id: 'voice_gather_dtmf', label: 'Voice DTMF', category: 'voice', version: '0.1' },
    { id: 'voice_branch', label: 'Voice Branch', category: 'voice', version: '0.1' },
    { id: 'voice_transfer_ramal', label: 'Voice Transfer Ramal', category: 'voice', version: '0.1' },
    { id: 'voice_transfer_fila', label: 'Voice Transfer Fila', category: 'voice', version: '0.1' },
    { id: 'voice_transfer_utils', label: 'Voice Transfer Utils', category: 'voice', version: '0.1' },
    { id: 'voice_hangup', label: 'Voice Hangup', category: 'voice', version: '0.1' },
  ];
}

function normalizeNodeItem(item, defaults = {}) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id != null ? safeTrim(item.id) : '';
  const label = item.label != null ? safeTrim(item.label) : '';
  const category = item.category != null ? safeTrim(item.category) : '';
  const version = item.version != null ? safeTrim(item.version) : '';
  if (!id || !label || !category || !version) return null;
  return {
    id,
    label,
    category,
    version,
    description: item.description != null ? safeToString(item.description) : null,
    configSchema: item.configSchema && typeof item.configSchema === 'object' ? item.configSchema : null,
    visibility: item.visibility === 'public' ? 'public' : (item.visibility === 'tenant' ? 'tenant' : (defaults.visibility || 'tenant')),
    tenantId: defaults.tenantId || null,
    publishedAt: defaults.publishedAt || new Date().toISOString(),
    publishedBy: defaults.publishedBy || null,
  };
}

function listPublishedNodes({ tenantId } = {}) {
  const registry = loadRegistry();
  const items = Array.isArray(registry.items) ? registry.items : [];
  return items.filter((item) => {
    if (!item) return false;
    if (item.visibility === 'public') return true;
    if (tenantId && item.visibility === 'tenant' && item.tenantId === safeToString(tenantId)) return true;
    return false;
  });
}

function listNodeCatalog({ tenantId } = {}) {
  const builtin = listBuiltinNodes();
  const published = listPublishedNodes({ tenantId });
  return [...builtin, ...published];
}

function publishNode({ tenantId, node, actorId = null }) {
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  const registry = loadRegistry();
  const items = Array.isArray(registry.items) ? registry.items : [];
  const normalized = normalizeNodeItem(node, {
    tenantId: safeToString(tenantId),
    publishedBy: actorId ? safeToString(actorId) : null,
    visibility: node && node.visibility ? node.visibility : 'tenant',
  });
  if (!normalized) return { ok: false, error: 'invalid_node' };

  const existingIdx = items.findIndex((i) => i && i.id === normalized.id && i.tenantId === normalized.tenantId);
  if (existingIdx >= 0) {
    items[existingIdx] = { ...items[existingIdx], ...normalized, publishedAt: new Date().toISOString() };
  } else {
    items.push(normalized);
  }
  registry.items = items;
  saveRegistry(registry);
  return { ok: true, node: normalized };
}

function revokeNode({ tenantId, nodeId }) {
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  if (!nodeId) return { ok: false, error: 'node_id_required' };
  const registry = loadRegistry();
  const items = Array.isArray(registry.items) ? registry.items : [];
  const before = items.length;
  registry.items = items.filter((item) => !(item && item.id === safeToString(nodeId) && item.tenantId === safeToString(tenantId)));
  if (registry.items.length === before) return { ok: false, error: 'not_found' };
  saveRegistry(registry);
  return { ok: true };
}

function getNodeSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'NodeMarketplaceItem',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'category', 'version'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 100 },
      label: { type: 'string', minLength: 1, maxLength: 200 },
      category: { type: 'string', minLength: 1, maxLength: 50 },
      version: { type: 'string', minLength: 1, maxLength: 50 },
      description: { type: ['string', 'null'], maxLength: 1000 },
      visibility: { type: 'string', enum: ['tenant', 'public'] },
      configSchema: { type: ['object', 'null'] },
    },
  };
}

module.exports = {
  listNodeCatalog,
  listPublishedNodes,
  publishNode,
  revokeNode,
  getNodeSchema,
};
