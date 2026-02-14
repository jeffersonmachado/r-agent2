/**
 * Store simples (JSONL) para auditoria de gerações por IA.
 *
 * Persistência:
 * - logs/qa/ai-generations.jsonl
 *
 * Regras:
 * - best-effort: falha de escrita/leitura não pode derrubar o sistema
 * - cada linha é um registro JSON independente
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'qa');
const LOG_FILE = path.join(LOG_DIR, 'ai-generations.jsonl');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * @param {Object} record
 * @returns {string|null} id gerado
 */
function appendAiGeneration(record) {
  try {
    ensureDir();
    const id = record?.id || `ai-gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timestamp = record?.timestamp || new Date().toISOString();
    const lineObj = {
      id,
      timestamp,
      ...record,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(lineObj) + '\n', 'utf8');
    return id;
  } catch {
    return null;
  }
}

/**
 * API estável (spec): appendGeneration({ envelope, valid, domain, requestId })
 * Mantém compatibilidade com appendAiGeneration() existente.
 *
 * @param {{ envelope: any, valid: boolean, domain: string, requestId?: string|null }} params
 * @returns {string|null}
 */
function appendGeneration(params) {
  try {
    const envelope = params?.envelope || null;
    const domain = params?.domain || (envelope?.domain ?? null);
    const valid = params?.valid === true;
    const requestId = params?.requestId || envelope?.audit?.request_id || null;

    return appendAiGeneration({
      domain,
      requestId,
      envelope,
      validation: envelope?.validation || { valid, errors: [], warnings: [] },
    });
  } catch {
    return null;
  }
}

/**
 * @param {Object} filters
 * @param {string} [filters.domain] - chatbot|rpa|tenant
 * @param {boolean} [filters.valid]
 * @param {string} [filters.startDate] - ISO
 * @param {string} [filters.endDate] - ISO
 * @param {number} [filters.limit]
 * @returns {{ total: number, items: any[] }}
 */
function listAiGenerations(filters = {}) {
  const limit = Math.min(parseInt(filters.limit || '200', 10) || 200, 5000);
  let lines = [];
  try {
    if (!fs.existsSync(LOG_FILE)) return { total: 0, items: [] };
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    lines = content.split('\n').filter(l => l && l.trim());
  } catch {
    return { total: 0, items: [] };
  }

  let items = lines.map(safeParseJson).filter(Boolean);

  if (filters.domain) {
    const d = String(filters.domain);
    const normalized = (d === 'chatbot') ? 'chatbot_flow' : (d === 'rpa' ? 'rpa_test' : d);
    items = items.filter(r => r && r.domain === normalized);
  }
  if (filters.valid !== undefined) {
    items = items.filter(r => r && r.validation && r.validation.valid === filters.valid);
  }
  if (filters.startDate) {
    const start = new Date(filters.startDate);
    if (!Number.isNaN(start.getTime())) {
      items = items.filter(r => new Date(r.timestamp).getTime() >= start.getTime());
    }
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    if (!Number.isNaN(end.getTime())) {
      items = items.filter(r => new Date(r.timestamp).getTime() <= end.getTime());
    }
  }

  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const total = items.length;
  items = items.slice(0, limit);

  return { total, items };
}

module.exports = {
  appendAiGeneration,
  appendGeneration,
  listAiGenerations,
  LOG_FILE,
};

